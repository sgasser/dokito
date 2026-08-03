import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { registerArea } from "../../src/core/config";
import {
  listRegisteredProjects,
  listRegisteredTasks,
  summarizeRegisteredProjects,
  summarizeRegisteredTasks,
} from "../../src/core/inventory";
import {
  createTestWorkspace,
  dokitoCli,
  registerTestArea,
  type TestWorkspace,
} from "../helpers";

describe("Global work inventory", () => {
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

    const personalRoot = path.join(workspace.root, "personal-area");
    await cp(
      path.join(import.meta.dir, "..", "fixtures", "product-area"),
      personalRoot,
      {
        recursive: true,
      },
    );
    const replace = async (relativePath: string, from: string, to: string) => {
      const target = path.join(personalRoot, relativePath);
      await writeFile(
        target,
        (await readFile(target, "utf8")).replace(from, to),
        "utf8",
      );
    };
    await replace("dokito.yaml", "id: product", "id: personal");
    await replace("dokito.yaml", "name: Product", "name: Personal");
    await replace("projects/launch.md", "status: active", "status: done");
    await replace(
      "tasks/01K1ABDXYZ0000000000000000-revise-privacy-notice.md",
      "status: todo",
      "status: done",
    );
    await registerArea(workspace.configPath, "personal", personalRoot);
    return workspace;
  }

  test("lists every Project and local Task across registered Areas", async () => {
    const fixture = await setup();

    const projects = await listRegisteredProjects({
      configPath: fixture.configPath,
    });
    const tasks = await listRegisteredTasks({
      configPath: fixture.configPath,
    });

    expect(projects).toMatchObject({ areaCount: 2, warnings: [] });
    expect(
      projects.projects.map(
        (project) => `${project.area}:${project.status}:${project.id}`,
      ),
    ).toEqual(["product:active:launch", "personal:done:launch"]);
    expect(projects.projects[0]).not.toHaveProperty("content");

    expect(tasks).toMatchObject({ areaCount: 2, warnings: [] });
    expect(tasks.tasks.map((task) => `${task.area}:${task.status}`)).toEqual([
      "personal:in_progress",
      "product:in_progress",
      "product:todo",
      "personal:done",
    ]);
    expect(tasks.tasks.find((task) => task.area === "product")?.assignee).toBe(
      "Launch Agent",
    );
    expect(tasks.tasks[0]).not.toHaveProperty("content");
  });

  /**
   * The counts are what an overview asks for, so they have to be answerable
   * without emitting every item. Statuses nothing uses stay in the reading, or
   * a caller cannot tell an empty status from a renamed one.
   */
  test("counts Projects and Tasks by status and Area", async () => {
    const fixture = await setup();

    await expect(
      summarizeRegisteredProjects({ configPath: fixture.configPath }),
    ).resolves.toEqual({
      configPath: fixture.configPath,
      areaCount: 2,
      total: 2,
      byStatus: { planned: 0, active: 1, done: 1, cancelled: 0 },
      byArea: { product: 1, personal: 1 },
      warnings: [],
    });

    await expect(
      summarizeRegisteredTasks({ configPath: fixture.configPath }),
    ).resolves.toEqual({
      configPath: fixture.configPath,
      areaCount: 2,
      total: 4,
      byStatus: {
        todo: 1,
        in_progress: 2,
        waiting: 0,
        someday: 0,
        done: 1,
        cancelled: 0,
      },
      byArea: { product: 2, personal: 2 },
      warnings: [],
    });
  });

  test("keeps readable Areas when other registrations fail", async () => {
    const fixture = await setup();
    const brokenRoot = path.join(fixture.root, "broken-area");
    await mkdir(path.join(brokenRoot, "projects"), { recursive: true });
    await writeFile(
      path.join(brokenRoot, "dokito.yaml"),
      "version: 1\nid: broken\nname: Broken\n",
      "utf8",
    );
    await writeFile(
      path.join(brokenRoot, "projects", "invalid.md"),
      "---\nstatus: invalid\n---\n\n# Invalid\n",
      "utf8",
    );
    await registerArea(fixture.configPath, "broken", brokenRoot);
    await registerArea(
      fixture.configPath,
      "missing",
      path.join(fixture.root, "missing-area"),
    );

    const result = await listRegisteredProjects({
      configPath: fixture.configPath,
    });

    // 'broken' holds one unreadable Project and nothing else, so it
    // contributes no Projects — but it still counts as read, because the file
    // failed, not the Area. Only 'missing' is skipped entirely.
    expect(result.projects).toHaveLength(2);
    expect(result.areaCount).toBe(3);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.join("\n")).toContain(
      "Skipped registered Area 'missing'",
    );
    expect(result.warnings.join("\n")).toContain(
      "Skipped projects/invalid.md in Area 'broken'",
    );

    // The counts read the same registry: 'broken' contributes a zero it was
    // read for, 'missing' contributes nothing because it was never read.
    const summary = await summarizeRegisteredProjects({
      configPath: fixture.configPath,
    });
    expect(summary.total).toBe(2);
    expect(summary.byArea).toEqual({ product: 1, personal: 1, broken: 0 });
    expect(summary.warnings).toEqual(result.warnings);
  });

  test("works through the CLI from unscoped and empty workspaces", async () => {
    const fixture = await setup();
    const jsonProcess = Bun.spawn(
      [
        "bun",
        "run",
        dokitoCli,
        "--json",
        "--config",
        fixture.configPath,
        "projects",
      ],
      { cwd: fixture.root, stdout: "pipe", stderr: "pipe" },
    );
    const humanProcess = Bun.spawn(
      ["bun", "run", dokitoCli, "--config", fixture.configPath, "tasks"],
      { cwd: fixture.root, stdout: "pipe", stderr: "pipe" },
    );
    const [
      jsonExit,
      jsonOutput,
      jsonError,
      humanExit,
      humanOutput,
      humanError,
    ] = await Promise.all([
      jsonProcess.exited,
      new Response(jsonProcess.stdout).text(),
      new Response(jsonProcess.stderr).text(),
      humanProcess.exited,
      new Response(humanProcess.stdout).text(),
      new Response(humanProcess.stderr).text(),
    ]);

    expect(jsonExit).toBe(0);
    expect(jsonError).toBe("");
    expect(JSON.parse(jsonOutput)).toMatchObject({
      ok: true,
      data: { areaCount: 2, warnings: [] },
    });
    expect(humanExit).toBe(0);
    expect(humanError).toBe("");
    expect(humanOutput).toContain("Tasks: 4 across 2 Areas");
    expect(humanOutput).toContain("assignee Launch Agent");

    const configPath = path.join(fixture.root, "empty", "config.yaml");
    await expect(listRegisteredProjects({ configPath })).resolves.toEqual({
      configPath,
      areaCount: 0,
      projects: [],
      warnings: [],
    });
  });

  test("answers an overview through --summary without the items", async () => {
    const fixture = await setup();
    const spawn = (args: string[]) =>
      Bun.spawn(
        ["bun", "run", dokitoCli, "--config", fixture.configPath, ...args],
        {
          cwd: fixture.root,
          stdout: "pipe",
          stderr: "pipe",
        },
      );
    const jsonProcess = spawn(["--json", "projects", "--summary"]);
    const humanProcess = spawn(["tasks", "--summary"]);
    const [jsonExit, jsonOutput, humanExit, humanOutput] = await Promise.all([
      jsonProcess.exited,
      new Response(jsonProcess.stdout).text(),
      humanProcess.exited,
      new Response(humanProcess.stdout).text(),
    ]);

    expect(jsonExit).toBe(0);
    const parsed = JSON.parse(jsonOutput);
    expect(parsed.data).toMatchObject({
      areaCount: 2,
      total: 2,
      byStatus: { planned: 0, active: 1, done: 1, cancelled: 0 },
      byArea: { product: 1, personal: 1 },
      warnings: [],
    });
    expect(parsed.data).not.toHaveProperty("projects");

    expect(humanExit).toBe(0);
    expect(humanOutput).toContain("Tasks: 4 across 2 Areas");
    expect(humanOutput).toContain(
      "Status: todo 1, in_progress 2, waiting 0, someday 0, done 1, cancelled 0",
    );
    // Areas keep the registry's stable ID order, so the line is reproducible.
    expect(humanOutput).toContain("Areas: personal 2, product 2");
  });
});
