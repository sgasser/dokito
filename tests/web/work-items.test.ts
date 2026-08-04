import { afterEach, describe, expect, test } from "bun:test";
import { loadConfig, registerArea } from "../../src/core/config";
import { loadAreaManifest, loadProjects } from "../../src/core/manifests";
import { loadTasksView } from "../../src/web/data";
import { loadWorkArea } from "../../src/web/data/areas";
import {
  conductorAvailable,
  enrichWebWorkItem,
} from "../../src/web/work-items";
import {
  createTestWorkspace,
  registerTestArea,
  type TestWorkspace,
} from "../helpers";

describe("Web work items", () => {
  let workspace: TestWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
  });

  test("offers Conductor only from an installed macOS app", async () => {
    expect(await conductorAvailable("linux", async () => true)).toBe(false);
    expect(await conductorAvailable("win32", async () => true)).toBe(false);
    expect(await conductorAvailable("darwin", async () => false)).toBe(false);
    expect(await conductorAvailable("darwin", async () => true)).toBe(true);
  });

  test("does not infer a local checkout that registration has not stored", async () => {
    workspace = await createTestWorkspace();
    await registerArea(workspace.configPath, "product", workspace.areaRoot);
    const manifest = await loadAreaManifest(workspace.areaRoot);
    const area = await loadWorkArea({
      area: { root: workspace.areaRoot, manifest },
      config: await loadConfig(workspace.configPath),
      projects: await loadProjects(
        workspace.areaRoot,
        new Set(Object.keys(manifest.repositories)),
      ),
    });

    expect(area.repositories.find(({ id }) => id === "web-app")).toEqual({
      id: "web-app",
      github: "example/web-app",
      url: "https://github.com/example/web-app",
    });
  });

  test("hands a selected Task to Conductor", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });

    const data = await loadTasksView({
      configPath: workspace.configPath,
    });
    const taskItem = data.items.find(
      (item) => item.title === "Revise the privacy notice",
    );

    expect(data.items).toHaveLength(2);
    expect(taskItem?.action).toBeUndefined();
    if (!taskItem) {
      throw new Error("Expected the local Task.");
    }

    const detailInput = {
      areaId: "product",
      areaName: "Product",
      projects: [],
      repositories: [
        {
          id: "web-app",
          localPath: workspace.codeRoot,
          github: "example/web-app",
        },
      ],
      localTasks: [],
    };
    const selected = await enrichWebWorkItem(
      { ...detailInput, conductorAvailable: true },
      taskItem,
    );
    const actionUrl = decodeURIComponent(selected.action?.url ?? "");

    expect(selected.action?.kind).toBe("conductor");
    expect(selected.action?.url).toContain(
      encodeURIComponent(workspace.codeRoot),
    );
    expect(actionUrl).toContain(`Task file: ${taskItem.task.relativePath}`);
    expect(actionUrl).toContain("follow the installed Dokito skill");
    expect(actionUrl).toContain("Run `dokito context`");
    expect(actionUrl).not.toContain("--json");
    expect(
      (
        await enrichWebWorkItem(
          { ...detailInput, conductorAvailable: false },
          taskItem,
        )
      ).action,
    ).toBeUndefined();
    expect(
      (
        await enrichWebWorkItem(
          {
            ...detailInput,
            repositories: [
              {
                id: "web-app",
                localPath: workspace.codeRoot,
                github: "other/web-app",
              },
            ],
            conductorAvailable: true,
          },
          taskItem,
        )
      ).action,
    ).toBeUndefined();
  });
});
