import { afterEach, describe, expect, test } from "bun:test";
import { cp, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { registerArea } from "../../src/core/config";
import { listAreaFiles } from "../../src/core/files";
import { areaState, resourceState } from "../../src/core/state-model";
import { loadSearchView, loadTasksView } from "../../src/web/data";
import { createWebRequestHandler } from "../../src/web/server";
import {
  createTestWorkspace,
  registerTestArea,
  type TestWorkspace,
} from "../helpers";

/**
 * An Area and a Resource have no end, so what they declare is whether they are
 * still in use. Anything that says nothing is active.
 */
describe("Declared state", () => {
  test("reads what the frontmatter says and nothing else", () => {
    expect(areaState("# Product\n")).toBe("active");
    expect(areaState("---\nstate: paused\n---\n\n# Writing\n")).toBe("paused");
    expect(areaState('---\nstate: "archived"\n---\n\n# Clients\n')).toBe(
      "archived",
    );
    // A Resource is free-form Markdown: a word this vocabulary does not know,
    // or one written below the frontmatter, is not a reason to refuse the file.
    expect(resourceState("---\nstate: paused\n---\n\n# Notes\n")).toBe(
      "active",
    );
    expect(resourceState("---\nstate: nonsense\n---\n\n# Notes\n")).toBe(
      "active",
    );
    expect(resourceState("# Notes\n\nstate: archived\n")).toBe("active");
  });
});

describe("The Area switcher", () => {
  let workspace: TestWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
  });

  /** Three Areas: one active, one paused and one archived. */
  async function threeAreas(): Promise<(url: string) => Promise<string>> {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });

    for (const [id, name, state] of [
      ["writing", "Writing", "paused"],
      ["clients", "Clients", "archived"],
    ] as const) {
      const root = path.join(workspace.root, `${id}-area`);
      await cp(workspace.areaRoot, root, { recursive: true });
      const manifest = path.join(root, "dokito.yaml");
      await writeFile(
        manifest,
        (await Bun.file(manifest).text())
          .replace("id: product", `id: ${id}`)
          .replace("name: Product", `name: ${name}`),
        "utf8",
      );
      await writeFile(
        path.join(root, "context.md"),
        `---\nstate: ${state}\n---\n\n# ${name}\n\nAn Area that is ${state}.\n`,
        "utf8",
      );
      await registerArea(workspace.configPath, id, root);
    }

    const handler = createWebRequestHandler({
      configPath: workspace.configPath,
    });
    return async (url: string) =>
      (await handler(new Request(`http://127.0.0.1${url}`))).text();
  }

  test("opens the first active Area and notices external state edits", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });

    const pausedRoot = path.join(workspace.root, "acme-area");
    await cp(workspace.areaRoot, pausedRoot, { recursive: true });
    const manifest = path.join(pausedRoot, "dokito.yaml");
    await writeFile(
      manifest,
      (await Bun.file(manifest).text())
        .replace("id: product", "id: acme")
        .replace("name: Product", "name: Acme Cloud"),
      "utf8",
    );
    await writeFile(
      path.join(pausedRoot, "context.md"),
      "---\nstate: paused\n---\n\n# Acme Cloud\n",
      "utf8",
    );
    await registerArea(workspace.configPath, "acme", pausedRoot);

    const request = createWebRequestHandler({
      configPath: workspace.configPath,
    });
    const response = await request(new Request("http://127.0.0.1/"));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/area/product");

    // `paused` and `active` have the same length. Metadata revision, rather
    // than size alone, must invalidate both navigation and the default route.
    await writeFile(
      path.join(pausedRoot, "context.md"),
      "---\nstate: active\n---\n\n# Acme Cloud\n",
      "utf8",
    );
    const changed = await request(new Request("http://127.0.0.1/"));

    expect(changed.status).toBe(302);
    expect(changed.headers.get("location")).toBe("/area/acme");
  });

  test("sorts non-active Areas below the active ones", async () => {
    const open = await threeAreas();
    const html = await open("/area/product");
    const listed = [...html.matchAll(/data-area-option="([^"]+)"/g)].map(
      (match) => match[1],
    );

    // Position keeps current Areas easy to reach, while the label makes a
    // paused Area impossible to mistake for an active or archived one.
    expect(listed).toEqual(["Product", "Writing", "Clients"]);
    expect(html).toContain(">Paused<");
  });

  test("holds an archived Area behind a row that says how many there are", async () => {
    const open = await threeAreas();
    const html = await open("/area/product");
    const panel = html.slice(
      html.indexOf('data-area-navigation=""'),
      html.indexOf("</nav>"),
    );

    expect(panel).toContain("1 archived");
    // Revealed by a disclosure rather than by a round trip.
    expect(panel).toContain("<details");
  });

  test("keeps listing an archived Area while you are looking at it", async () => {
    const open = await threeAreas();
    const html = await open("/area/clients");
    const panel = html.slice(
      html.indexOf('data-area-navigation=""'),
      html.indexOf("</nav>"),
    );

    // The switcher never hides where you are, so the only archived Area is
    // already on the list and there is nothing left to reveal.
    expect(panel).toContain('data-area-option="Clients"');
    expect(panel).not.toContain("archived</summary>");
  });

  test("shows its state in both the Area switcher and document", async () => {
    const open = await threeAreas();
    const html = await open("/area/writing/resources/context.md");

    const panel = html.slice(
      html.indexOf('data-area-navigation=""'),
      html.indexOf("</nav>"),
    );

    expect(panel).toContain(">Paused<");
    expect(html).toContain("State");
    expect(html.match(/>Paused</g)).toHaveLength(4);
  });
});

