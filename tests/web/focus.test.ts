import { describe, expect, test } from "bun:test";
import type { ProjectDocument, TaskDocument } from "../../src/core/types";
import { type FocusArea, selectFocus } from "../../src/web/focus";

const NOW = new Date("2026-07-28T12:00:00Z");

function task(input: Partial<TaskDocument> & { id: string }): TaskDocument {
  return {
    status: "todo",
    title: input.id,
    relativePath: `tasks/${input.id}.md`,
    content: "",
    ...input,
  };
}

function project(
  input: Partial<ProjectDocument> & { id: string },
): ProjectDocument {
  return {
    status: "active",
    repositories: [],
    title: input.id,
    relativePath: `projects/${input.id}.md`,
    content: "",
    ...input,
  };
}

function area(input: Partial<FocusArea> & { id: string }): FocusArea {
  return { name: input.id, tasks: [], projects: [], ...input };
}

function bandTitles(
  selection: ReturnType<typeof selectFocus>,
  band: string,
): string[] {
  return (
    selection.bands
      .find((candidate) => candidate.id === band)
      ?.tasks.map((entry) => entry.title) ?? []
  );
}

describe("Focus bands", () => {
  test("lifts urgent work above in progress, whatever its status", () => {
    const selection = selectFocus(
      [
        area({
          id: "product",
          tasks: [
            task({
              id: "a",
              title: "Urgent and in progress",
              status: "in_progress",
              priority: "urgent",
            }),
            task({
              id: "b",
              title: "Urgent and waiting",
              status: "waiting",
              priority: "urgent",
            }),
            task({ id: "c", title: "Merely running", status: "in_progress" }),
          ],
        }),
      ],
      NOW,
      "UTC",
    );

    expect(bandTitles(selection, "urgent")).toEqual([
      "Urgent and in progress",
      "Urgent and waiting",
    ]);
    expect(bandTitles(selection, "in_progress")).toEqual(["Merely running"]);
  });

  test("admits the fourteenth day and refuses the fifteenth", () => {
    const selection = selectFocus(
      [
        area({
          id: "product",
          tasks: [
            task({ id: "a", title: "Day fourteen", due: "2026-08-11" }),
            task({ id: "b", title: "Day fifteen", due: "2026-08-12" }),
            task({ id: "c", title: "Overdue", due: "2026-07-20" }),
            task({ id: "d", title: "Undated" }),
          ],
        }),
      ],
      NOW,
      "UTC",
    );

    expect(bandTitles(selection, "due_soon")).toEqual([
      "Overdue",
      "Day fourteen",
    ]);
    expect(selection.restTasks).toBe(2);
  });

  test("never shows one Task in two bands", () => {
    const selection = selectFocus(
      [
        area({
          id: "product",
          tasks: [
            task({
              id: "a",
              title: "Urgent and due",
              priority: "urgent",
              due: "2026-07-29",
            }),
            task({
              id: "b",
              title: "Running and due",
              status: "in_progress",
              due: "2026-07-29",
            }),
          ],
        }),
      ],
      NOW,
      "UTC",
    );

    expect(selection.shownTasks).toBe(2);
    expect(bandTitles(selection, "due_soon")).toEqual([]);
  });

  test("leaves closed work out and drops the bands that stay empty", () => {
    const selection = selectFocus(
      [
        area({
          id: "product",
          tasks: [
            task({
              id: "a",
              title: "Done and urgent",
              status: "done",
              priority: "urgent",
            }),
            task({
              id: "b",
              title: "Cancelled and due",
              status: "cancelled",
              due: "2026-07-29",
            }),
            task({ id: "c", title: "Running", status: "in_progress" }),
          ],
        }),
      ],
      NOW,
      "UTC",
    );

    expect(selection.bands.map((band) => band.id)).toEqual(["in_progress"]);
    expect(selection.restTasks).toBe(0);
  });

  test("orders every band by how soon the work is due", () => {
    const selection = selectFocus(
      [
        area({
          id: "product",
          tasks: [
            task({
              id: "a",
              title: "Later",
              priority: "urgent",
              due: "2026-08-05",
            }),
            task({ id: "b", title: "Undated", priority: "urgent" }),
            task({
              id: "c",
              title: "Sooner",
              priority: "urgent",
              due: "2026-07-29",
            }),
          ],
        }),
      ],
      NOW,
      "UTC",
    );

    expect(bandTitles(selection, "urgent")).toEqual([
      "Sooner",
      "Later",
      "Undated",
    ]);
  });

  /*
   * What the bands leave behind is decided by the date, not the status. The
   * line under them says so, and it used to say "waiting, someday or undated",
   * which was wrong in both directions at once.
   */
  test("keeps waiting and someday work that is due inside the window", () => {
    const selection = selectFocus(
      [
        area({
          id: "product",
          tasks: [
            task({
              id: "a",
              title: "Waiting, due tomorrow",
              status: "waiting",
              due: "2026-07-29",
            }),
            task({
              id: "b",
              title: "Someday, due next week",
              status: "someday",
              due: "2026-08-03",
            }),
          ],
        }),
      ],
      NOW,
      "UTC",
    );

    expect(bandTitles(selection, "due_soon")).toEqual([
      "Waiting, due tomorrow",
      "Someday, due next week",
    ]);
    expect(selection.restTasks).toBe(0);
  });

  test("leaves behind a plain todo that is due after the window", () => {
    const selection = selectFocus(
      [
        area({
          id: "product",
          tasks: [
            task({
              id: "a",
              title: "Todo, due in three weeks",
              due: "2026-08-20",
            }),
          ],
        }),
      ],
      NOW,
      "UTC",
    );

    expect(selection.shownTasks).toBe(0);
    expect(selection.restTasks).toBe(1);
  });

  test("names only the Areas that actually hold the excluded work", () => {
    const selection = selectFocus(
      [
        area({
          id: "product",
          name: "Product",
          // Everything this Area owns is on screen.
          tasks: [task({ id: "a", status: "in_progress" })],
        }),
        area({
          id: "writing",
          name: "Writing",
          tasks: [task({ id: "b", status: "waiting" })],
        }),
        area({
          id: "personal",
          name: "Personal",
          tasks: [task({ id: "c", status: "someday" })],
        }),
      ],
      NOW,
      "UTC",
    );

    expect(selection.restTasks).toBe(2);
    expect(selection.restAreas).toEqual([
      { id: "personal", name: "Personal", tasks: 1 },
      { id: "writing", name: "Writing", tasks: 1 },
    ]);
  });

  test("puts the Area holding the most left-behind work first", () => {
    const selection = selectFocus(
      [
        area({
          id: "small",
          name: "Small",
          tasks: [task({ id: "a", status: "waiting" })],
        }),
        area({
          id: "big",
          name: "Big",
          tasks: [
            task({ id: "b", status: "waiting" }),
            task({ id: "c", status: "someday" }),
          ],
        }),
      ],
      NOW,
      "UTC",
    );

    expect(selection.restAreas.map((entry) => entry.name)).toEqual([
      "Big",
      "Small",
    ]);
  });

  test("counts the Areas that put something on the screen", () => {
    const selection = selectFocus(
      [
        area({
          id: "product",
          name: "Product",
          tasks: [task({ id: "a", status: "in_progress" })],
        }),
        area({
          id: "writing",
          name: "Writing",
          tasks: [task({ id: "b", status: "waiting" })],
        }),
      ],
      NOW,
      "UTC",
    );

    expect(selection.areasWithTasks).toBe(1);
    expect(selection.restTasks).toBe(1);
  });
});

