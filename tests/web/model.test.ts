import { describe, expect, test } from "bun:test";
import type { LocalTask, ProjectDocument } from "../../src/core/types";
import {
  groupWorkItems,
  isWorkItemId,
  projectDocumentPaths,
  summarizeProject,
  workItemGroup,
  workItemMatches,
} from "../../src/web/model";
import type { WebWorkItem } from "../../src/web/work-items";

function localTask(overrides: Partial<LocalTask> = {}): LocalTask {
  return {
    id: "01K1ABCXYZ0000000000000000",
    status: "todo",
    title: "A local Task",
    relativePath: "tasks/01K1ABCXYZ0000000000000000-a-local-task.md",
    ...overrides,
  };
}

function local(task: LocalTask): WebWorkItem {
  return {
    id: task.id,
    areaId: "product",
    areaName: "Product",
    title: task.title,
    status: task.status,
    task,
  };
}

describe("Work grouping", () => {
  test("lifts an urgent open Task above its status", () => {
    expect(
      workItemGroup(local(localTask({ status: "todo", priority: "urgent" }))),
    ).toBe("urgent");
  });

  test("leaves a completed Task in its own group", () => {
    expect(
      workItemGroup(local(localTask({ status: "done", priority: "urgent" }))),
    ).toBe("done");
  });

  test("orders groups from urgent to cancelled and drops empty ones", () => {
    const groups = groupWorkItems([
      local(localTask({ id: "d", status: "done" })),
      local(localTask({ id: "u", status: "todo", priority: "urgent" })),
      local(localTask({ id: "t", status: "todo" })),
      local(localTask({ id: "p", status: "in_progress" })),
    ]);

    expect(groups.map((group) => group.group)).toEqual([
      "urgent",
      "in_progress",
      "todo",
      "done",
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      "Urgent",
      "In progress",
      "To do",
      "Done",
    ]);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["u"]);
  });
});

describe("Work Item identities", () => {
  test("accepts only complete local Task identities", () => {
    expect(isWorkItemId("01K1ABCXYZ0000000000000000")).toBeTrue();
    expect(isWorkItemId("not-a-task")).toBeFalse();
    expect(isWorkItemId("01K1ABC")).toBeFalse();
  });
});

describe("Work filters", () => {
  const item = local(localTask({ project: "launch", repository: "web-app" }));

  test("matches an empty filter", () => {
    expect(workItemMatches(item, {})).toBe(true);
  });

  test("filters by Project and Repository", () => {
    expect(workItemMatches(item, { project: "launch" })).toBe(true);
    expect(workItemMatches(item, { project: "onboarding" })).toBe(false);
    expect(workItemMatches(item, { repository: "web-app" })).toBe(true);
    expect(workItemMatches(item, { repository: "website" })).toBe(false);
  });
});

describe("Project summaries", () => {
  const project: ProjectDocument = {
    id: "launch",
    status: "active",
    repositories: ["web-app", "api"],
    due: "2026-08-12",
    title: "Launch the product",
    outcome: "The release is verified.",
    note: "Documentation must match.",
    relativePath: "projects/launch.md",
    content: "",
  };

  test("counts open against total and names the next Task", () => {
    const summary = summarizeProject(project, [
      local(localTask({ id: "c", status: "done", project: "launch" })),
      local(
        localTask({
          id: "b",
          status: "todo",
          project: "launch",
          due: "2026-08-05",
        }),
      ),
      local(localTask({ id: "a", status: "in_progress", project: "launch" })),
      local(localTask({ id: "x", status: "todo", project: "onboarding" })),
    ]);

    expect(summary.openTasks).toBe(2);
    expect(summary.totalTasks).toBe(3);
    expect(summary.nextTask).toEqual({
      id: "a",
      title: "A local Task",
    });
  });

  test("keeps the Project document and deduplicates linked paths", () => {
    expect(
      projectDocumentPaths(project, [
        "resources/release.md",
        "projects/launch.md",
      ]),
    ).toEqual(["projects/launch.md", "resources/release.md"]);
  });
});
