import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  loadAreaManifest,
  loadProject,
  loadTasks,
} from "../../src/core/manifests";

const fixturesRoot = path.resolve(import.meta.dir, "..", "fixtures");

describe("Fixture contracts", () => {
  test("loads the Area fixture", async () => {
    const areaRoot = path.join(fixturesRoot, "product-area");
    const area = await loadAreaManifest(areaRoot);
    const repositories = new Set(Object.keys(area.repositories));
    const project = await loadProject(areaRoot, "launch", repositories);
    const tasks = await loadTasks(areaRoot, repositories);
    expect(area.id).toBe("product");
    expect(project.repositories).toContain("web-app");
    expect(tasks.tasks).toHaveLength(2);
    expect(tasks.problems).toEqual([]);
  });
});
