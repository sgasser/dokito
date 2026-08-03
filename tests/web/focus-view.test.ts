import { afterEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { loadFocusView } from "../../src/web/data";
import { createWebRequestHandler } from "../../src/web/server";
import {
  addTestArea,
  createTestWorkspace,
  registerTestArea,
  type TestWorkspace,
} from "../helpers";

/**
 * Focus is measured against a day, so every expectation about its bands names
 * the day it was measured on. The fixture dates sit around this one.
 */
const NOW = new Date("2026-07-28T12:00:00Z");

async function focusWorkspace(
  options: { second?: boolean } = {},
): Promise<TestWorkspace> {
  const workspace = await createTestWorkspace();
  await registerTestArea({
    cwd: workspace.root,
    target: workspace.areaRoot,
    id: "product",
    name: "Product",
    configPath: workspace.configPath,
  });
  if (options.second) {
    await addTestArea(workspace);
  }
  return workspace;
}

function titles(
  data: Awaited<ReturnType<typeof loadFocusView>>,
  band: string,
): string[] {
  return (
    data.bands
      .find((candidate) => candidate.id === band)
      ?.tasks.map((task) => task.title) ?? []
  );
}

describe("Focus", () => {
  let workspace: TestWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  test("bands the active Areas' open work and names the rest", async () => {
    workspace = await focusWorkspace({});
    const data = await loadFocusView({
      configPath: workspace.configPath,
      now: NOW,
    });

    expect(data.view).toBe("focus");
    expect(titles(data, "in_progress")).toEqual([
      "Coordinate the product launch",
    ]);
    expect(titles(data, "due_soon")).toEqual(["Revise the privacy notice"]);
    expect(data.areasWithTasks).toBe(1);
    // Both of the Area's open Tasks are on screen, so nothing is left over.
    expect(data.restTasks).toBe(0);
    expect(data.restAreas).toEqual([]);
    expect(data.selectedArea).toBeUndefined();
  });

  test("holds paused Areas back until the filter asks for them", async () => {
    workspace = await focusWorkspace({ second: true });

    const active = await loadFocusView({
      configPath: workspace.configPath,
      now: NOW,
    });
    expect(titles(active, "urgent")).toEqual([]);
    expect(active.scopeCounts).toEqual({ active: 1, withPaused: 2 });

    const withPaused = await loadFocusView({
      configPath: workspace.configPath,
      includePaused: true,
      now: NOW,
    });
    expect(titles(withPaused, "urgent")).toEqual([
      "Send the essay draft to the editor",
    ]);
    expect(titles(withPaused, "in_progress")).toEqual([
      "Coordinate the product launch",
      "Rewrite the opening of the second essay",
    ]);
    expect(withPaused.areasWithTasks).toBe(2);
    /*
     * Only Writing has open work the bands left behind. Naming every Area in
     * scope would put Product in a sentence about work it is not holding.
     */
    expect(withPaused.restTasks).toBe(1);
    expect(withPaused.restAreas).toEqual([
      { id: "writing", name: "Writing", tasks: 1 },
    ]);
  });

  test("never admits an archived Area, whatever the filter says", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    const second = await addTestArea(workspace);
    await writeFile(
      path.join(second, "context.md"),
      "---\nstate: archived\n---\n\n# Writing\n\nArchived for this test.\n",
      "utf8",
    );

    for (const includePaused of [false, true]) {
      const data = await loadFocusView({
        configPath: workspace.configPath,
        includePaused,
        now: NOW,
      });
      /*
       * The same Area and the same urgent Task due in two days that the
       * paused test sees at the top of the list. Archiving is the only
       * difference, and neither setting of the filter lets it back in.
       */
      expect(JSON.stringify(data.bands)).not.toContain(
        "Send the essay draft to the editor",
      );
      expect(data.restAreas.map((entry) => entry.name)).not.toContain(
        "Writing",
      );
    }
  });

  test("says what it looked for when no Area is in scope", async () => {
    // A workspace whose only Area is paused: the default scope is empty, so
    // this covers both the empty state and having no Area to read at all.
    workspace = await createTestWorkspace();
    await addTestArea(workspace);

    const data = await loadFocusView({
      configPath: workspace.configPath,
      now: NOW,
    });
    expect(data.bands).toEqual([]);
    expect(data.projects).toEqual([]);
    expect(data.shownTasks).toBe(0);
    expect(data.restTasks).toBe(0);
    expect(data.restAreas).toEqual([]);

    const request = createWebRequestHandler({
      configPath: workspace.configPath,
    });
    const response = await request(new Request("http://127.0.0.1/focus"));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(
      "Nothing urgent, nothing in progress, nothing due within 14 days.",
    );
    // Nothing is left out either, so the exclusion line must stay silent,
    // and an "Active Projects 0" heading would only restate the emptiness.
    expect(html).not.toContain("further open Task");
    expect(html).not.toContain("Active Projects");
  });

  test("summarizes the active Projects of the Areas in scope", async () => {
    workspace = await focusWorkspace({ second: true });
    const data = await loadFocusView({
      configPath: workspace.configPath,
      includePaused: true,
      now: NOW,
    });

    const launch = data.projects.find((project) => project.id === "launch");
    expect(launch?.areaName).toBe("Product");
    expect(launch?.openTasks).toBe(2);
    expect(launch?.nextTask).toBe("Coordinate the product launch");

    const essays = data.projects.find((project) => project.id === "essays");
    expect(essays?.areaName).toBe("Writing");
    expect(essays?.nextTask).toBe("Send the essay draft to the editor");

    // The newsletter Project is active and carries no Task, so it is counted
    // rather than listed: a row saying "nothing here" beside the work that is
    // in Focus is what buried the screen at real scale.
    expect(data.projects.map((entry) => entry.id)).not.toContain("newsletter");
    expect(data.projectsOutOfFocus).toBe(1);
  });
});

