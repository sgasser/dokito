import { describe, expect, test } from "bun:test";
import {
  isProjectStatus,
  PROJECT_STATUS_VALUES,
} from "../../src/core/project-model";
import {
  compareTaskOrder,
  isTaskListStatus,
  isTaskPriority,
  isTaskStatus,
  TASK_LIFECYCLE_FILTER_VALUES,
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  taskLifecycleFilterLabel,
  taskPriorityLabel,
  taskStatusLabel,
  taskStatusMatches,
} from "../../src/core/task-model";

describe("Domain model", () => {
  test("keeps accepted status and priority values in one runtime catalog", () => {
    expect(PROJECT_STATUS_VALUES).toEqual([
      "planned",
      "active",
      "done",
      "cancelled",
    ]);
    expect(TASK_STATUS_VALUES).toEqual([
      "todo",
      "in_progress",
      "waiting",
      "someday",
      "done",
      "cancelled",
    ]);
    expect(TASK_PRIORITY_VALUES).toEqual(["low", "normal", "high", "urgent"]);
    expect(TASK_LIFECYCLE_FILTER_VALUES).toEqual(["open", "closed", "all"]);

    expect(isProjectStatus("active")).toBeTrue();
    expect(isProjectStatus("paused")).toBeFalse();
    expect(isTaskStatus("in_progress")).toBeTrue();
    expect(isTaskStatus("open")).toBeFalse();
    expect(isTaskPriority("urgent")).toBeTrue();
    expect(isTaskPriority("critical")).toBeFalse();
    expect(isTaskListStatus("all")).toBeTrue();
    expect(isTaskListStatus("unknown")).toBeFalse();
  });

  test("owns labels, lifecycle behavior, and work ordering", () => {
    expect(taskStatusLabel("in_progress")).toBe("In progress");
    expect(taskPriorityLabel("urgent")).toBe("Urgent");
    expect(taskLifecycleFilterLabel("closed")).toBe("Closed");

    expect(taskStatusMatches("todo", "open")).toBeTrue();
    expect(taskStatusMatches("waiting", "open")).toBeTrue();
    expect(taskStatusMatches("done", "closed")).toBeTrue();
    expect(taskStatusMatches("cancelled", "closed")).toBeTrue();
    expect(taskStatusMatches("done", "open")).toBeFalse();
    expect(taskStatusMatches("done", "all")).toBeTrue();
    expect(taskStatusMatches("todo", "todo")).toBeTrue();
  });

  test("sorts tasks consistently by status, due date, priority, and id", () => {
    const tasks = [
      {
        id: "c",
        status: "todo" as const,
        due: "2026-09-01",
        priority: "urgent" as const,
      },
      {
        id: "b",
        status: "todo" as const,
        due: "2026-08-01",
        priority: "low" as const,
      },
      {
        id: "a",
        status: "in_progress" as const,
        priority: "normal" as const,
      },
      {
        id: "d",
        status: "todo" as const,
        due: "2026-08-01",
        priority: "high" as const,
      },
    ];

    expect(tasks.sort(compareTaskOrder).map((task) => task.id)).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });
});
