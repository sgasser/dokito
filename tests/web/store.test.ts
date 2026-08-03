import { afterEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { listAreaFiles, readAreaFile } from "../../src/core/files";
import { WorkspaceStore } from "../../src/web/data/snapshot";
import { requireArea } from "../../src/web/data/workspace";
import { createWebRequestHandler } from "../../src/web/server";
import {
  createTestWorkspace,
  registerTestArea,
  type TestWorkspace,
} from "../helpers";

describe("WorkspaceStore", () => {
  let workspace: TestWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
  });

  async function setup(): Promise<{
    store: WorkspaceStore;
    workspace: TestWorkspace;
  }> {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    return {
      store: new WorkspaceStore(workspace.configPath),
      workspace,
    };
  }

  test("shares products within one request and reloads them on the next", async () => {
    const fixture = await setup();
    let inventories = 0;
    const store = new WorkspaceStore(fixture.workspace.configPath, {
      inventory: async (areaRoot) => {
        inventories += 1;
        return listAreaFiles(areaRoot);
      },
    });
    const first = await store.snapshot({ area: "product" });
    const firstArea = requireArea(first.scope);
    const [firstDocuments, firstRelations, firstProjects, firstTasks] =
      await Promise.all([
        first.documents(firstArea),
        first.relations(firstArea),
        first.projects(firstArea),
        first.tasks(firstArea),
      ]);

    expect(await first.documents(firstArea)).toBe(firstDocuments);
    expect(await first.relations(firstArea)).toBe(firstRelations);
    expect(await first.projects(firstArea)).toBe(firstProjects);
    expect(await first.tasks(firstArea)).toBe(firstTasks);
    expect(firstTasks.every((task) => !("content" in task))).toBeTrue();
    expect(
      (await first.task(firstArea, firstTasks[0]?.id ?? ""))?.content,
    ).toContain("Use a staged launch once every surface reports ready.");
    expect(inventories).toBe(1);

    const firstProject = firstProjects[0];
    const firstTask = firstTasks[0];
    if (!firstProject || !firstTask) {
      throw new Error("Expected fixture work documents.");
    }
    const unchanged = await store.snapshot({ area: "product" });
    const unchangedArea = requireArea(unchanged.scope);
    expect(await unchanged.documents(unchangedArea)).not.toBe(firstDocuments);
    expect(await unchanged.relations(unchangedArea)).not.toBe(firstRelations);
    expect(await unchanged.projects(unchangedArea)).not.toBe(firstProjects);
    expect(await unchanged.tasks(unchangedArea)).not.toBe(firstTasks);
    expect(inventories).toBe(2);

    await writeFile(
      path.join(fixture.workspace.areaRoot, "resources", "architecture.md"),
      "# Architecture\n\nThe next request observes this changed body.\n",
      "utf8",
    );

    const changed = await store.snapshot({ area: "product" });
    const changedArea = requireArea(changed.scope);
    const changedDocuments = await changed.documents(changedArea);
    const changedRelations = await changed.relations(changedArea);
    expect(changedDocuments).not.toBe(firstDocuments);
    expect(changedRelations).not.toBe(firstRelations);
    expect(
      changedDocuments.documents.find(
        (document) => document.relativePath === "resources/architecture.md",
      )?.content,
    ).toContain("next request observes");
    expect(await changed.projects(changedArea)).not.toBe(firstProjects);
    expect(await changed.tasks(changedArea)).not.toBe(firstTasks);

    const manifestPath = path.join(fixture.workspace.areaRoot, "dokito.yaml");
    await writeFile(
      manifestPath,
      (await readFile(manifestPath, "utf8")).replace(
        "name: Product",
        "name: Product Knowledge",
      ),
      "utf8",
    );
    const renamed = await store.snapshot({ area: "product" });
    const renamedArea = requireArea(renamed.scope);
    const renamedDocuments = await renamed.documents(renamedArea);
    expect(renamedArea.manifest.name).toBe("Product Knowledge");
    expect(renamedDocuments).not.toBe(changedDocuments);
    expect(
      renamedDocuments.documents.every(
        (document) => document.areaName === "Product Knowledge",
      ),
    ).toBeTrue();
    expect(await renamed.projects(renamedArea)).not.toBe(firstProjects);
    expect(await renamed.tasks(renamedArea)).not.toBe(firstTasks);
  });

  test("keeps external edits live without turning them into HTTP cache", async () => {
    const fixture = await setup();
    let bodyReads = 0;
    const store = new WorkspaceStore(fixture.workspace.configPath, {
      readFile: async (areaRoot, relativePath) => {
        bodyReads += 1;
        return readAreaFile(areaRoot, relativePath);
      },
    });
    const request = createWebRequestHandler({
      configPath: fixture.workspace.configPath,
      workspaceStore: store,
    });
    const url =
      "http://127.0.0.1/area/product/resources/resources/architecture.md";
    const before = await request(new Request(url));
    expect(await before.text()).toContain(
      "The Web app communicates with the API.",
    );
    expect(bodyReads).toBeGreaterThan(0);

    bodyReads = 0;
    const second = await request(new Request(url));
    expect(await second.text()).toContain(
      "The Web app communicates with the API.",
    );
    expect(bodyReads).toBeGreaterThan(0);

    const documentPath = path.join(
      fixture.workspace.areaRoot,
      "resources",
      "architecture.md",
    );
    const original = await readFile(documentPath, "utf8");
    const replacement = original.replace("Web app", "API app");
    expect(replacement.length).toBe(original.length);
    await writeFile(documentPath, replacement, "utf8");

    bodyReads = 0;
    const after = await request(new Request(url));
    expect(await after.text()).toContain(
      "The API app communicates with the API.",
    );
    expect(bodyReads).toBeGreaterThan(0);
    expect(after.headers.get("cache-control")).toBe("no-store");
  });

  test("reads each Markdown body once per request", async () => {
    const fixture = await setup();
    const files = await listAreaFiles(fixture.workspace.areaRoot);
    let bodyReads = 0;
    const store = new WorkspaceStore(fixture.workspace.configPath, {
      readFile: async (areaRoot, relativePath) => {
        bodyReads += 1;
        return readAreaFile(areaRoot, relativePath);
      },
    });

    const first = await store.snapshot({ area: "product" });
    const firstArea = requireArea(first.scope);
    await Promise.all([
      first.navigation(),
      first.documents(firstArea),
      first.projects(firstArea),
      first.tasks(firstArea),
    ]);
    expect(bodyReads).toBe(files.length);

    bodyReads = 0;
    const second = await store.snapshot({ area: "product" });
    const secondArea = requireArea(second.scope);
    await Promise.all([
      second.navigation(),
      second.documents(secondArea),
      second.projects(secondArea),
      second.tasks(secondArea),
    ]);
    expect(bodyReads).toBe(files.length);
  });

  test("retries a failed Markdown body on the next request", async () => {
    const fixture = await setup();
    const relativePath = "resources/architecture.md";
    let attempts = 0;
    const store = new WorkspaceStore(fixture.workspace.configPath, {
      readFile: async (areaRoot, requestedPath) => {
        if (requestedPath === relativePath) {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("Transient read failure");
          }
        }
        return readAreaFile(areaRoot, requestedPath);
      },
    });

    const first = await store.snapshot({ area: "product" });
    const firstDocuments = await first.documents(requireArea(first.scope));
    expect(
      firstDocuments.documents.find(
        (document) => document.relativePath === relativePath,
      )?.unreadable,
    ).toBeTrue();

    const retried = await store.snapshot({ area: "product" });
    const retriedDocument = (
      await retried.documents(requireArea(retried.scope))
    ).documents.find((document) => document.relativePath === relativePath);
    expect(retriedDocument?.unreadable).toBeUndefined();
    expect(retriedDocument?.content).toContain(
      "The Web app communicates with the API.",
    );
    expect(attempts).toBe(2);
  });

  test("loads only the catalogue product a view requests", async () => {
    const fixture = await setup();
    const projectReads: string[] = [];
    const projectStore = new WorkspaceStore(fixture.workspace.configPath, {
      readFile: async (areaRoot, relativePath) => {
        projectReads.push(relativePath);
        return readAreaFile(areaRoot, relativePath);
      },
    });

    const projects = await projectStore.snapshot({ area: "product" });
    expect(projectReads).toEqual([]);
    await projects.projects(requireArea(projects.scope));
    expect(projectReads.length).toBeGreaterThan(0);
    expect(
      projectReads.every((relativePath) =>
        relativePath.startsWith("projects/"),
      ),
    ).toBeTrue();

    const navigationReads: string[] = [];
    const navigationStore = new WorkspaceStore(fixture.workspace.configPath, {
      readFile: async (areaRoot, relativePath) => {
        navigationReads.push(relativePath);
        return readAreaFile(areaRoot, relativePath);
      },
    });
    const navigation = await navigationStore.snapshot({ area: "product" });
    await navigation.navigation();
    expect(navigationReads).toEqual(["context.md"]);
  });

  test("keeps readers local to each WorkspaceStore", async () => {
    const fixture = await setup();
    let firstReads = 0;
    let secondReads = 0;
    const firstStore = new WorkspaceStore(fixture.workspace.configPath, {
      readFile: async (areaRoot, relativePath) => {
        firstReads += 1;
        return readAreaFile(areaRoot, relativePath);
      },
    });
    const secondStore = new WorkspaceStore(fixture.workspace.configPath, {
      readFile: async (areaRoot, relativePath) => {
        secondReads += 1;
        return readAreaFile(areaRoot, relativePath);
      },
    });

    const first = await firstStore.snapshot({ area: "product" });
    const firstDocuments = await first.documents(requireArea(first.scope));
    const second = await secondStore.snapshot({ area: "product" });
    const secondDocuments = await second.documents(requireArea(second.scope));

    expect(firstReads).toBeGreaterThan(0);
    expect(secondReads).toBe(firstReads);
    expect(secondDocuments).not.toBe(firstDocuments);
  });
});
