import { afterEach, describe, expect, test } from "bun:test";
import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { registerArea } from "../../src/core/config";
import {
  loadProjectsView,
  loadProjectView,
  loadResourcesView,
  loadSearchView,
  loadTasksView,
} from "../../src/web/data";
import type { PaletteEntry } from "../../src/web/data/palette";
import {
  candidateWebServerPorts,
  createWebRequestHandler,
  normalizeWebServerStartError,
  startWebServer,
  webInstanceId,
} from "../../src/web/server";
import {
  createTestWorkspace,
  registerTestArea,
  type TestWorkspace,
} from "../helpers";

describe("Web", () => {
  let workspace: TestWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
  });

  test("rejects requests whose host is not loopback", async () => {
    workspace = await createTestWorkspace();
    const request = createWebRequestHandler({
      configPath: workspace.configPath,
    });

    const rejected = await request(
      new Request("http://attacker.example/health"),
    );
    const allowed = await request(new Request("http://127.0.0.1/health"));
    const localhost = await request(new Request("http://localhost/health"));

    expect(rejected.status).toBe(421);
    expect(await rejected.text()).not.toContain("instanceId");
    expect(allowed.status).toBe(200);
    expect(localhost.status).toBe(200);
  });

  test("opens Resources by default and renders local Tasks", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    const request = createWebRequestHandler({
      configPath: workspace.configPath,
    });

    const entry = await request(new Request("http://127.0.0.1/"));
    const documentsResponse = await request(
      new Request("http://127.0.0.1/area/product"),
    );
    const documentsHtml = await documentsResponse.text();
    const tasksResponse = await request(
      new Request("http://127.0.0.1/area/product/tasks"),
    );
    const tasksHtml = await tasksResponse.text();
    const tasksNavigationResponse = await request(
      new Request("http://127.0.0.1/area/product/tasks", {
        headers: { "x-dokito-navigation": "1" },
      }),
    );
    const tasksNavigationHtml = await tasksNavigationResponse.text();

    expect(entry.status).toBe(302);
    expect(entry.headers.get("location")).toBe("/area/product");
    expect(documentsResponse.status).toBe(200);
    expect(documentsResponse.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(documentsHtml).toContain("Dokito — Resources");
    expect(documentsHtml).toContain('data-resources-view=""');
    expect(documentsHtml).toContain('data-area-navigation=""');
    expect(documentsHtml).not.toContain("All areas");

    expect(tasksResponse.status).toBe(200);
    expect(tasksHtml).toContain("Dokito — Tasks");
    expect(tasksHtml).toContain("Coordinate the product launch");
    expect(tasksHtml).toContain('data-work-filters=""');
    expect(tasksHtml).toContain("<!doctype html>");
    expect(tasksNavigationResponse.status).toBe(200);
    expect(tasksNavigationResponse.headers.get("x-dokito-navigation")).toBe(
      "1",
    );
    expect(tasksNavigationHtml).toStartWith("<main");
    expect(tasksNavigationHtml).toContain('data-dokito-navigation=""');
    expect(tasksNavigationHtml).toContain('data-page-title="Dokito — Tasks"');
    expect(tasksNavigationHtml).toContain('data-tasks-view=""');
    expect(tasksNavigationHtml).not.toContain("<!doctype html>");
    expect(tasksNavigationHtml).not.toContain('src="/app.js"');

    const detail = await request(
      new Request(
        "http://127.0.0.1/area/product/tasks/01K1ABCXYZ0000000000000000",
      ),
    );
    const detailHtml = await detail.text();
    const taskPage = await request(
      new Request(
        "http://127.0.0.1/area/product/tasks/01K1ABDXYZ0000000000000000",
      ),
    );
    const taskPageHtml = await taskPage.text();
    const projectPage = await request(
      new Request("http://127.0.0.1/area/product/projects/launch"),
    );
    const projectPageHtml = await projectPage.text();

    expect(detailHtml).toContain("01K1ABCXYZ0000000000000000");
    expect(detailHtml).toContain("Verify the release across the Web app");
    expect(detailHtml).toContain("In progress");
    expect(detailHtml).toMatch(
      /href="\/area\/product\/tasks"[^>]*aria-current="page"[^>]*data-nav-link=""/,
    );
    expect(taskPage.status).toBe(200);
    expect(taskPageHtml).toContain("Revise the privacy notice");
    expect(taskPageHtml).toContain("<!doctype html>");
    expect(projectPage.status).toBe(200);
    expect(projectPageHtml).toContain("Launch the product");
    expect(projectPageHtml).toContain("<!doctype html>");
  });

  /**
   * The summary above the body and the paragraphs removed from it have to name
   * the same paragraphs. Reading the note out of a later section hoisted it
   * into the summary and left that section empty.
   */
  test("keeps a Project section that follows the summary", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    await writeFile(
      path.join(workspace.areaRoot, "projects", "launch.md"),
      [
        "---",
        "status: active",
        "---",
        "",
        "# Launch the product",
        "",
        "Outcome: Ship the Web app.",
        "",
        "## Plan",
        "",
        "Step one is the release build.",
      ].join("\n"),
      "utf8",
    );
    const request = createWebRequestHandler({
      configPath: workspace.configPath,
    });
    const html = await (
      await request(
        new Request("http://127.0.0.1/area/product/projects/launch"),
      )
    ).text();

    expect(html).toContain("Ship the Web app.");
    expect(html).toContain("Step one is the release build.");
    // The section keeps its own paragraph rather than handing it to the summary.
    expect(html).toMatch(/Plan[\s\S]*Step one is the release build\./);
  });

  test("supports Area-scoped Markdown search and returns 404 elsewhere", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    const request = createWebRequestHandler({
      configPath: workspace.configPath,
    });

    const searchResponse = await request(
      new Request("http://127.0.0.1/area/product/search?q=small%20teams"),
    );
    const searchHtml = await searchResponse.text();
    const tasksResponse = await request(
      new Request("http://127.0.0.1/area/product/tasks"),
    );
    const tasksHtml = await tasksResponse.text();
    const staleFilterResponse = await request(
      new Request("http://127.0.0.1/area/product/tasks?q=coordinate"),
    );
    const staleFilterHtml = await staleFilterResponse.text();
    const missingResponse = await request(
      new Request("http://127.0.0.1/missing"),
    );
    const missingHtml = await missingResponse.text();
    const healthResponse = await request(
      new Request("http://127.0.0.1/health"),
    );

    expect(searchResponse.status).toBe(200);
    expect(searchHtml).toContain("result");
    expect(searchHtml).toContain("resources/product.md");
    expect(searchHtml).toContain("/area/product/resources/");
    // Tasks has no search of its own. A saved link still opens the list, and
    // it opens the whole list — a `q` no control can clear must not quietly
    // shorten it, nor the count that stands beside it.
    expect(staleFilterResponse.status).toBe(200);
    expect(staleFilterHtml).toBe(tasksHtml);
    expect(missingResponse.status).toBe(404);
    expect(missingResponse.headers.get("content-type")).toContain("text/html");
    expect(missingHtml).toContain("Page not found");
    expect(missingHtml).toContain("Return to overview");
    expect(await healthResponse.json()).toEqual({
      service: "dokito-web",
      protocolVersion: 2,
      instanceId: webInstanceId(workspace.configPath),
    });
    expect(healthResponse.headers.get("x-dokito-web")).toBe("2");
  });

  test("identifies a managed runtime in its health response", async () => {
    workspace = await createTestWorkspace();
    const request = createWebRequestHandler({
      configPath: workspace.configPath,
      runtimeId: "test-runtime",
    });

    const response = await request(new Request("http://127.0.0.1/health"));

    expect(await response.json()).toEqual({
      service: "dokito-web",
      protocolVersion: 2,
      instanceId: webInstanceId(workspace.configPath),
      runtimeId: "test-runtime",
      pid: process.pid,
    });
  });

  test("maps invalid query input and missing resources to HTTP semantics", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    const request = createWebRequestHandler({
      configPath: workspace.configPath,
    });

    const invalidStatus = await request(
      new Request("http://127.0.0.1/area/product/tasks?status=invalid"),
    );
    const inheritedPropertyQuery = await request(
      new Request("http://127.0.0.1/area/product/search?type=toString"),
    );
    const malformedTask = await request(
      new Request("http://127.0.0.1/area/product/tasks/not-a-task"),
    );
    const unknownPath = await request(
      new Request("http://127.0.0.1/area/product/nonsense"),
    );
    const missingArea = await request(
      new Request("http://127.0.0.1/area/missing"),
    );
    // A document has one address, so every document path includes its Area and
    // uses the Resources reader.
    const documentWithoutArea = await request(
      new Request("http://127.0.0.1/resources/context.md"),
    );
    const invalidConfigPath = path.join(workspace.root, "invalid-config.yaml");
    await writeFile(invalidConfigPath, "areas: [", "utf8");
    const invalidConfig = await createWebRequestHandler({
      configPath: invalidConfigPath,
    })(new Request("http://127.0.0.1/"));

    expect(invalidStatus.status).toBe(400);
    expect(await invalidStatus.text()).toContain("task_status_invalid");
    expect(inheritedPropertyQuery.status).toBe(400);
    expect(await inheritedPropertyQuery.text()).toContain("web_query_invalid");
    expect(malformedTask.status).toBe(404);
    expect(unknownPath.status).toBe(404);
    expect(documentWithoutArea.status).toBe(404);
    expect(missingArea.status).toBe(404);
    expect(await missingArea.text()).toContain("area_not_found");
    expect(invalidConfig.status).toBe(500);
  });

  test("lists, opens, and safely renders Markdown documents", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    await writeFile(
      path.join(workspace.areaRoot, "resources", "reader-test.md"),
      [
        "# Reader test",
        "",
        "Read **important** context and `code` here.",
        "",
        "- [x] Keep this safe",
        "- [ ] Follow up",
        "",
        "[[product|Product context]]",
        "",
        "[[missing|Missing note]]",
        "",
        "[Unsafe](javascript:alert)",
        "",
        "![Local chart](chart.png)",
        "",
        "<script>alert('not markup')</script>",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(workspace.areaRoot, "resources", "chart.png"),
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    const request = createWebRequestHandler({
      configPath: workspace.configPath,
    });

    const documentUrl =
      "http://127.0.0.1/area/product/resources/resources/reader-test.md";
    const response = await request(new Request(documentUrl));
    const html = await response.text();
    const imageResponse = await request(
      new Request("http://127.0.0.1/area/product/assets/resources/chart.png"),
    );
    const imageEtag = imageResponse.headers.get("etag");
    const cachedImageResponse = await request(
      new Request("http://127.0.0.1/area/product/assets/resources/chart.png", {
        headers: imageEtag ? { "if-none-match": imageEtag } : {},
      }),
    );
    const unsafeImageResponse = await request(
      new Request(
        "http://127.0.0.1/area/product/assets/resources/reader-test.md",
      ),
    );
    const traversalImageResponse = await request(
      new Request(
        "http://127.0.0.1/area/product/assets/resources/%2E%2E%5Cchart.png",
      ),
    );
    const searchResponse = await request(
      new Request("http://127.0.0.1/area/product/search?q=small%20teams"),
    );
    const searchHtml = await searchResponse.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Dokito — Resources");
    expect(html).toContain(">reader-test</h1>");
    expect(html).toContain("<strong>important</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('class="contains-task-list"');
    expect(html).toContain("Product context</a>");
    expect(html).toContain("Missing note");
    expect(html).not.toContain("dokito-wiki:");
    expect(html).toContain("/area/product/resources/resources/product.md");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('src="/area/product/assets/resources/chart.png"');
    expect(response.headers.get("content-security-policy")).toContain(
      "img-src 'self'",
    );
    expect(html).toContain("resources/reader-test.md");
    expect(html).toContain("data-resources-explorer");
    expect(html).toContain("data-document-link");
    expect(html).toContain('data-resources-base="/area/product"');
    expect(html).not.toContain("data-documents-base");
    expect(imageResponse.status).toBe(200);
    expect(imageResponse.headers.get("content-type")).toBe("image/png");
    expect(imageResponse.headers.get("cache-control")).toBe(
      "private, no-cache",
    );
    expect(imageEtag).toMatch(/^"[a-f0-9]{20}"$/);
    expect(cachedImageResponse.status).toBe(304);
    expect(cachedImageResponse.headers.get("etag")).toBe(imageEtag);
    expect(unsafeImageResponse.status).toBe(404);
    expect(traversalImageResponse.status).toBe(404);
    expect(searchHtml).toContain("result");
    expect(searchHtml).toContain("resources/product.md");
  });

  test("renders related details with the page and observes external edits", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    const taskId = "01K1ABCXYZ0000000000000000";
    const taskPath = path.join(
      workspace.areaRoot,
      "tasks",
      `${taskId}-coordinate-launch.md`,
    );
    await writeFile(
      taskPath,
      `${await readFile(taskPath, "utf8")}

[Architecture](architecture)
`,
      "utf8",
    );
    const request = createWebRequestHandler({
      configPath: workspace.configPath,
    });
    const taskPage = await (
      await request(
        new Request(`http://127.0.0.1/area/product/tasks/${taskId}`),
      )
    ).text();
    expect(taskPage).toContain(
      'href="/area/product/projects/launch">Launch the product</a>',
    );
    expect(taskPage).toContain(">Resources</p>");
    expect(taskPage).toContain(">architecture</span>");
    expect(taskPage).not.toContain("data-derived");

    const resourcePage = await (
      await request(
        new Request(
          "http://127.0.0.1/area/product/resources/resources/markdown.md",
        ),
      )
    ).text();
    // A Resource is named by its file, heading included, so no second name
    // has to be kept in step with it.
    expect(resourcePage).toContain(">markdown</h1>");
    expect(resourcePage).toContain(">my notes</span>");
    const notePath = path.join(workspace.areaRoot, "resources", "my notes.md");
    await writeFile(
      notePath,
      `${await readFile(notePath, "utf8")}\nRevision change.\n`,
      "utf8",
    );

    const currentPage = await (
      await request(
        new Request(
          "http://127.0.0.1/area/product/resources/resources/markdown.md",
        ),
      )
    ).text();
    expect(currentPage).toContain(">my notes</span>");
    expect(currentPage).toContain(">Related</p>");
  });

  test("loads only the data owned by the active Web view", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });

    const tasks = await loadTasksView({
      configPath: workspace.configPath,
    });
    const resources = await loadResourcesView({
      configPath: workspace.configPath,
      area: "product",
    });

    expect(tasks.view).toBe("tasks");
    expect(tasks.items.length).toBeGreaterThan(0);
    expect("content" in (tasks.items[0]?.task ?? {})).toBeFalse();
    expect(resources.view).toBe("resources");
    expect(resources.areas[0]?.documents.length).toBeGreaterThan(0);
    expect("workItems" in (resources.areas[0] ?? {})).toBeFalse();
    expect("root" in (resources.areas[0] ?? {})).toBeFalse();
    expect("status" in resources).toBeFalse();
    // The switcher names Areas and their state; it counts nothing.
    expect(resources.areaNavigation[0]).toEqual({
      id: "product",
      name: "Product",
      state: "active",
    });
  });

  test("summarizes Projects and opens one", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    const projectPath = path.join(workspace.areaRoot, "projects", "launch.md");
    await writeFile(
      projectPath,
      `${await readFile(projectPath, "utf8")}

## Definition of done

- **Documentation** is published.
- See [product context](product).

![Release chart](../resources/chart.png)
`,
      "utf8",
    );

    const projects = await loadProjectsView({
      configPath: workspace.configPath,
      area: "product",
    });
    const project = await loadProjectView({
      configPath: workspace.configPath,
      area: "product",
      project: "launch",
    });
    const projectResponse = await createWebRequestHandler({
      configPath: workspace.configPath,
    })(new Request("http://127.0.0.1/area/product/projects/launch"));
    const projectHtml = await projectResponse.text();

    expect(projects.view).toBe("projects");
    const summary = projects.projects.find(
      (candidate) => candidate.id === "launch",
    );
    expect(summary?.status).toBe("active");
    expect(summary?.outcome).toBe(
      "The Web app is available and the release is verified.",
    );
    expect(summary?.openTasks).toBe(2);
    expect(summary?.nextTask?.title).toBe("Coordinate the product launch");
    expect(projects.repositories).toContainEqual({
      value: "web-app",
      label: "web-app",
      count: 1,
    });

    expect(project.view).toBe("project");
    expect(project.project.title).toBe("Launch the product");
    expect(project.project.content).toContain("## Definition of done");
    expect(project.tasks).toHaveLength(2);
    expect(
      project.documents.map((document) => document.relativePath),
    ).toContain("projects/launch.md");
    expect(projectHtml).toContain("<h2>Definition of done</h2>");
    expect(projectHtml).toContain("<strong>Documentation</strong>");
    expect(projectHtml).toContain("projects/launch.md");
    expect(projectHtml).toContain('data-project-body=""');
    expect(
      projectHtml.match(
        /The Web app is available and the release is verified\./g,
      ),
    ).toHaveLength(1);
    expect(projectHtml).toContain(
      'href="/area/product/resources/resources/product.md"',
    );
    expect(projectHtml).toContain(
      'src="/area/product/assets/resources/chart.png"',
    );
    expect(projectHtml).toContain("/area/product/tasks/");
    expect(projectHtml).not.toContain("data-derived");
    expect(projectHtml).not.toContain("/resources/tasks/");
  });

  test("hides closed Projects until they are asked for", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    await writeFile(
      path.join(workspace.areaRoot, "projects", "pipeline.md"),
      ["---", "status: done", "---", "", "# Update the build"].join("\n"),
      "utf8",
    );

    const open = await loadProjectsView({
      configPath: workspace.configPath,
      area: "product",
    });
    const all = await loadProjectsView({
      configPath: workspace.configPath,
      area: "product",
      includeClosed: true,
    });

    expect(open.projects.map((project) => project.id)).not.toContain(
      "pipeline",
    );
    expect(all.projects.map((project) => project.id)).toContain("pipeline");
  });

  test("keeps repository facet counts independent of the active facet", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    await writeFile(
      path.join(workspace.areaRoot, "projects", "api-cleanup.md"),
      [
        "---",
        "status: planned",
        "repositories:",
        "  - api",
        "---",
        "",
        "# Clean up the API",
      ].join("\n"),
      "utf8",
    );

    const filtered = await loadProjectsView({
      configPath: workspace.configPath,
      area: "product",
      repository: "web-app",
    });

    expect(filtered.projects.map((project) => project.id)).toEqual(["launch"]);
    expect(filtered.repositories).toEqual([
      { value: "api", label: "api", count: 2 },
      { value: "web-app", label: "web-app", count: 1 },
      { value: "website", label: "website", count: 1 },
    ]);
  });

  test("opens a closed Task directly even when the list filter hides it", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    const taskId = "01K1ABDXYZ0000000000000000";
    const taskPath = path.join(
      workspace.areaRoot,
      "tasks",
      `${taskId}-revise-privacy-notice.md`,
    );
    await writeFile(
      taskPath,
      (await readFile(taskPath, "utf8")).replace(
        "status: todo",
        "status: done",
      ),
      "utf8",
    );
    const request = createWebRequestHandler({
      configPath: workspace.configPath,
    });

    const list = await request(
      new Request("http://127.0.0.1/area/product/tasks"),
    );
    const detail = await request(
      new Request(`http://127.0.0.1/area/product/tasks/${taskId}`),
    );
    const missing = await request(
      new Request(
        "http://127.0.0.1/area/product/tasks/01K1ZZZZZZ0000000000000000",
      ),
    );

    expect(await list.text()).not.toContain("Revise the privacy notice");
    expect(detail.status).toBe(200);
    expect(await detail.text()).toContain("Revise the privacy notice");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("task_not_found");
  });

  test("rejects a Project that does not exist", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    const request = createWebRequestHandler({
      configPath: workspace.configPath,
    });

    const missing = await request(
      new Request("http://127.0.0.1/area/product/projects/nope"),
    );

    expect(missing.status).toBe(404);
  });

  test("groups search hits by type and narrows them by facet", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });

    const all = await loadSearchView({
      configPath: workspace.configPath,
      area: "product",
      query: "product",
    });
    const resourcesOnly = await loadSearchView({
      configPath: workspace.configPath,
      area: "product",
      query: "product",
      type: "resources",
    });

    expect(all.view).toBe("search");
    expect(all.hits.length).toBeGreaterThan(1);
    expect(all.facets[0]).toEqual({
      type: "all",
      label: "All",
      count: all.hits.length,
    });
    expect(all.preview?.document.relativePath).toBe(all.hits[0]?.path);

    expect(resourcesOnly.typeFilter).toBe("resources");
    expect(
      resourcesOnly.hits.every((hit) => hit.type === "resources"),
    ).toBeTrue();
    expect(resourcesOnly.hits.length).toBeLessThan(all.hits.length);
  });

  test("opens a Search preview through a complete server-rendered page", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    const request = createWebRequestHandler({
      configPath: workspace.configPath,
    });

    const response = await request(
      new Request(
        "http://127.0.0.1/area/product/search?q=small%20teams&doc=resources%2Fproduct.md&docArea=product",
      ),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('data-search-preview=""');
    expect(html).toContain(">product</h2>");
    expect(html).toContain("helps small teams");
    expect(html).toContain("data-search-hits");
    expect(html).toContain("<!doctype html>");
  });

  test("returns one hit per document and no hits without a query", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });

    const empty = await loadSearchView({
      configPath: workspace.configPath,
      area: "product",
    });
    const hits = await loadSearchView({
      configPath: workspace.configPath,
      area: "product",
      query: "the",
    });
    const paths = hits.hits.map((hit) => hit.path);

    expect(empty.hits).toHaveLength(0);
    expect(empty.preview).toBeUndefined();
    expect(new Set(paths).size).toBe(paths.length);
  });

  /**
   * A Resource is named by its file and needs no H1, so a name the body never
   * repeats would otherwise be unreachable from Search while the palette still
   * found it.
   */
  test("finds a Resource by the name on its row", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    await writeFile(
      path.join(workspace.areaRoot, "resources", "Platform overview.md"),
      "How the platform is operated.",
      "utf8",
    );

    const results = await loadSearchView({
      configPath: workspace.configPath,
      area: "product",
      query: "platform overview",
    });

    expect(results.hits).toHaveLength(1);
    expect(results.hits[0]).toMatchObject({
      path: "resources/Platform overview.md",
      title: "Platform overview",
      reason: "title",
      snippet: "How the platform is operated.",
    });
  });

  /**
   * The reader removes a Resource's leading H1, so matching it would send a
   * reader to a page that does not contain the words they searched for. The
   * snippet of a name match has to clear the frontmatter for the same reason.
   */
  test("searches only what the reader shows", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    await writeFile(
      path.join(workspace.areaRoot, "resources", "Platform overview.md"),
      "---\nstate: active\n---\n\n# A hidden heading\n\nThe body.\n",
      "utf8",
    );
    const search = async (query: string) =>
      (
        await loadSearchView({
          configPath: workspace?.configPath ?? "",
          area: "product",
          query,
        })
      ).hits;

    expect(await search("hidden heading")).toHaveLength(0);
    const byName = await search("platform overview");
    expect(byName).toHaveLength(1);
    expect(byName[0]?.snippet).toBe("The body.");
  });

  test("ranks the complete search set before applying the result limit", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    const resourcesRoot = path.join(workspace.areaRoot, "resources");
    await Promise.all(
      Array.from({ length: 65 }, (_, index) =>
        writeFile(
          path.join(
            resourcesRoot,
            `search-${String(index).padStart(2, "0")}.md`,
          ),
          `# Supporting note ${index}\n\nThe needle appears in this body.`,
          "utf8",
        ),
      ),
    );
    await writeFile(
      // Last by name, first by rank: the needle is in the name a reader sees.
      path.join(resourcesRoot, "zz needle exact name.md"),
      "The needle appears here as well; the name is what ranks it first.",
      "utf8",
    );

    const results = await loadSearchView({
      configPath: workspace.configPath,
      area: "product",
      query: "needle",
    });
    const visiblePaths = new Set(results.hits.map((hit) => hit.path));
    const requestedPath = Array.from(
      { length: 65 },
      (_, index) => `resources/search-${String(index).padStart(2, "0")}.md`,
    ).find((candidate) => !visiblePaths.has(candidate));
    if (!requestedPath) {
      throw new Error("Expected a matching result outside the visible limit.");
    }
    const deepLinked = await loadSearchView({
      configPath: workspace.configPath,
      area: "product",
      query: "needle",
      document: requestedPath,
      documentArea: "product",
    });
    const response = await createWebRequestHandler({
      configPath: workspace.configPath,
    })(new Request("http://127.0.0.1/area/product/search?q=needle"));
    const allFacet = results.facets.find((facet) => facet.type === "all");
    const resourcesFacet = results.facets.find(
      (facet) => facet.type === "resources",
    );

    expect(results.hits).toHaveLength(60);
    expect(results.hits[0]?.path).toBe("resources/zz needle exact name.md");
    expect(allFacet?.count).toBe(66);
    expect(resourcesFacet?.count).toBe(66);
    expect(deepLinked.preview?.hit.path).toBe(requestedPath);
    expect(await response.text()).toContain("60 of 66 results");
  });

  test("adds the palette script without letting any screen depend on it", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    await writeFile(
      path.join(workspace.areaRoot, "resources", "pricing.md"),
      "---\nstate: archived\n---\n\n# Archived pricing\n",
      "utf8",
    );
    const request = createWebRequestHandler({
      configPath: workspace.configPath,
    });

    const page = await request(new Request("http://127.0.0.1/area/product"));
    const html = await page.text();
    const script = await request(new Request("http://127.0.0.1/app.js"));
    const favicon = await request(new Request("http://127.0.0.1/favicon.svg"));
    const index = await request(
      new Request("http://127.0.0.1/index.json?area=product"),
    );
    const entries = (await index.json()) as PaletteEntry[];

    expect(page.headers.get("content-security-policy")).toContain(
      "script-src 'self'",
    );
    expect(page.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(html).toContain('src="/app.js"');
    expect(html).toContain('rel="icon" href="/favicon.svg"');
    expect(html).toContain("data-palette-index");

    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("text/javascript");
    expect(favicon.status).toBe(200);
    expect(favicon.headers.get("content-type")).toContain("image/svg+xml");

    expect(index.status).toBe(200);
    expect(entries.length).toBeGreaterThan(0);
    expect(
      entries.every((entry) => entry.url?.startsWith("/area/")),
    ).toBeTrue();
    // A Task in progress is marked live, so root search can lead its tier
    // with it and can offer it before anything has been typed.
    expect(entries).toContainEqual({
      title: "Coordinate the product launch",
      meta: "In progress",
      kind: "Task",
      live: true,
      url: "/area/product/tasks/01K1ABCXYZ0000000000000000",
    });
    expect(entries).toContainEqual({
      title: "pricing",
      meta: "Archived · resources/pricing.md",
      kind: "Resource",
      url: "/area/product/resources/resources/pricing.md?archived=1",
    });
    expect(
      entries.some(
        (entry) =>
          entry.kind === "Resource" && entry.url?.includes("/resources/tasks/"),
      ),
    ).toBeFalse();
  });

  test("keeps Tasks Area-scoped when more than one Area is configured", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    // A second Area holding a Task with the same id, which is what happens
    // when an Area is copied: ids are unique per Area, not globally.
    const second = path.join(workspace.root, "personal-area");
    await cp(workspace.areaRoot, second, { recursive: true });
    await writeFile(
      path.join(second, "dokito.yaml"),
      (await readFile(path.join(second, "dokito.yaml"), "utf8"))
        .replace("id: product", "id: personal")
        .replace("name: Product", "name: Personal"),
      "utf8",
    );
    await registerArea(workspace.configPath, "personal", second);

    const request = createWebRequestHandler({
      configPath: workspace.configPath,
    });
    const entry = await request(new Request("http://127.0.0.1/"));
    const product = await request(
      new Request("http://127.0.0.1/area/product/tasks"),
    );
    const html = await product.text();

    expect(entry.status).toBe(302);
    expect(entry.headers.get("location")).toBe("/area/personal");
    expect(html).toContain("/area/product/tasks/");
    expect(html).not.toContain("/area/personal/tasks/");
    expect(html).toContain('data-area-option="Personal"');
    expect(html).not.toContain("All areas");
  });

  test("reports web start failures without assuming the port is occupied", () => {
    const cause = Object.assign(
      new Error("Failed to start server. Is port 4187 in use?"),
      {
        code: "EADDRINUSE",
      },
    );

    const error = normalizeWebServerStartError(cause, [4187]);

    expect(error.code).toBe("web_start_failed");
    expect(error.message).toBe(
      "Could not start Dokito Web at http://127.0.0.1:4187. The port may be in use or the environment may block local listening sockets.",
    );
    expect(error.details).toEqual({
      hostname: "127.0.0.1",
      attemptedPorts: [4187],
      causeCode: "EADDRINUSE",
      causeMessage: "Failed to start server. Is port 4187 in use?",
    });
  });

  test("tries the next default port but keeps an explicit port strict", async () => {
    const attemptedPorts: number[] = [];
    const server = await startWebServer(
      {
        configPath: "/tmp/dokito-test-config.yaml",
      },
      (options) => {
        attemptedPorts.push(options.port);
        expect(options.reusePort).toBeFalse();
        if (options.port < 4178) {
          throw Object.assign(new Error("Address in use"), {
            code: "EADDRINUSE",
          });
        }
        return {
          hostname: options.hostname,
          port: options.port,
          url: new URL(`http://${options.hostname}:${options.port}/`),
        } as Bun.Server<undefined>;
      },
      async () => false,
    );

    expect(candidateWebServerPorts()).toEqual([
      4176, 4177, 4178, 4179, 4180, 4181, 4182, 4183, 4184, 4185,
    ]);
    expect(attemptedPorts).toEqual([4176, 4177, 4178]);
    expect(server.port).toBe(4178);

    const explicitAttempts: number[] = [];
    await expect(
      startWebServer(
        {
          configPath: "/tmp/dokito-test-config.yaml",
          port: 4180,
        },
        (options) => {
          explicitAttempts.push(options.port);
          throw Object.assign(new Error("Address in use"), {
            code: "EADDRINUSE",
          });
        },
        async () => false,
      ),
    ).rejects.toThrow("Could not start Dokito Web at http://127.0.0.1:4180.");
    expect(explicitAttempts).toEqual([4180]);
  });

  test("reuses an existing Dokito server instead of starting another", async () => {
    let startCalls = 0;
    let probedInstanceId = "";
    const configPath = "/tmp/dokito-test-config.yaml";
    const server = await startWebServer(
      {
        configPath,
      },
      () => {
        startCalls += 1;
        throw new Error("A second server must not start.");
      },
      async (_hostname, port, instanceId) => {
        probedInstanceId = instanceId;
        return port === 4176;
      },
    );

    expect(startCalls).toBe(0);
    expect(probedInstanceId).toBe(webInstanceId(configPath));
    expect(server).toMatchObject({
      hostname: "127.0.0.1",
      port: 4176,
      reused: true,
    });
    expect(server.url.toString()).toBe("http://127.0.0.1:4176/");
  });
});
