import { afterEach, describe, expect, test } from "bun:test";
import { loadAreaManifest, loadProjects } from "../../src/core/manifests";
import { listAreaTasks } from "../../src/core/tasks";
import {
  createTestWorkspace,
  registerTestArea,
  type TestWorkspace,
} from "../helpers";

describe("Tasks", () => {
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

  async function taskInput(fixture: TestWorkspace) {
    const areaManifest = await loadAreaManifest(fixture.areaRoot);
    return {
      areaRoot: fixture.areaRoot,
      areaManifest,
      projects: await loadProjects(
        fixture.areaRoot,
        new Set(Object.keys(areaManifest.repositories)),
      ),
      repository: "web-app",
    };
  }

  test("lists Repository-related local Tasks", async () => {
    const fixture = await setup();
    const result = await listAreaTasks(await taskInput(fixture));

    expect(result.area).toBe("product");
    expect(result.repository).toBe("web-app");
    expect(result.status).toBe("open");
    expect(result.localTasks.map((task) => task.title)).toEqual([
      "Coordinate the product launch",
      "Revise the privacy notice",
    ]);
    expect(result.localTasks[0]?.assignee).toBe("Launch Agent");
    expect(result.warnings).toEqual([]);
  });

  test("filters by a concrete Task status", async () => {
    const fixture = await setup();
    const result = await listAreaTasks({
      ...(await taskInput(fixture)),
      status: "todo",
    });

    expect(result.localTasks.map((task) => task.status)).toEqual(["todo"]);
  });
});
