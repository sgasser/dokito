import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { createWebRequestHandler } from "../../src/web/server";
import {
  createTestWorkspace,
  registerTestArea,
  type TestWorkspace,
} from "../helpers";

/**
 * The state every install starts in. `dokito web` is the first command a new
 * reader runs, so an empty config has to explain itself rather than answer the
 * way a wrong address would.
 */
describe("A workspace with nothing registered", () => {
  let workspace: TestWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
  });

  /** A config file location that no Area has been registered into. */
  async function unregistered(): Promise<(url: string) => Promise<Response>> {
    workspace = await createTestWorkspace();
    const handler = createWebRequestHandler({
      configPath: workspace.configPath,
    });
    return (url: string) => handler(new Request(`http://127.0.0.1${url}`));
  }

  test("welcomes from every unscoped destination", async () => {
    const open = await unregistered();

    // Focus belongs in this list. It is the one view that never redirects to
    // an Area, and its own empty state says "nothing due within 14 days" —
    // which describes finished work rather than an empty workspace.
    for (const address of [
      "/",
      "/tasks",
      "/projects",
      "/resources",
      "/search",
      "/focus",
    ]) {
      const response = await open(address);
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain("Welcome to Dokito");
      expect(body).not.toContain("nothing due within");
    }
  });

  test("says what to run, not only that nothing is there", async () => {
    const open = await unregistered();
    const body = await (await open("/")).text();

    expect(body).toContain("skills/dokito");
    expect(body).toContain("Area called Marketing");
    expect(body).toContain("~/Work/marketing");
    expect(body).toContain("connect this Repository");
    expect(body).toContain("dokito register");
  });

  test("answers root search with an empty index", async () => {
    const open = await unregistered();
    const response = await open("/index.json");

    // A 404 would make every consumer special-case the first run.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  test("stops welcoming once an Area is registered", async () => {
    const created = await createTestWorkspace();
    workspace = created;
    const handler = createWebRequestHandler({ configPath: created.configPath });
    const open = (url: string) =>
      handler(new Request(`http://127.0.0.1${url}`));

    expect((await open("/")).status).toBe(200);

    await registerTestArea({
      cwd: created.root,
      target: created.areaRoot,
      id: "product",
      name: "Product",
      configPath: created.configPath,
    });

    const after = await open("/");
    expect(after.status).toBe(302);
    expect(after.headers.get("location")).toBe("/area/product");
  });
});

/**
 * The failure the welcome screen must not absorb: a registration that exists
 * and no longer resolves leaves the same empty Area list as a fresh install,
 * and hiding it behind a first-run page would lose the only report of it.
 */
describe("A registered Area that has gone missing", () => {
  let workspace: TestWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
  });

  test("reports the broken registration rather than welcoming", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    await rm(workspace.areaRoot, { recursive: true, force: true });

    const handler = createWebRequestHandler({
      configPath: workspace.configPath,
    });
    const response = await handler(new Request("http://127.0.0.1/"));
    const body = await response.text();

    expect(response.status).not.toBe(200);
    expect(body).not.toContain("Welcome to Dokito");
    expect(body).toContain("area_not_found");
  });
});