describe("Focus projects", () => {
  test("names the next Task in band order and counts all open work", () => {
    const selection = selectFocus(
      [
        area({
          id: "product",
          name: "Product",
          projects: [project({ id: "launch", title: "Launch the product" })],
          tasks: [
            task({
              id: "a",
              title: "Running",
              status: "in_progress",
              project: "launch",
            }),
            task({
              id: "b",
              title: "Urgent",
              priority: "urgent",
              project: "launch",
            }),
            task({
              id: "c",
              title: "Waiting",
              status: "waiting",
              project: "launch",
            }),
            task({ id: "d", title: "Done", status: "done", project: "launch" }),
          ],
        }),
      ],
      NOW,
      "UTC",
    );

    expect(selection.projects).toHaveLength(1);
    expect(selection.projects[0]?.nextTask).toBe("Urgent");
    expect(selection.projects[0]?.openTasks).toBe(3);
    expect(selection.projectsOutOfFocus).toBe(0);
  });

  test("counts the Projects the bands do not reach instead of listing them", () => {
    const selection = selectFocus(
      [
        area({
          id: "product",
          projects: [
            project({ id: "reached" }),
            // Open work, but none of it urgent, running or due soon.
            project({ id: "quiet" }),
            // No open work at all.
            project({ id: "finished" }),
          ],
          tasks: [
            task({ id: "a", status: "in_progress", project: "reached" }),
            task({ id: "b", status: "waiting", project: "quiet" }),
            task({ id: "c", status: "done", project: "finished" }),
          ],
        }),
      ],
      NOW,
      "UTC",
    );

    expect(selection.projects.map((entry) => entry.id)).toEqual(["reached"]);
    expect(selection.projectsOutOfFocus).toBe(2);
  });

  test("counts a Project the bands do not reach whatever its status", () => {
    const selection = selectFocus(
      [
        area({
          id: "product",
          projects: [
            project({ id: "live" }),
            project({ id: "planned", status: "planned" }),
            project({ id: "shipped", status: "done" }),
          ],
        }),
      ],
      NOW,
      "UTC",
    );

    // Only the active one is a candidate at all, and it reaches no band.
    expect(selection.projects).toEqual([]);
    expect(selection.projectsOutOfFocus).toBe(1);
  });

  test("keeps two Areas' Projects apart when they share an id", () => {
    const selection = selectFocus(
      [
        area({
          id: "product",
          name: "Product",
          projects: [project({ id: "launch" })],
          tasks: [
            task({
              id: "a",
              title: "Product work",
              status: "in_progress",
              project: "launch",
            }),
          ],
        }),
        area({
          id: "writing",
          name: "Writing",
          projects: [project({ id: "launch" })],
          tasks: [],
        }),
      ],
      NOW,
      "UTC",
    );

    // The Writing Project shares the id but owns none of the work, so it is
    // counted rather than listed with another Area's next Task.
    expect(selection.projects.map((entry) => entry.areaId)).toEqual([
      "product",
    ]);
    expect(selection.projects[0]?.nextTask).toBe("Product work");
    expect(selection.projectsOutOfFocus).toBe(1);
  });
});
