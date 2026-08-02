import {
  type TaskPriority,
  type TaskStatus,
  taskStatusMatches,
} from "../core/task-model";
import type { ProjectDocument, TaskDocument } from "../core/types";
import { dueInDays } from "./format";

/**
 * Focus admits three bands and says so. What the bands leave behind is decided
 * by the date, not by the status: everything still open that is neither urgent
 * nor in progress is admitted when it falls due inside this window, so the
 * rest is exactly the work that is undated or due later. A waiting Task due
 * tomorrow is on the screen; a todo due in three weeks is not.
 */
export const FOCUS_WINDOW_DAYS = 14;

export type FocusBandId = "urgent" | "in_progress" | "due_soon";

/** One Area's contribution, already narrowed to the Areas in scope. */
export interface FocusArea {
  id: string;
  name: string;
  tasks: readonly TaskDocument[];
  projects: readonly ProjectDocument[];
}

export interface FocusTask {
  id: string;
  areaId: string;
  areaName: string;
  title: string;
  status: TaskStatus;
  priority?: TaskPriority;
  /** The Project's own title, or its id when no Project file carries one. */
  project?: string;
  projectId?: string;
  due?: string;
  /** Negative when overdue, absent when the Task carries no readable date. */
  dueDays?: number;
}

interface FocusBand {
  id: FocusBandId;
  label: string;
  /** Said only where the band's name does not already say it. */
  note?: string;
  tasks: FocusTask[];
}

export interface FocusProject {
  id: string;
  areaId: string;
  areaName: string;
  title: string;
  openTasks: number;
  /** The first of this Project's Tasks in band order. */
  nextTask: string;
  due?: string;
  dueDays?: number;
}

export interface FocusSelection {
  bands: FocusBand[];
  /** Active Projects the bands reach. */
  projects: FocusProject[];
  /**
   * Active Projects in scope that the bands do not reach, counted rather than
   * listed. Most Projects are not in Focus most of the time; a row each would
   * bury the ones that are, and a marker carried by the majority marks
   * nothing. Why a Project is quiet is the Projects view's question.
   */
  projectsOutOfFocus: number;
  /** Tasks across all three bands. */
  shownTasks: number;
  /** Open Tasks in scope that no band admits. */
  restTasks: number;
  /**
   * The Areas holding that excluded work, each with its own count. Only the
   * Areas that hold some: an Area with nothing left over must not be listed
   * as if it were hiding something. One entry per Area rather than one total,
   * because a Tasks list is Area-scoped and this rest is not — a single way
   * in would have to pick an Area silently.
   */
  restAreas: FocusRestArea[];
  /** Areas that put at least one Task on the screen. */
  areasWithTasks: number;
}

interface FocusRestArea {
  id: string;
  name: string;
  tasks: number;
}

/** Identity is Area plus id: a Task id is unique inside an Area, not across. */
function key(task: FocusTask): string {
  return `${task.areaId}:${task.id}`;
}

/**
 * Soonest first, undated last. Nothing sorts by priority inside a band —
 * within Urgent every row is urgent, so the date is what distinguishes them.
 */
function byDue(a: FocusTask, b: FocusTask): number {
  const left = a.dueDays ?? Number.MAX_SAFE_INTEGER;
  const right = b.dueDays ?? Number.MAX_SAFE_INTEGER;
  return (
    left - right || a.areaId.localeCompare(b.areaId) || a.id.localeCompare(b.id)
  );
}

function toFocusTask(
  area: FocusArea,
  task: TaskDocument,
  projectTitles: ReadonlyMap<string, string>,
  now: Date,
  timeZone?: string,
): FocusTask {
  const days = dueInDays(task.due, now, timeZone);
  return {
    id: task.id,
    areaId: area.id,
    areaName: area.name,
    title: task.title,
    status: task.status,
    ...(task.priority ? { priority: task.priority } : {}),
    ...(task.project
      ? {
          projectId: task.project,
          project: projectTitles.get(task.project) ?? task.project,
        }
      : {}),
    ...(task.due ? { due: task.due } : {}),
    ...(days === undefined ? {} : { dueDays: days }),
  };
}

