import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { listAreas, registerExistingArea } from "../../src/core/areas";
import { loadConfig, registerArea } from "../../src/core/config";
import { pathExists } from "../../src/core/files";
import {
  createTestWorkspace,
  dokitoCli,
  registerTestArea,
  type TestWorkspace,
} from "../helpers";

describe("Areas", () => {
  let workspace: TestWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
  });

  async function setup(): Promise<TestWorkspace> {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    return workspace;
  }

  test("lists registered Areas in stable order", async () => {
    const fixture = await setup();
    const otherRoot = path.join(fixture.root, "another-area");
    await mkdir(otherRoot);
    await writeFile(
      path.join(otherRoot, "dokito.yaml"),
      ["version: 1", "id: another", "name: Another", ""].join("\n"),
      "utf8",
    );
    await registerArea(fixture.configPath, "another", otherRoot);

    const result = await listAreas({ configPath: fixture.configPath });

    expect(result.configPath).toBe(fixture.configPath);
    expect(result.warnings).toEqual([]);
    expect(result.areas.map((area) => area.id)).toEqual(["another", "product"]);
    expect(result.areas).toContainEqual({
      id: "product",
      name: "Product",
      path: fixture.areaRoot,
      available: true,
      repositoryCount: 3,
    });
  });

  test("preserves concurrent Area registrations", async () => {
    const fixture = await setup();
    const registrations = Array.from({ length: 12 }, (_, index) => ({
      id: `concurrent-${index}`,
      root: path.join(fixture.root, `concurrent-${index}`),
    }));

    await Promise.all(
      registrations.map(({ id, root }) =>
        registerArea(fixture.configPath, id, root),
      ),
    );

    const config = await loadConfig(fixture.configPath);
    expect(Object.keys(config.areas).sort()).toEqual(
      ["product", ...registrations.map(({ id }) => id)].sort(),
    );
    expect(await pathExists(`${fixture.configPath}.lock`)).toBe(false);
  });

  test("reads an empty config file as no Areas, and can still register", async () => {
    const fixture = await setup();
    for (const empty of ["", "# nothing here\n"]) {
      await writeFile(fixture.configPath, empty, "utf8");

      expect(await loadConfig(fixture.configPath)).toEqual({ areas: {} });

      await registerArea(fixture.configPath, "product", fixture.areaRoot);
      expect((await loadConfig(fixture.configPath)).areas.product?.path).toBe(
        fixture.areaRoot,
      );
    }
  });

  test("rejects concurrent registrations of one Area ID at different paths", async () => {
    const fixture = await setup();
    const roots = [
      path.join(fixture.root, "first-shared-area"),
      path.join(fixture.root, "second-shared-area"),
    ];
    await Promise.all(
      roots.map(async (root) => {
        await mkdir(root);
        await writeFile(
          path.join(root, "dokito.yaml"),
          ["version: 1", "id: shared", "name: Shared", ""].join("\n"),
          "utf8",
        );
      }),
    );

    const results = await Promise.allSettled(
      roots.map((target) =>
        registerExistingArea({
          cwd: fixture.root,
          target,
          configPath: fixture.configPath,
        }),
      ),
    );
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      reason: { code: "area_registration_conflict" },
    });
    expect((await loadConfig(fixture.configPath)).areas.shared?.path).toBeOneOf(
      roots,
    );
  });

  test("keeps unavailable and mismatched Areas visible", async () => {
    const fixture = await setup();
    const missingRoot = path.join(fixture.root, "missing-area");
    const mismatchedRoot = path.join(fixture.root, "mismatched-area");
    await mkdir(mismatchedRoot);
    await writeFile(
      path.join(mismatchedRoot, "dokito.yaml"),
      ["version: 1", "id: actual", "name: Actual", ""].join("\n"),
      "utf8",
    );
    await registerArea(fixture.configPath, "archive", missingRoot);
    await registerArea(fixture.configPath, "expected", mismatchedRoot);

    const result = await listAreas({ configPath: fixture.configPath });
    const missing = result.areas.find((area) => area.id === "archive");
    const mismatched = result.areas.find((area) => area.id === "expected");

    expect(missing).toMatchObject({
      id: "archive",
      path: missingRoot,
      available: false,
      error: { code: "directory_not_found" },
    });
    expect(mismatched).toMatchObject({
      id: "expected",
      path: mismatchedRoot,
      available: false,
      error: { code: "area_mismatch" },
    });
    expect(result.warnings).toHaveLength(2);
  });

  test("keeps an Area with an unreadable manifest from hiding healthy Areas", async () => {
    const fixture = await setup();
    const unreadableRoot = path.join(fixture.root, "unreadable-area");
    const manifestPath = path.join(unreadableRoot, "dokito.yaml");
    await mkdir(unreadableRoot);
    await writeFile(
      manifestPath,
      ["version: 1", "id: unreadable", "name: Unreadable", ""].join("\n"),
      "utf8",
    );
    await registerArea(fixture.configPath, "unreadable", unreadableRoot);
    await chmod(manifestPath, 0o000);

    try {
      const result = await listAreas({ configPath: fixture.configPath });

      expect(result.areas).toContainEqual(
        expect.objectContaining({ id: "product", available: true }),
      );
      expect(result.areas).toContainEqual(
        expect.objectContaining({
          id: "unreadable",
          available: false,
          error: expect.objectContaining({ code: "file_unavailable" }),
        }),
      );
      expect(result.warnings).toHaveLength(1);
    } finally {
      await chmod(manifestPath, 0o644);
    }
  });

  test("returns an empty list when no configuration exists", async () => {
    const fixture = await setup();
    const missingConfig = path.join(fixture.root, "empty", "config.yaml");

    expect(await listAreas({ configPath: missingConfig })).toEqual({
      configPath: missingConfig,
      areas: [],
      warnings: [],
    });
  });

  test("counts a single Repository in the singular", async () => {
    const fixture = await setup();
    const root = path.join(fixture.root, "solo-area");
    await mkdir(root, { recursive: true });
    await writeFile(
      path.join(root, "dokito.yaml"),
      "version: 1\nid: solo\nname: Solo\n\nrepositories:\n  only:\n    github: example/only\n",
      "utf8",
    );
    await writeFile(path.join(root, "context.md"), "# Solo\n", "utf8");
    await registerTestArea({
      cwd: fixture.root,
      target: root,
      id: "solo",
      name: "Solo",
      configPath: fixture.configPath,
    });

    const process = Bun.spawn(
      ["bun", "run", dokitoCli, "--config", fixture.configPath, "areas"],
      { cwd: fixture.root, stdout: "pipe", stderr: "pipe" },
    );
    const [exitCode, stdout] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("(1 Repository)");
    expect(stdout).toContain("(3 Repositories)");
  });

  test("lists registered Areas through the JSON CLI from unscoped work", async () => {
    const fixture = await setup();
    const process = Bun.spawn(
      [
        "bun",
        "run",
        dokitoCli,
        "--json",
        "--config",
        fixture.configPath,
        "areas",
      ],
      { cwd: fixture.root, stdout: "pipe", stderr: "pipe" },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    const result = JSON.parse(stdout) as {
      ok: boolean;
      data: {
        configPath: string;
        areas: Array<{
          id: string;
          name: string;
          path: string;
          available: boolean;
          repositoryCount: number;
        }>;
      };
    };

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(result.ok).toBe(true);
    expect(result.data.configPath).toBe(fixture.configPath);
    expect(result.data.areas).toEqual([
      {
        id: "product",
        name: "Product",
        path: fixture.areaRoot,
        available: true,
        repositoryCount: 3,
      },
    ]);
  });

  test("registers an existing Area through the JSON CLI", async () => {
    workspace = await createTestWorkspace();
    const fixture = workspace;
    const process = Bun.spawn(
      [
        "bun",
        "run",
        dokitoCli,
        "--json",
        "--config",
        fixture.configPath,
        "register",
        fixture.areaRoot,
      ],
      { cwd: fixture.root, stdout: "pipe", stderr: "pipe" },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    const result = JSON.parse(stdout) as {
      ok: boolean;
      data: {
        area: string;
        name: string;
        path: string;
        configPath: string;
        changed: boolean;
      };
    };

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      area: "product",
      name: "Product",
      path: fixture.areaRoot,
      configPath: fixture.configPath,
      changed: true,
    });
    expect((await listAreas({ configPath: fixture.configPath })).areas).toEqual(
      [expect.objectContaining({ id: "product", available: true })],
    );
    expect(
      (await loadConfig(fixture.configPath)).areas.product?.repositories[
        "web-app"
      ],
    ).toEqual({ path: "../web-app" });
  });

  test("registers an Area whose ID is an Object prototype property", async () => {
    workspace = await createTestWorkspace();
    const fixture = workspace;
    const manifestPath = path.join(fixture.areaRoot, "dokito.yaml");
    await writeFile(
      manifestPath,
      (await readFile(manifestPath, "utf8")).replace(
        "id: product",
        "id: constructor",
      ),
      "utf8",
    );

    await expect(
      registerExistingArea({
        cwd: fixture.root,
        target: fixture.areaRoot,
        configPath: fixture.configPath,
      }),
    ).resolves.toMatchObject({
      area: "constructor",
      path: fixture.areaRoot,
      changed: true,
    });
    expect(
      (await listAreas({ configPath: fixture.configPath })).areas,
    ).toContainEqual(
      expect.objectContaining({ id: "constructor", available: true }),
    );
  });

  test("makes repeated registration a no-op and rejects an ID collision", async () => {
    const fixture = await setup();
    expect(
      await registerExistingArea({
        cwd: fixture.root,
        target: fixture.areaRoot,
        configPath: fixture.configPath,
      }),
    ).toMatchObject({
      area: "product",
      path: fixture.areaRoot,
      changed: false,
    });

    const conflictingRoot = path.join(fixture.root, "conflicting-area");
    await mkdir(conflictingRoot);
    await writeFile(
      path.join(conflictingRoot, "dokito.yaml"),
      ["version: 1", "id: product", "name: Other Product", ""].join("\n"),
      "utf8",
    );
    await expect(
      registerExistingArea({
        cwd: fixture.root,
        target: conflictingRoot,
        configPath: fixture.configPath,
      }),
    ).rejects.toMatchObject({
      code: "area_registration_conflict",
      details: {
        area: "product",
        registeredPath: fixture.areaRoot,
        requestedPath: conflictingRoot,
      },
    });
  });

  test("prunes local paths for Repositories removed from the manifest", async () => {
    const fixture = await setup();
    const manifestPath = path.join(fixture.areaRoot, "dokito.yaml");
    const manifest = await readFile(manifestPath, "utf8");
    await writeFile(
      manifestPath,
      manifest.replace(
        ["  web-app:", "    github: example/web-app", ""].join("\n"),
        "",
      ),
      "utf8",
    );

    expect(
      (await listAreas({ configPath: fixture.configPath })).areas[0],
    ).toMatchObject({
      id: "product",
      available: false,
      error: { code: "repository_path_invalid" },
    });

    expect(
      await registerExistingArea({
        cwd: fixture.root,
        target: fixture.areaRoot,
        configPath: fixture.configPath,
      }),
    ).toMatchObject({ area: "product", changed: true });
    expect(
      (await loadConfig(fixture.configPath)).areas.product?.repositories,
    ).toEqual({});
    expect(
      (await listAreas({ configPath: fixture.configPath })).areas[0],
    ).toMatchObject({ id: "product", available: true });
    expect(
      await registerExistingArea({
        cwd: fixture.root,
        target: fixture.areaRoot,
        configPath: fixture.configPath,
      }),
    ).toMatchObject({ area: "product", changed: false });
  });

  test("skips an auto-discovered checkout already owned by another Area", async () => {
    const fixture = await setup();
    const secondRoot = path.join(fixture.root, "second-area");
    await mkdir(secondRoot);
    await writeFile(
      path.join(secondRoot, "dokito.yaml"),
      [
        "version: 1",
        "id: second",
        "name: Second",
        "",
        "repositories:",
        "  web-app:",
        "    github: example/web-app",
        "",
      ].join("\n"),
      "utf8",
    );

    await expect(
      registerExistingArea({
        cwd: fixture.root,
        target: secondRoot,
        configPath: fixture.configPath,
      }),
    ).resolves.toMatchObject({ area: "second", changed: true });

    const config = await loadConfig(fixture.configPath);
    expect(config.areas.product?.repositories["web-app"]).toEqual({
      path: "../web-app",
    });
    expect(config.areas.second?.repositories).toEqual({});
    await expect(
      registerExistingArea({
        cwd: fixture.root,
        target: secondRoot,
        configPath: fixture.configPath,
      }),
    ).resolves.toMatchObject({ area: "second", changed: false });
  });
});
