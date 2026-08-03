import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { context } from "../../src/core/context";
import { DokitoError } from "../../src/core/error";
import { listAreaFiles } from "../../src/core/files";
import {
  loadAreaManifest,
  loadProject,
  loadTasks,
} from "../../src/core/manifests";
import { validateArea } from "../../src/core/validate";
import {
  createTestWorkspace,
  registerTestArea,
  type TestWorkspace,
} from "../helpers";

describe("Document metadata", () => {
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

  async function repositories(fixture: TestWorkspace): Promise<Set<string>> {
    const area = await loadAreaManifest(fixture.areaRoot);
    return new Set(Object.keys(area.repositories));
  }

  test("reports size and modification time for every Markdown file", async () => {
    const fixture = await setup();
    const files = await listAreaFiles(fixture.areaRoot);
    const area = files.find((file) => file.path === "context.md");

    expect(area).toBeDefined();
    expect(area?.bytes).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(area?.modifiedAt ?? ""))).toBe(false);
    expect(files.map((file) => file.path)).toContain("resources/product.md");
  });

  /**
   * `resources/` holds notes, not a build tree. Skipping folders named after
   * build output there hid a Resource from the inventory, the Web view and the
   * link check at once, and said nothing about it.
   */
  test("keeps Resources in folders named after build output", async () => {
    const fixture = await setup();
    for (const folder of ["app", "coverage", "dist"]) {
      await mkdir(path.join(fixture.areaRoot, "resources", folder), {
        recursive: true,
      });
      await writeFile(
        path.join(fixture.areaRoot, "resources", folder, "note.md"),
        `# A note under ${folder}\n`,
        "utf8",
      );
    }
    const paths = (await listAreaFiles(fixture.areaRoot)).map(
      (file) => file.path,
    );

    expect(paths).toContain("resources/app/note.md");
    expect(paths).toContain("resources/coverage/note.md");
    expect(paths).toContain("resources/dist/note.md");
  });

  test("still skips a checkout that sits inside Resources", async () => {
    const fixture = await setup();
    await mkdir(path.join(fixture.areaRoot, "resources", "node_modules"), {
      recursive: true,
    });
    await writeFile(
      path.join(fixture.areaRoot, "resources", "node_modules", "readme.md"),
      "# Vendored\n",
      "utf8",
    );
    const paths = (await listAreaFiles(fixture.areaRoot)).map(
      (file) => file.path,
    );

    expect(paths).not.toContain("resources/node_modules/readme.md");
  });

  test("reads a Project outcome and note from its prose", async () => {
    const fixture = await setup();
    const project = await loadProject(
      fixture.areaRoot,
      "launch",
      await repositories(fixture),
    );

    expect(project.outcome).toBe(
      "The Web app is available and the release is verified.",
    );
    expect(project.note).toBe(
      "Customer documentation must match the implemented behavior.",
    );
    expect(project.due).toBeUndefined();
  });

  test("accepts a due date on a Project", async () => {
    const fixture = await setup();
    await writeFile(
      path.join(fixture.areaRoot, "projects", "launch.md"),
      [
        "---",
        "status: active",
        'due: "2026-08-12"',
        "---",
        "",
        "# Launch the product",
        "",
        "Outcome: The release is verified.",
      ].join("\n"),
      "utf8",
    );

    const project = await loadProject(
      fixture.areaRoot,
      "launch",
      await repositories(fixture),
    );

    expect(project.due).toBe("2026-08-12");
    expect(project.outcome).toBe("The release is verified.");
  });

  test("rejects an invalid Project due date", async () => {
    const fixture = await setup();
    await writeFile(
      path.join(fixture.areaRoot, "projects", "launch.md"),
      [
        "---",
        "status: active",
        'due: "2026-02-31"',
        "---",
        "",
        "# Launch the product",
      ].join("\n"),
      "utf8",
    );

    const failure = await loadProject(
      fixture.areaRoot,
      "launch",
      await repositories(fixture),
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DokitoError);
    expect((failure as DokitoError).code).toBe("project_invalid");
  });

  test("reads a Task description from its prose", async () => {
    const fixture = await setup();
    const { tasks } = await loadTasks(
      fixture.areaRoot,
      await repositories(fixture),
    );
    const task = tasks.find((candidate) => candidate.project === "launch");

    expect(task?.description).toBe(
      "Verify the release across the Web app, API, and website.",
    );
    expect(task?.assignee).toBe("Launch Agent");
  });

  test("rejects an empty or multiline Task assignee", async () => {
    const fixture = await setup();
    const taskPath = path.join(
      fixture.areaRoot,
      "tasks",
      "01K1ABCXYZ0000000000000000-coordinate-launch.md",
    );
    const content = await readFile(taskPath, "utf8");
    for (const invalid of ['""', "|-\n  Launch\n  Agent"]) {
      await writeFile(
        taskPath,
        content.replace('assignee: "Launch Agent"', `assignee: ${invalid}`),
        "utf8",
      );

      const { tasks, problems } = await loadTasks(
        fixture.areaRoot,
        await repositories(fixture),
      );

      expect(tasks.map((task) => task.relativePath)).not.toContain(
        "tasks/01K1ABCXYZ0000000000000000-coordinate-launch.md",
      );
      expect(problems).toMatchObject([
        {
          path: "tasks/01K1ABCXYZ0000000000000000-coordinate-launch.md",
          error: { code: "task_invalid" },
        },
      ]);
    }
  });

  test("rejects duplicate Task IDs", async () => {
    const fixture = await setup();
    const id = "01K1ABCXYZ0000000000000000";
    const originalPath = `tasks/${id}-coordinate-launch.md`;
    const duplicatePath = `tasks/${id}-duplicate.md`;
    await writeFile(
      path.join(fixture.areaRoot, duplicatePath),
      await readFile(path.join(fixture.areaRoot, originalPath), "utf8"),
      "utf8",
    );

    const { tasks, problems } = await loadTasks(
      fixture.areaRoot,
      await repositories(fixture),
    );

    // The duplicate is named, keeps its details, and the Task that owned the
    // ID first stays readable.
    expect(problems).toMatchObject([
      {
        path: duplicatePath,
        error: {
          code: "task_invalid",
          details: { id, paths: [originalPath, duplicatePath] },
        },
      },
    ]);
    expect(tasks.map((task) => task.relativePath)).toContain(originalPath);
  });

  /*
   * The slug is required, not decoration. An agent following the bundled skill
   * generates the ULID with `dokito id` and names the file itself, so the rule
   * and the message that reports it are the contract that keeps it from
   * invalidating the whole Area.
   */
  test("rejects a Task filename without a title slug", async () => {
    const fixture = await setup();
    const filename = "01K1ABCXYZ0000000000000000.md";
    await writeFile(
      path.join(fixture.areaRoot, "tasks", filename),
      "---\nstatus: todo\n---\n\n# Revise\n\nText.\n",
      "utf8",
    );

    const { problems } = await loadTasks(
      fixture.areaRoot,
      await repositories(fixture),
    );

    expect(problems).toMatchObject([
      { path: `tasks/${filename}`, error: { code: "task_invalid" } },
    ]);
    expect(problems[0]?.error.message).toContain(
      "<26-character ULID>-<lowercase slug>.md",
    );
  });

  for (const { collection, label, count, code } of [
    {
      collection: "projects",
      label: "Project",
      count: 1,
      code: "project_invalid",
    },
    {
      collection: "tasks",
      label: "Task",
      count: 2,
      code: "task_invalid",
    },
  ] as const) {
    test(`rejects nested ${label} documents without counting them`, async () => {
      const fixture = await setup();
      const nested = path.join(fixture.areaRoot, collection, "nested");
      await mkdir(nested);
      await writeFile(
        path.join(nested, `${label.toLowerCase()}.md`),
        "# Nested\n",
        "utf8",
      );

      const result = await context({
        cwd: fixture.areaRoot,
        configPath: fixture.configPath,
      });
      expect(result[collection].count).toBe(count);
      await expect(
        validateArea({
          cwd: fixture.areaRoot,
          configPath: fixture.configPath,
        }),
      ).rejects.toMatchObject({ code });
    });
  }
});
