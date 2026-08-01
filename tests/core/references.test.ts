import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveReference } from "../../src/core/resolve";
import { validateArea } from "../../src/core/validate";
import {
  addTestArea,
  createTestWorkspace,
  registerTestArea,
  type TestWorkspace,
} from "../helpers";

let workspace: TestWorkspace | undefined;

async function setup(): Promise<TestWorkspace> {
  const fixture = await createTestWorkspace();
  workspace = fixture;
  await registerTestArea({
    cwd: fixture.root,
    target: fixture.areaRoot,
    id: "product",
    name: "Product",
    configPath: fixture.configPath,
  });
  return fixture;
}

async function writeTask(
  fixture: TestWorkspace,
  body: string,
): Promise<string> {
  const relativePath = path.join(
    "tasks",
    "01K1ABCXYZ0000000000000000-coordinate-launch.md",
  );
  await writeFile(
    path.join(fixture.areaRoot, relativePath),
    [
      "---",
      "status: todo",
      "---",
      "",
      "# Coordinate the launch",
      "",
      body,
      "",
    ].join("\n"),
    "utf8",
  );
  return relativePath;
}

async function warningsOf(
  fixture: TestWorkspace,
  links = false,
): Promise<string[]> {
  const result = await validateArea({
    cwd: fixture.areaRoot,
    configPath: fixture.configPath,
    links,
  });
  return result.warnings;
}

afterEach(async () => {
  await workspace?.cleanup();
  workspace = undefined;
});

describe("Link warnings", () => {
  test("reports a relative link and names the form to write", async () => {
    const fixture = await setup();
    await writeTask(
      fixture,
      "See [Architecture](../resources/architecture.md).",
    );

    expect(await warningsOf(fixture)).toContain(
      "tasks/01K1ABCXYZ0000000000000000-coordinate-launch.md has relative document link '../resources/architecture.md'; links are written as filenames. Write 'architecture' instead.",
    );
  });

  test("leaves a relative target that is not a document alone", async () => {
    const fixture = await setup();
    await writeTask(fixture, "See [data](../assets/export.csv).");

    expect(
      (await warningsOf(fixture)).filter((entry) =>
        entry.includes("export.csv"),
      ),
    ).toEqual([]);
  });

  /**
   * Picking one of several same-named documents silently is the behaviour being
   * replaced, so the warning has to name the duplicates rather than the link.
   */
  test("reports an ambiguous filename instead of picking one", async () => {
    const fixture = await setup();
    for (const folder of ["platform", "billing"]) {
      await mkdir(path.join(fixture.areaRoot, "resources", folder), {
        recursive: true,
      });
      await writeFile(
        path.join(fixture.areaRoot, "resources", folder, "overview.md"),
        `# ${folder}\n`,
        "utf8",
      );
    }
    await writeTask(fixture, "See [[overview]].");

    const warning = (await warningsOf(fixture)).find((entry) =>
      entry.includes("ambiguous"),
    );
    expect(warning).toContain("'resources/billing/overview.md'");
    expect(warning).toContain("'resources/platform/overview.md'");
    expect(warning).toContain("unique in the Area");
  });

  test("resolves a filename from the writer's own folder", async () => {
    const fixture = await setup();
    for (const folder of ["platform", "billing"]) {
      await mkdir(path.join(fixture.areaRoot, "resources", folder), {
        recursive: true,
      });
      await writeFile(
        path.join(fixture.areaRoot, "resources", folder, "overview.md"),
        `# ${folder}\n`,
        "utf8",
      );
    }
    await writeFile(
      path.join(fixture.areaRoot, "resources", "platform", "queues.md"),
      "# Queues\n\nSee [[overview]].\n",
      "utf8",
    );

    expect(
      (await warningsOf(fixture)).filter((entry) => entry.includes("overview")),
    ).toEqual([]);
  });

  test("reports a Repository the manifest does not register", async () => {
    const fixture = await setup();
    await writeTask(fixture, "See [[repo:unknown-app/README.md]].");

    expect(await warningsOf(fixture)).toContain(
      "tasks/01K1ABCXYZ0000000000000000-coordinate-launch.md links to Repository 'unknown-app', which dokito.yaml does not register.",
    );
  });

  /**
   * Whether a checkout is on this machine says nothing about the Area, so the
   * default pass must read the same for everyone the Area is shared with.
   */
  test("checks a Repository file only under --links", async () => {
    const fixture = await setup();
    await writeTask(fixture, "See [[repo:web-app/missing.md]].");

    expect(
      (await warningsOf(fixture)).filter((entry) => entry.includes("web-app")),
    ).toEqual([]);
    expect(
      (await warningsOf(fixture, true)).some(
        (entry) =>
          entry.includes("repo:web-app/missing.md") &&
          entry.includes("names no file"),
      ),
    ).toBe(true);
  });

  test("accepts a Repository file that exists", async () => {
    const fixture = await setup();
    await writeTask(fixture, "See [[repo:web-app/README.md]].");

    expect(
      (await warningsOf(fixture, true)).filter((entry) =>
        entry.includes("web-app"),
      ),
    ).toEqual([]);
  });

  test("says where a name lives when --links looks past the Area", async () => {
    const fixture = await setup();
    const writingRoot = await addTestArea(fixture);
    await writeTask(fixture, "See [[house style]].");
    await mkdir(path.join(writingRoot, "resources"), { recursive: true });
    await writeFile(
      path.join(writingRoot, "resources", "house style.md"),
      "# House style\n",
      "utf8",
    );

    expect(
      (await warningsOf(fixture, true)).some((entry) =>
        entry.includes("an Area links only within itself"),
      ),
    ).toBe(true);
  });
});

