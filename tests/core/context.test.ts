import { afterEach, describe, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { context } from "../../src/core/context";
import { pathExists } from "../../src/core/files";
import { resolveScope } from "../../src/core/scope";
import {
  createTestWorkspace,
  dokitoCli,
  registerTestArea,
  run,
  type TestWorkspace,
  type TestWorkspaceOptions,
} from "../helpers";

describe("Area context", () => {
  let workspace: TestWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
  });

  async function setup(options?: TestWorkspaceOptions): Promise<TestWorkspace> {
    workspace = await createTestWorkspace(options);
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    return workspace;
  }

  test("resolves a nested code directory from its Git remote", async () => {
    const fixture = await setup();
    const scope = await resolveScope({
      cwd: path.join(fixture.codeRoot, "src", "nested"),
      configPath: fixture.configPath,
    });

    expect(scope.area).toBe("product");
    expect(scope.repository).toBe("web-app");
    expect(scope.areaRoot).toBe(fixture.areaRoot);
    expect(scope.codeRoot).toBe(fixture.codeRoot);
    expect(scope.resolution).toBe("git_remote");
  });

  test("resolves an Area directory from dokito.yaml", async () => {
    const fixture = await setup();
    const scope = await resolveScope({
      cwd: path.join(fixture.areaRoot, "resources"),
      configPath: fixture.configPath,
    });

    expect(scope.area).toBe("product");
    expect(scope.repository).toBeUndefined();
    expect(scope.resolution).toBe("area_manifest");
  });

  test("returns context with available Projects, Resources, and Tasks", async () => {
    const fixture = await setup();
    const expected = await readFile(
      path.join(fixture.areaRoot, "context.md"),
      "utf8",
    );
    const before = await run(
      ["git", "status", "--porcelain", "--untracked-files=all"],
      fixture.areaRoot,
    );
    const result = await context({
      cwd: path.join(fixture.areaRoot, "resources"),
      configPath: fixture.configPath,
    });

    expect(result).toMatchObject({
      area: "product",
      areaName: "Product",
      areaRoot: fixture.areaRoot,
      manifestPath: path.join(fixture.areaRoot, "dokito.yaml"),
      contextPath: path.join(fixture.areaRoot, "context.md"),
      resolution: "area_manifest",
    });
    expect(result.repository).toBeUndefined();
    expect(result.codeRoot).toBeUndefined();
    expect(result.context).toBe(expected);
    expect(result.projects).toEqual({
      path: path.join(fixture.areaRoot, "projects"),
      count: 1,
    });
    expect(result.resources).toEqual({
      path: path.join(fixture.areaRoot, "resources"),
      count: 5,
    });
    expect(result.tasks).toEqual({
      path: path.join(fixture.areaRoot, "tasks"),
      count: 2,
    });
    expect(result.warnings).toEqual([]);
    expect(
      await run(
        ["git", "status", "--porcelain", "--untracked-files=all"],
        fixture.areaRoot,
      ),
    ).toBe(before);
  });

  test("returns only context.md content", async () => {
    const fixture = await setup();
    const expected = await readFile(
      path.join(fixture.areaRoot, "context.md"),
      "utf8",
    );
    const before = await run(
      ["git", "status", "--porcelain", "--untracked-files=all"],
      fixture.codeRoot,
    );
    const result = await context({
      cwd: fixture.codeRoot,
      configPath: fixture.configPath,
    });
    const after = await run(
      ["git", "status", "--porcelain", "--untracked-files=all"],
      fixture.codeRoot,
    );

    expect(result.context).toBe(expected);
    expect(result.context).not.toContain("Small teams");
    expect(result.context).not.toContain("Revise the privacy notice");
    expect(result.context).not.toContain("release is verified");
    expect(before).toBe("");
    expect(after).toBe(before);
    expect(await pathExists(path.join(fixture.codeRoot, ".dokito"))).toBe(
      false,
    );
  });

  test("writes feature information and context to standard output", async () => {
    const fixture = await setup();
    const expected = await readFile(
      path.join(fixture.areaRoot, "context.md"),
      "utf8",
    );
    const process = Bun.spawn(
      [
        "bun",
        "run",
        dokitoCli,
        "--config",
        fixture.configPath,
        "--cwd",
        fixture.codeRoot,
        "context",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe(
      [
        `Area: product  ${fixture.areaRoot}`,
        "Repository: web-app",
        `Projects: 1  ${path.join(fixture.areaRoot, "projects")}`,
        `Resources: 5  ${path.join(fixture.areaRoot, "resources")}`,
        `Tasks: 2  ${path.join(fixture.areaRoot, "tasks")}`,
        "",
        expected,
      ].join("\n"),
    );
  });

  test("writes only context.md with --raw", async () => {
    const fixture = await setup();
    const expected = await readFile(
      path.join(fixture.areaRoot, "context.md"),
      "utf8",
    );
    const process = Bun.spawn(
      [
        "bun",
        "run",
        dokitoCli,
        "--config",
        fixture.configPath,
        "--cwd",
        fixture.codeRoot,
        "context",
        "--raw",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe(expected);
  });

  test("returns feature information, warnings, and context as JSON", async () => {
    const fixture = await setup();
    const expected = await readFile(
      path.join(fixture.areaRoot, "context.md"),
      "utf8",
    );
    const process = Bun.spawn(
      [
        "bun",
        "run",
        dokitoCli,
        "--json",
        "--config",
        fixture.configPath,
        "--cwd",
        fixture.codeRoot,
        "context",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      ok: true,
      data: {
        area: "product",
        areaName: "Product",
        areaRoot: fixture.areaRoot,
        manifestPath: path.join(fixture.areaRoot, "dokito.yaml"),
        contextPath: path.join(fixture.areaRoot, "context.md"),
        repository: "web-app",
        codeRoot: fixture.codeRoot,
        resolution: "git_remote",
        context: expected,
        projects: {
          path: path.join(fixture.areaRoot, "projects"),
          count: 1,
        },
        resources: {
          path: path.join(fixture.areaRoot, "resources"),
          count: 5,
        },
        tasks: {
          path: path.join(fixture.areaRoot, "tasks"),
          count: 2,
        },
        warnings: [],
      },
    });
  });

  test("fails oversized context without changing the worktree", async () => {
    const fixture = await setup();
    await writeFile(
      path.join(fixture.areaRoot, "context.md"),
      "x".repeat(101),
      "utf8",
    );
    const before = await run(
      ["git", "status", "--porcelain", "--untracked-files=all"],
      fixture.codeRoot,
    );

    await expect(
      context({
        cwd: fixture.codeRoot,
        configPath: fixture.configPath,
        maxBytes: 100,
      }),
    ).rejects.toMatchObject({
      code: "context_too_large",
      details: { path: "context.md", bytes: 101, maxBytes: 100 },
    });

    expect(
      await run(
        ["git", "status", "--porcelain", "--untracked-files=all"],
        fixture.codeRoot,
      ),
    ).toBe(before);
  });

  test("fails clearly when context.md is missing", async () => {
    const fixture = await setup();
    await rm(path.join(fixture.areaRoot, "context.md"));

    await expect(
      context({
        cwd: fixture.codeRoot,
        configPath: fixture.configPath,
      }),
    ).rejects.toMatchObject({
      code: "source_not_found",
      details: { path: "context.md" },
    });
  });

  test("rejects combining --raw with --json", async () => {
    const fixture = await setup();
    const process = Bun.spawn(
      [
        "bun",
        "run",
        dokitoCli,
        "--json",
        "--config",
        fixture.configPath,
        "--cwd",
        fixture.codeRoot,
        "context",
        "--raw",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    const result = JSON.parse(stdout) as {
      ok: boolean;
      error: { code: string };
    };

    expect(exitCode).toBe(1);
    expect(stderr).toBe("");
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("invalid_usage");
  });

  test("returns global argument errors as JSON", async () => {
    const process = Bun.spawn(["bun", "run", dokitoCli, "--json", "--config"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout) as {
      ok: boolean;
      error: { code: string };
    };
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("invalid_usage");
  });
});
