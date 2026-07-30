import { loadRegisteredAreas, type RegisteredArea } from "./areas";
import { loadConfig } from "./config";
import { normalizeError } from "./error";
import {
  type DocumentProblem,
  documentProblemWarning,
  loadProjects,
  loadTasks,
} from "./manifests";
import { compareTaskOrder } from "./task-model";
import type { ProjectDocument, TaskDocument } from "./types";

interface AreaIdentity {
  area: string;
  areaName: string;
  areaRoot: string;
}

type ListedProject = AreaIdentity & Omit<ProjectDocument, "content">;
type ListedTask = AreaIdentity & Omit<TaskDocument, "content">;

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
          items,
          warnings: problems.map((problem) =>
            documentProblemWarning(id, problem),
          ),
        };
      } catch (error) {
        return {
          ok: false as const,
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
    areaCount: results.filter((result) => result.ok).length,
    items: results.flatMap((result) => (result.ok ? result.items : [])),
    warnings: [
      ...registered.warnings,
      ...results.flatMap((result) => result.warnings),
    ],
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

export async function listRegisteredProjects(input: { configPath: string }) {
  const loaded = await readRegisteredItems(
    input.configPath,
    "Projects",
    async (id, area) => {
      const repositories = new Set(Object.keys(area.manifest.repositories));
      const { projects, problems } = await loadProjects(
        area.root,
        repositories,
      );
      return {
        items: projects.map((project) => ({
          ...identity(id, area),
          ...omitContent(project),
        })),
        problems,
      };
    },
  );

  return {
    configPath: loaded.configPath,
    areaCount: loaded.areaCount,
    projects: loaded.items.sort(compareProjects),
    warnings: loaded.warnings,
  };
}

export async function listRegisteredTasks(input: { configPath: string }) {
  const loaded = await readRegisteredItems(
    input.configPath,
    "Tasks",
    async (id, area) => {
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
    },
  );

  return {
    configPath: loaded.configPath,
    areaCount: loaded.areaCount,
    tasks: loaded.items.sort(compareTasks),
    warnings: loaded.warnings,
  };
}
