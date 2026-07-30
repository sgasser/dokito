import {
  type TaskStatus,
  taskStatusLabel,
  taskStatusMatches,
} from "../core/task-model";
import type { ProjectDocument } from "../core/types";
import type { WebWorkItem } from "./work-items";
import { compareWebWorkItems } from "./work-items";

/**
 * The Urgent group is a presentation grouping, not a stored status: an open
 * Task carrying `priority: urgent` is lifted above In progress so that the
 * thing that cannot wait is the first thing on the page.
 */
export type WorkGroup = "urgent" | TaskStatus;

const WORK_GROUP_ORDER: readonly WorkGroup[] = [
  "urgent",
  "in_progress",
  "todo",
  "waiting",
  "someday",
  "done",
  "cancelled",
];

function workGroupLabel(group: WorkGroup): string {
  return group === "urgent" ? "Urgent" : taskStatusLabel(group);
}

const LOCAL_WORK_ITEM_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isWorkItemId(id: string): boolean {
  return LOCAL_WORK_ITEM_ID.test(id);
}

export function workItemGroup(item: WebWorkItem): WorkGroup {
  const urgent =
    item.task.priority === "urgent" && taskStatusMatches(item.status, "open");
  return urgent ? "urgent" : item.status;
}

export interface WorkGroupBucket {
  group: WorkGroup;
  label: string;
  items: WebWorkItem[];
}

export function groupWorkItems(
  items: readonly WebWorkItem[],
): WorkGroupBucket[] {
  const buckets = new Map<WorkGroup, WebWorkItem[]>();
  for (const item of items) {
    const group = workItemGroup(item);
    const bucket = buckets.get(group);
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.set(group, [item]);
    }
  }

  return WORK_GROUP_ORDER.flatMap((group) => {
    const items = buckets.get(group);
    return items
      ? [
          {
            group,
            label: workGroupLabel(group),
            items: items.sort(compareWebWorkItems),
          },
        ]
      : [];
  });
}

export interface WorkFilter {
  project?: string;
  repository?: string;
}

export function workItemMatches(
  item: WebWorkItem,
  filter: WorkFilter,
): boolean {
  if (filter.project && item.task.project !== filter.project) {
    return false;
  }
  if (filter.repository && item.task.repository !== filter.repository) {
    return false;
  }
  return true;
}

/** Counts for one facet value, so a filter can show what it would select. */
export interface Facet<T extends string> {
  value: T;
  label: string;
  count: number;
}

export interface ProjectSummary {
  id: string;
  title: string;
  status: ProjectDocument["status"];
  outcome?: string;
  note?: string;
  due?: string;
  repositories: string[];
  path: string;
  openTasks: number;
  totalTasks: number;
  /** The Task a reader should look at next, by the shared work ordering. */
  nextTask?: { id: string; title: string };
}

export function summarizeProject(
  project: ProjectDocument,
  items: readonly WebWorkItem[],
): ProjectSummary {
  const projectItems = items.filter((item) => item.task.project === project.id);
  const open = projectItems
    .filter((item) => taskStatusMatches(item.status, "open"))
    .sort(compareWebWorkItems);
  const next = open[0];

  return {
    id: project.id,
    title: project.title,
    status: project.status,
    ...(project.outcome ? { outcome: project.outcome } : {}),
    ...(project.note ? { note: project.note } : {}),
    ...(project.due ? { due: project.due } : {}),
    repositories: project.repositories,
    path: project.relativePath,
    openTasks: open.length,
    totalTasks: projectItems.length,
    ...(next ? { nextTask: { id: next.id, title: next.title } } : {}),
  };
}

/**
 * The documents a Project brings with it: its own file and whatever it links
 * to. Nothing is registered anywhere — a Project reaches its Resources by
 * linking to them, the same way a reader would.
 */
export function projectDocumentPaths(
  project: ProjectDocument,
  outboundLinks: readonly string[],
): string[] {
  return [...new Set([project.relativePath, ...outboundLinks])];
}