describe("dokito resolve", () => {
  test("returns every Area that holds the name, the current one first", async () => {
    const fixture = await setup();
    const writingRoot = await addTestArea(fixture);
    await mkdir(path.join(writingRoot, "resources"), { recursive: true });
    await writeFile(
      path.join(writingRoot, "resources", "architecture.md"),
      "# Architecture\n",
      "utf8",
    );

    const result = await resolveReference({
      cwd: writingRoot,
      configPath: fixture.configPath,
      reference: "architecture",
    });

    expect(result.area).toBe("writing");
    expect(result.matches.map((match) => match.area)).toEqual([
      "writing",
      "product",
    ]);
    expect(result.matches[0]?.path).toBe(
      path.join(writingRoot, "resources", "architecture.md"),
    );
  });

  test("resolves a Repository and a file inside it", async () => {
    const fixture = await setup();

    const repository = await resolveReference({
      cwd: fixture.areaRoot,
      configPath: fixture.configPath,
      reference: "repo:web-app",
    });
    expect(repository.matches[0]).toMatchObject({
      kind: "repository",
      repository: "web-app",
      path: fixture.codeRoot,
      exists: true,
    });

    const file = await resolveReference({
      cwd: fixture.areaRoot,
      configPath: fixture.configPath,
      reference: "repo:web-app/README.md",
    });
    expect(file.matches[0]?.path).toBe(
      path.join(fixture.codeRoot, "README.md"),
    );
  });

  test("resolves a Project and a Task by identity", async () => {
    const fixture = await setup();

    expect(
      (
        await resolveReference({
          cwd: fixture.areaRoot,
          configPath: fixture.configPath,
          reference: "project:launch",
        })
      ).matches[0]?.relativePath,
    ).toBe("projects/launch.md");
    expect(
      (
        await resolveReference({
          cwd: fixture.areaRoot,
          configPath: fixture.configPath,
          reference: "task:01K1ABCXYZ0000000000000000",
        })
      ).matches[0]?.relativePath,
    ).toBe("tasks/01K1ABCXYZ0000000000000000-coordinate-launch.md");
  });

  test("separates an unknown name from a malformed one", async () => {
    const fixture = await setup();

    await expect(
      resolveReference({
        cwd: fixture.areaRoot,
        configPath: fixture.configPath,
        reference: "nothing-of-that-name",
      }),
    ).rejects.toMatchObject({ code: "reference_not_found" });
    await expect(
      resolveReference({
        cwd: fixture.areaRoot,
        configPath: fixture.configPath,
        reference: "task:not-a-ulid",
      }),
    ).rejects.toMatchObject({ code: "reference_invalid" });
  });

  /**
   * A Repository the Area registers but this machine has not checked out is a
   * fact about the machine. It earns its own code so a caller can tell it apart
   * from a name nobody knows, and the Area stays valid either way.
   */
  test("reports a registered Repository with no checkout here", async () => {
    const fixture = await createTestWorkspace({
      remotes: [{ name: "origin", url: "git@github.com:example/other.git" }],
    });
    workspace = fixture;
    await registerTestArea({
      cwd: fixture.root,
      target: fixture.areaRoot,
      id: "product",
      name: "Product",
      configPath: fixture.configPath,
    });

    await expect(
      resolveReference({
        cwd: fixture.areaRoot,
        configPath: fixture.configPath,
        reference: "repo:web-app",
      }),
    ).rejects.toMatchObject({ code: "repository_not_local" });

    await writeFile(
      path.join(
        fixture.areaRoot,
        "tasks",
        "01K1ABCXYZ0000000000000000-coordinate-launch.md",
      ),
      "---\nstatus: todo\n---\n\n# Coordinate\n\nSee [[repo:web-app]].\n",
      "utf8",
    );
    const result = await validateArea({
      cwd: fixture.areaRoot,
      configPath: fixture.configPath,
      links: true,
    });
    expect(
      result.warnings.some((entry) =>
        entry.includes("has no local checkout on this machine"),
      ),
    ).toBe(true);
  });
});
