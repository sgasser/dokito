import { loadRegisteredAreas, type RegisteredArea } from "./areas";
import { loadConfig } from "./config";
import { DokitoError, normalizeError } from "./error";
import {
  type DocumentProblem,
  documentProblemWarning,
  loadProjects,
  loadTasks,
} from "./manifests";
import { PROJECT_STATUS_VALUES, type ProjectStatus } from "./project-model";
import {
  compareTaskOrder,
  TASK_STATUS_VALUES,
  type TaskStatus,
} from "./task-model";
import type { ProjectDocument, TaskDocument } from "./types";

interface AreaIdentity {
  area: string;
  areaName: string;
  areaRoot: string;
}

type ListedProject = AreaIdentity & Omit<ProjectDocument, "content">;
type ListedTask = AreaIdentity & Omit<TaskDocument, "content">;

/** Narrowing here keeps a selection answerable without a second tool. */
interface InventoryQuery<Status extends string> {
  configPath: string;
  area?: string;
  status?: Status;
}

type ProjectQuery = InventoryQuery<ProjectStatus>;
type TaskQuery = InventoryQuery<TaskStatus>;

/** Counts an overview needs, so a caller never reads every item for them. */
export interface InventorySummary<Status extends string> {
  configPath: string;
  areaCount: number;
  total: number;
  byStatus: Record<Status, number>;
  byArea: Record<string, number>;
  warnings: string[];
}

const PROJECT_STATUS_ORDER: Record<ProjectDocument["status"], number> = {
  active: 0,
  planned: 1,
  done: 2,
  cancelled: 3,
};

function identity(id: string, area: RegisteredArea): AreaIdentity {
  return {
    area: id,
    areaName: area.manifest.name,
    areaRoot: area.root,
  };
}

function omitContent<T extends { content: string }>(
  document: T,
): Omit<T, "content"> {
  const metadata = { ...document };
  Reflect.deleteProperty(metadata, "content");
  return metadata;
}

async function readRegisteredItems<T>(
  configPath: string,
  collection: "Projects" | "Tasks",
  read: (
    id: string,
    area: RegisteredArea,
  ) => Promise<{ items: T[]; problems: readonly DocumentProblem[] }>,
) {
  const registered = await loadRegisteredAreas(await loadConfig(configPath));
  const results = await Promise.all(
    [...registered.areas].map(async ([id, area]) => {
      try {
        const { items, problems } = await read(id, area);
        return {
          ok: true as const,
          id,
          items,
          warnings: problems.map((problem) =>
            documentProblemWarning(id, problem),
          ),
        };
      } catch (error) {
        return {
          ok: false as const,
          id,
          warnings: [
            `Skipped Area '${id}' while reading ${collection}: ${
              normalizeError(error).message
            }`,
          ],
        };
      }
    }),
  );

  return {
    configPath,
    /** Only Areas that were read at all, so a skipped one stays visible. */
    areaIds: results.flatMap((result) => (result.ok ? [result.id] : [])),
    items: results.flatMap((result) => (result.ok ? result.items : [])),
    warnings: [
      ...registered.warnings,
      ...results.flatMap((result) => result.warnings),
    ],
  };
}

/**
 * A named Area that was not read is a mistyped name, not an empty collection,
 * so it fails rather than answering with nothing.
 */
function select<Item extends { area: string; status: string }>(
  loaded: {
    configPath: string;
    areaIds: string[];
    items: Item[];
    warnings: string[];
  },
  query: { area?: string; status?: string },
) {
  const { area, status } = query;
  if (area !== undefined && !loaded.areaIds.includes(area)) {
    throw new DokitoError(
      "area_not_found",
      `No readable Area '${area}'. Readable Areas: ${
        loaded.areaIds.join(", ") || "none"
      }.`,
      { area, readable: loaded.areaIds },
    );
  }
  return {
    ...loaded,
    areaIds: area === undefined ? loaded.areaIds : [area],
    items: loaded.items.filter(
      (item) =>
        (area === undefined || item.area === area) &&
        (status === undefined || item.status === status),
    ),
  };
}

function summarize<Status extends string>(
  loaded: {
    configPath: string;
    areaIds: string[];
    items: Array<{ area: string; status: Status }>;
    warnings: string[];
  },
  statuses: readonly Status[],
): InventorySummary<Status> {
  const byStatus = Object.fromEntries(
    statuses.map((status) => [status, 0]),
  ) as Record<Status, number>;
  const byArea = Object.fromEntries(loaded.areaIds.map((id) => [id, 0]));
  for (const item of loaded.items) {
    byStatus[item.status] += 1;
    byArea[item.area] = (byArea[item.area] ?? 0) + 1;
  }

  return {
    configPath: loaded.configPath,
    areaCount: loaded.areaIds.length,
    total: loaded.items.length,
    byStatus,
    byArea,
    warnings: loaded.warnings,
  };
}

function compareProjects(a: ListedProject, b: ListedProject): number {
  const status =
    PROJECT_STATUS_ORDER[a.status] - PROJECT_STATUS_ORDER[b.status];
  if (status !== 0) {
    return status;
  }
  const due = (a.due ?? "9999-99-99").localeCompare(b.due ?? "9999-99-99");
  if (due !== 0) {
    return due;
  }
  const area = a.area.localeCompare(b.area);
  return area !== 0 ? area : a.id.localeCompare(b.id);
}

function compareTasks(a: ListedTask, b: ListedTask): number {
  const order = compareTaskOrder(a, b);
  return order !== 0 ? order : a.area.localeCompare(b.area);
}

function readProjects(configPath: string) {
  return readRegisteredItems(configPath, "Projects", async (id, area) => {
    const repositories = new Set(Object.keys(area.manifest.repositories));
    const { projects, problems } = await loadProjects(area.root, repositories);
    return {
      items: projects.map((project) => ({
        ...identity(id, area),
        ...omitContent(project),
      })),
      problems,
    };
  });
}

export async function listRegisteredProjects(input: ProjectQuery) {
  const loaded = select(await readProjects(input.configPath), input);

  return {
    configPath: loaded.configPath,
    areaCount: loaded.areaIds.length,
    projects: loaded.items.sort(compareProjects),
    warnings: loaded.warnings,
  };
}

export async function summarizeRegisteredProjects(
  input: ProjectQuery,
): Promise<InventorySummary<ProjectStatus>> {
  return summarize(
    select(await readProjects(input.configPath), input),
    PROJECT_STATUS_VALUES,
  );
}

function readTasks(configPath: string) {
  return readRegisteredItems(configPath, "Tasks", async (id, area) => {
    const repositories = new Set(Object.keys(area.manifest.repositories));
    const projects = await loadProjects(area.root, repositories);
    const { tasks, problems } = await loadTasks(
      area.root,
      repositories,
      undefined,
      { projects },
    );
    return {
      items: tasks.map((task) => ({
        ...identity(id, area),
        ...omitContent(task),
      })),
      problems: [...projects.problems, ...problems],
    };
  });
}

export async function listRegisteredTasks(input: TaskQuery) {
  const loaded = select(await readTasks(input.configPath), input);

  return {
    configPath: loaded.configPath,
    areaCount: loaded.areaIds.length,
    tasks: loaded.items.sort(compareTasks),
    warnings: loaded.warnings,
  };
}

export async function summarizeRegisteredTasks(
  input: TaskQuery,
): Promise<InventorySummary<TaskStatus>> {
  return summarize(
    select(await readTasks(input.configPath), input),
    TASK_STATUS_VALUES,
  );
}