/**
 * The three bands are disjoint and ordered: anything urgent that is still open
 * whatever its status, then work in progress, then whatever else falls due
 * inside the window. Urgent is a band rather than a status because a Task can
 * be urgent and in progress at once.
 */
function partition(open: readonly FocusTask[]): FocusBand[] {
  const urgent = open.filter((task) => task.priority === "urgent").sort(byDue);
  const inProgress = open
    .filter(
      (task) => task.priority !== "urgent" && task.status === "in_progress",
    )
    .sort(byDue);
  const taken = new Set([...urgent, ...inProgress].map(key));
  const dueSoon = open
    .filter(
      (task) =>
        !taken.has(key(task)) &&
        task.dueDays !== undefined &&
        task.dueDays <= FOCUS_WINDOW_DAYS,
    )
    .sort(byDue);

  const bands: FocusBand[] = [
    { id: "urgent", label: "Urgent", tasks: urgent },
    { id: "in_progress", label: "In progress", tasks: inProgress },
    {
      id: "due_soon",
      label: "Due soon",
      note: `within ${FOCUS_WINDOW_DAYS} days`,
      tasks: dueSoon,
    },
  ];
  // An empty band is not a band. A zero count would only say that the rule
  // found nothing, which the missing heading says more quietly.
  return bands.filter((band) => band.tasks.length > 0);
}

/**
 * The Projects section follows the same rule as the bands above it: what the
 * rule reaches is listed, what it does not is counted. Listing every active
 * Project instead turned the section into a wall of "nothing here" beside the
 * two Tasks that were the point of the screen.
 */
function summarizeProjects(
  areas: readonly FocusArea[],
  shown: readonly FocusTask[],
  now: Date,
  timeZone?: string,
): { projects: FocusProject[]; projectsOutOfFocus: number } {
  const projects: FocusProject[] = [];
  let outOfFocus = 0;

  for (const area of areas) {
    for (const project of area.projects) {
      if (project.status !== "active") {
        continue;
      }
      const next = shown.find(
        (task) => task.areaId === area.id && task.projectId === project.id,
      );
      if (!next) {
        outOfFocus += 1;
        continue;
      }
      const days = dueInDays(project.due, now, timeZone);
      projects.push({
        id: project.id,
        areaId: area.id,
        areaName: area.name,
        title: project.id,
        openTasks: area.tasks.filter(
          (task) =>
            task.project === project.id &&
            taskStatusMatches(task.status, "open"),
        ).length,
        nextTask: next.title,
        ...(project.due ? { due: project.due } : {}),
        ...(days === undefined ? {} : { dueDays: days }),
      });
    }
  }

  return { projects, projectsOutOfFocus: outOfFocus };
}

/**
 * What needs the reader now, across every Area in scope. The caller decides
 * which Areas those are; this decides what inside them earns the screen.
 */
export function selectFocus(
  areas: readonly FocusArea[],
  now: Date = new Date(),
  timeZone?: string,
): FocusSelection {
  const open = areas.flatMap((area) => {
    const projectTitles = new Map(
      area.projects.map((project) => [project.id, project.title]),
    );
    return area.tasks
      .filter((task) => taskStatusMatches(task.status, "open"))
      .map((task) => toFocusTask(area, task, projectTitles, now, timeZone));
  });

  const bands = partition(open);
  const shown = bands.flatMap((band) => band.tasks);
  const shownKeys = new Set(shown.map(key));
  const rest = open.filter((task) => !shownKeys.has(key(task)));

  return {
    bands,
    ...summarizeProjects(areas, shown, now, timeZone),
    shownTasks: shown.length,
    restTasks: rest.length,
    restAreas: countByArea(rest),
    areasWithTasks: new Set(shown.map((task) => task.areaId)).size,
  };
}

/** Most left behind first, so the heaviest Area list is the nearest one. */
function countByArea(tasks: readonly FocusTask[]): FocusRestArea[] {
  const areas = new Map<string, FocusRestArea>();
  for (const task of tasks) {
    const entry = areas.get(task.areaId);
    if (entry) {
      entry.tasks += 1;
    } else {
      areas.set(task.areaId, {
        id: task.areaId,
        name: task.areaName,
        tasks: 1,
      });
    }
  }
  return [...areas.values()].sort(
    (a, b) => b.tasks - a.tasks || a.name.localeCompare(b.name),
  );
}