describe("The Focus route", () => {
  let workspace: TestWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  test("answers at /focus without redirecting to an Area", async () => {
    workspace = await focusWorkspace({ second: true });
    const request = createWebRequestHandler({
      configPath: workspace.configPath,
    });

    const response = await request(new Request("http://127.0.0.1/focus"));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('data-focus-view=""');
    expect(html).toContain("Dokito — Focus");
    expect(html).toContain("Coordinate the product launch");
    expect(html).not.toContain(
      "Use a staged launch once every surface reports ready.",
    );
    expect(html).toContain("Active Projects");
    // The paused Area is out of scope until the filter asks for it.
    expect(html).not.toContain("Rewrite the opening of the second essay");
  });

  test("marks Focus as the current destination and keeps its alias", async () => {
    workspace = await focusWorkspace({});
    const request = createWebRequestHandler({
      configPath: workspace.configPath,
    });

    const html = await (
      await request(new Request("http://127.0.0.1/focus"))
    ).text();
    expect(html).toContain('href="/focus" aria-current="page"');
    expect(html).toContain('data-palette-alias="gf"');
  });

  test("includes paused Areas when the filter asks", async () => {
    workspace = await focusWorkspace({ second: true });
    const request = createWebRequestHandler({
      configPath: workspace.configPath,
    });

    const html = await (
      await request(new Request("http://127.0.0.1/focus?areas=paused"))
    ).text();
    expect(html).toContain("Rewrite the opening of the second essay");
    expect(html).toContain("Ship the essay series");
  });

  test("says how much open work it is leaving out", async () => {
    workspace = await focusWorkspace({ second: true });
    const request = createWebRequestHandler({
      configPath: workspace.configPath,
    });

    const html = await (
      await request(new Request("http://127.0.0.1/focus?areas=paused"))
    ).text();
    // The waiting, undated Task is in no band, so the line has to account
    // for it rather than let the screen imply it showed everything.
    expect(html).not.toContain("Find a cover illustrator");
    expect(html).toContain("1 further open Task is undated or due later");
    // The line is the way there: one link per Area, carrying its own count
    // and landing on that Area's Tasks list with no filter carried across.
    expect(html).toContain('href="/area/writing/tasks"');
    expect(html).toContain("1 in Writing");
    // The Project the bands do not reach is counted, not given a row.
    expect(html).not.toContain("Restart the newsletter");
    expect(html).toContain("1 active Project has nothing in Focus.");
  });

  test("reads the Areas it leaves out as one sentence", async () => {
    workspace = await focusWorkspace({ second: true });
    // Give the Product Area something the bands cannot reach either, so the
    // line has two Areas to join rather than one to state.
    await writeFile(
      path.join(
        workspace.areaRoot,
        "tasks",
        "01K1ABFXYZ0000000000000000-retire-the-old-pricing-page.md",
      ),
      "---\nstatus: someday\n---\n\n# Retire the old pricing page\n\nUndated.\n",
      "utf8",
    );
    const request = createWebRequestHandler({
      configPath: workspace.configPath,
    });

    const html = await (
      await request(new Request("http://127.0.0.1/focus?areas=paused"))
    ).text();
    expect(html).toContain("2 further open Tasks are undated or due later: ");
    // Both counts are links, joined the way a sentence joins them.
    expect(html).toContain('href="/area/product/tasks">1 in Product</a>');
    expect(html).toContain(" and <a");
    expect(html).toContain('href="/area/writing/tasks">1 in Writing</a>');
  });

  test("refuses a scope it does not offer", async () => {
    workspace = await focusWorkspace({});
    const request = createWebRequestHandler({
      configPath: workspace.configPath,
    });

    const response = await request(
      new Request("http://127.0.0.1/focus?areas=all"),
    );
    expect(response.status).toBe(400);
  });
});