describe("Search across Areas", () => {
  let workspace: TestWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
  });

  async function twoAreas(): Promise<string> {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    const second = path.join(workspace.root, "personal-area");
    await cp(workspace.areaRoot, second, { recursive: true });
    const manifest = path.join(second, "dokito.yaml");
    await writeFile(
      manifest,
      (await Bun.file(manifest).text())
        .replace("id: product", "id: personal")
        .replace("name: Product", "name: Personal"),
      "utf8",
    );
    await registerArea(workspace.configPath, "personal", second);
    return workspace.configPath;
  }

  test("reaches every Area whatever the Area menu says", async () => {
    const configPath = await twoAreas();
    const scoped = await loadSearchView({
      configPath,
      area: "product",
      query: "small teams",
    });

    // With every result naming its Area, a scope control would only make the
    // reader do the search's work.
    expect(new Set(scoped.hits.map((hit) => hit.areaId))).toEqual(
      new Set(["product", "personal"]),
    );
  });

  test("states why each hit ranks where it does", async () => {
    const configPath = await twoAreas();
    const work = await loadSearchView({
      configPath,
      area: "product",
      query: "launch",
    });
    const reading = await loadSearchView({
      configPath,
      area: "product",
      query: "product",
    });

    // Active work first, then title matches, then content.
    expect(work.hits[0]?.reason).toBe("in progress");
    expect(work.hits.map((hit) => hit.reason)).toContain("active");
    expect(work.hits.map((hit) => hit.type)).toContain("tasks");
    expect(reading.hits.map((hit) => hit.reason)).toContain("title");
  });

  test("keeps internal heading metadata out of Web hits", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    await writeFile(
      path.join(workspace.areaRoot, "resources", "operations.md"),
      "Opening note.\n\n## Rotation marker\n\nNo repeated marker.\n",
      "utf8",
    );

    const result = await loadSearchView({
      configPath: workspace.configPath,
      area: "product",
      query: "rotation marker",
    });

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({
      path: "resources/operations.md",
      line: 3,
      snippet: "Rotation marker",
      reason: "content",
    });
    expect(result.hits[0]).not.toHaveProperty("heading");
  });

  test("preserves Web search ranking", async () => {
    const configPath = await twoAreas();
    const roots = [
      { root: workspace?.areaRoot ?? "", offset: 0 },
      { root: path.join(workspace?.root ?? "", "personal-area"), offset: 30 },
    ];
    for (const { root, offset } of roots) {
      const files = await listAreaFiles(root);
      await Promise.all(
        files.map((file, index) => {
          const stamp = new Date(Date.UTC(2026, 0, 1, 0, offset + index));
          return utimes(path.join(root, file.path), stamp, stamp);
        }),
      );
    }
    const order = async (query: string) =>
      (await loadSearchView({ configPath, area: "product", query })).hits.map(
        (hit) => `${hit.reason} ${hit.areaId}/${hit.path}`,
      );

    expect(await order("launch")).toEqual([
      "in progress personal/tasks/01K1ABCXYZ0000000000000000-coordinate-launch.md",
      "in progress product/tasks/01K1ABCXYZ0000000000000000-coordinate-launch.md",
      "active personal/projects/launch.md",
      "active product/projects/launch.md",
      "content personal/context.md",
      "content product/context.md",
    ]);
    expect(await order("product")).toEqual([
      "in progress personal/tasks/01K1ABCXYZ0000000000000000-coordinate-launch.md",
      "in progress product/tasks/01K1ABCXYZ0000000000000000-coordinate-launch.md",
      "active personal/projects/launch.md",
      "active product/projects/launch.md",
      "title personal/resources/product.md",
      "title personal/context.md",
      "title product/resources/product.md",
      "title product/context.md",
      "content personal/resources/markdown.md",
      "content personal/resources/architecture.md",
      "content product/resources/markdown.md",
      "content product/resources/architecture.md",
    ]);
    expect(await order("privacy")).toEqual([
      "title personal/tasks/01K1ABDXYZ0000000000000000-revise-privacy-notice.md",
      "title product/tasks/01K1ABDXYZ0000000000000000-revise-privacy-notice.md",
    ]);
  });

  test("marks archived Resources before opening them", async () => {
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
      // The query has to meet text the reader shows, not a hidden heading.
      "---\nstate: archived\n---\n\n# Archived pricing\n\nSuperseded, archived.\n",
      "utf8",
    );
    const request = createWebRequestHandler({
      configPath: workspace.configPath,
    });
    const html = await (
      await request(
        new Request("http://127.0.0.1/area/product/search?q=archived"),
      )
    ).text();

    expect(html).toMatch(/pricing[\s\S]*>Archived<\/span>/);
    expect(html).toContain(
      'href="/area/product/resources/resources/pricing.md?archived=1"',
    );
  });

  test("sorts by recency when asked to", async () => {
    const configPath = await twoAreas();
    const recent = await loadSearchView({
      configPath,
      area: "product",
      query: "product",
      sort: "updated",
    });
    const dates = recent.hits.map((hit) => hit.modifiedAt);

    expect(recent.sort).toBe("updated");
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

describe("The Tasks status filter", () => {
  let workspace: TestWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
  });

  test("drives the list rather than only the button", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    const done = path.join(
      workspace.areaRoot,
      "tasks",
      "01K1ABEXYZ0000000000000000-publish-the-release-guide.md",
    );
    await writeFile(
      done,
      "---\nstatus: done\nproject: launch\n---\n\n# Publish the release guide\n\nPublished with the pre-release notes.\n",
      "utf8",
    );

    const open = await loadTasksView({
      configPath: workspace.configPath,
      area: "product",
    });
    const all = await loadTasksView({
      configPath: workspace.configPath,
      area: "product",
      status: "all",
    });
    const closed = await loadTasksView({
      configPath: workspace.configPath,
      area: "product",
      status: "closed",
    });
    const response = await createWebRequestHandler({
      configPath: workspace.configPath,
    })(new Request("http://127.0.0.1/area/product/tasks?status=closed"));
    const html = await response.text();

    expect(open.items.map((item) => item.title)).not.toContain(
      "Publish the release guide",
    );
    expect(all.items.map((item) => item.title)).toContain(
      "Publish the release guide",
    );
    expect(closed.items.map((item) => item.title)).toEqual([
      "Publish the release guide",
    ]);
    expect(all.items.length).toBeGreaterThan(open.items.length);
    expect(html).toContain('aria-label="Status: Closed"');
    expect(html).toContain('href="/area/product/tasks"');
    expect(html).toContain("status=all");
  });
});
