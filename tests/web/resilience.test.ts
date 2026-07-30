import { afterEach, describe, expect, test } from "bun:test";
import { chmod, cp, writeFile } from "node:fs/promises";
import path from "node:path";
import { registerArea } from "../../src/core/config";
import { createWebRequestHandler } from "../../src/web/server";
import {
  createTestWorkspace,
  registerTestArea,
  type TestWorkspace,
} from "../helpers";

/**
 * A workspace is a set of independent Areas. Every screen has to survive one
 * of them being unreadable, because the one that still works is the reason
 * the tool was opened.
 */
describe("One broken Area", () => {
  let workspace: TestWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
  });

  /** Two Areas, then a file in the first one that no loader will accept. */
  async function twoAreas(): Promise<(url: string) => Promise<Response>> {
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

    await cp(
      path.join(workspace.areaRoot, "projects", "launch.md"),
      path.join(workspace.areaRoot, "projects", "Launch V2.md"),
    );

    const handler = createWebRequestHandler({
      configPath: workspace.configPath,
    });
    return (url: string) => handler(new Request(`http://127.0.0.1${url}`));
  }

  test("does not take the other Area down with it", async () => {
    const open = await twoAreas();

    for (const url of [
      "/area/personal",
      "/area/personal/tasks",
      "/area/personal/projects",
      "/area/personal/resources",
    ]) {
      expect({ url, status: (await open(url)).status }).toEqual({
        url,
        status: 200,
      });
    }
  });

  test("routes unscoped entries to the first readable Area", async () => {
    const open = await twoAreas();

    const documents = await open("/");
    const projects = await open("/projects");
    const index = await open("/index.json");

    expect(documents.status).toBe(302);
    expect(documents.headers.get("location")).toBe("/area/personal");
    expect(projects.status).toBe(302);
    expect(projects.headers.get("location")).toBe("/area/personal/projects");
    expect(index.status).toBe(200);
  });

  test("says which document it skipped and why", async () => {
    const open = await twoAreas();
    // A screen reads the Area it is scoped to and no others, so the Area with
    // the problem is where the problem is reported.
    const html = await (await open("/area/product/tasks")).text();

    expect(html).toContain("Launch V2.md");
    expect(html).toContain("in Area &#x27;product&#x27;");
  });

  test("keeps the broken Area's own readable work on screen", async () => {
    const open = await twoAreas();
    const html = await (await open("/area/product/tasks")).text();

    // One unreadable Project file. This Area's Tasks are still its work.
    expect(html).toContain("Coordinate the product launch");
  });

  test("reports the skipped document on Focus too", async () => {
    const open = await twoAreas();
    // Focus is the landing screen. A short list there with no reason given is
    // the failure this reporting exists to prevent.
    const html = await (await open("/focus")).text();

    expect(html).toContain("Launch V2.md");
  });

  test("still lists the healthy Area's own work", async () => {
    const open = await twoAreas();
    const html = await (await open("/area/personal/tasks")).text();

    expect(html).toContain("Coordinate the product launch");
  });
});

/**
 * Two things the chrome has to state honestly: which screen you are on, and
 * what a warning is actually about.
 */
describe("The Dokito chrome", () => {
  let workspace: TestWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
  });

  async function open(url: string): Promise<string> {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    const handler = createWebRequestHandler({
      configPath: workspace.configPath,
    });
    return (await handler(new Request(`http://127.0.0.1${url}`))).text();
  }

  test("marks Projects active on a Project page", async () => {
    const html = await open("/area/product/projects/launch");

    expect(html).toContain('aria-current="page"');
  });
});

/** A URL we cannot serve says so; 500 is reserved for our own faults. */
describe("Addresses we do not have", () => {
  let workspace: TestWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
  });

  async function status(url: string): Promise<number> {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    const handler = createWebRequestHandler({
      configPath: workspace.configPath,
    });
    return (await handler(new Request(`http://127.0.0.1${url}`))).status;
  }

  test("answers 404 for a font name that is only on Object.prototype", async () => {
    expect(await status("/fonts/constructor")).toBe(404);
  });

  test("answers 404 for a document path that will not decode", async () => {
    expect(await status("/area/product/resources/100%.md")).toBe(404);
  });

  test("still serves a font it actually has", async () => {
    expect(await status("/fonts/inter.woff2")).toBe(200);
  });
});

/** The switcher is how you leave a screen; it has to list every Area. */
describe("Area switcher on Search", () => {
  let workspace: TestWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
  });

  test("lists the other Area too", async () => {
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

    const handler = createWebRequestHandler({
      configPath: workspace.configPath,
    });
    const html = await (
      await handler(
        new Request("http://127.0.0.1/area/product/search?q=privacy"),
      )
    ).text();

    expect(html).toContain("Personal");
  });
});

/** A file Dokito lists but cannot read is one broken document. */
describe("An unreadable document", () => {
  let workspace: TestWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
  });

  test("keeps its place and says what is wrong", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    const broken = path.join(workspace.areaRoot, "resources", "broken.md");
    await writeFile(broken, "# Broken\n", "utf8");
    await chmod(broken, 0o000);

    const handler = createWebRequestHandler({
      configPath: workspace.configPath,
    });
    const html = await (
      await handler(
        new Request(
          "http://127.0.0.1/area/product/resources/resources/broken.md",
        ),
      )
    ).text();

    expect(html).toContain("This document could not be read");
    expect(html).toContain("resources/broken.md");
    // The rest of the Area is still listed.
    expect(html).toContain(">security</span>");

    await chmod(broken, 0o644);
  });
});

/**
 * Every view reads every document body, so one very large file used to stall
 * the whole single-threaded server — including screens that show only titles.
 */
describe("A document too large to read", () => {
  let workspace: TestWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
  });

  test("keeps the Area listable and says why the reader is empty", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    await writeFile(
      path.join(workspace.areaRoot, "resources", "huge.md"),
      `# Huge\n\nonly-inside-the-huge-body\n\n${"padding ".repeat(140_000)}`,
      "utf8",
    );

    const handler = createWebRequestHandler({
      configPath: workspace.configPath,
    });
    const request = (url: string) =>
      handler(new Request(`http://127.0.0.1${url}`));

    const list = await (await request("/area/product")).text();
    expect(list).toContain(">security</span>");
    expect(list).not.toContain("only-inside-the-huge-body");

    const reader = await (
      await request("/area/product/resources/resources/huge.md")
    ).text();
    expect(reader).toContain("This document is too large to display");
    expect(reader).toContain("1.1 MB");
    expect(reader).toContain("resources/huge.md");
    expect(reader).not.toContain("only-inside-the-huge-body");
  });
});
