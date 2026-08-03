import os from "node:os";
import path from "node:path";
import { pathExists } from "../core/files";
import { verifiedRepositoryPath } from "../core/repositories";
import { compareTaskOrder } from "../core/task-model";
import type { LocalTask, ProjectDocument, TaskStatus } from "../core/types";

const CONDUCTOR_APPLICATIONS = [
  "/Applications/Conductor.app/Contents/Info.plist",
  path.join(os.homedir(), "Applications/Conductor.app/Contents/Info.plist"),
];

type WebWorkAction = {
  kind: "conductor";
  label: "Start in Conductor";
  url: string;
};

export interface WebWorkItem {
  id: string;
  areaId: string;
  areaName: string;
  title: string;
  status: TaskStatus;
  task: LocalTask;
  action?: WebWorkAction;
}

interface WorkItemRepository {
  id: string;
  localPath?: string;
  github?: string;
}

interface BuildWebWorkItemsInput {
  areaId: string;
  areaName: string;
  projects: ProjectDocument[];
  repositories: WorkItemRepository[];
  localTasks: LocalTask[];
  /**
   * List screens do not need to resolve checkout paths or read every Task
   * body. Detail screens opt in for the one selected Task.
   */
  includeLocalActions?: boolean;
  /** Process-local override used by embeddings and deterministic tests. */
  conductorAvailable?: boolean;
}

function repositoryForTask(
  task: LocalTask,
  projects: ReadonlyMap<string, ProjectDocument>,
): string | undefined {
  if (task.repository) {
    return task.repository;
  }

  if (task.project) {
    const projectRepositories = projects.get(task.project)?.repositories ?? [];
    return projectRepositories.length === 1
      ? projectRepositories[0]
      : undefined;
  }

  return undefined;
}

async function safeRepositoryPath(
  repositoryId: string | undefined,
  repositories: ReadonlyMap<string, WorkItemRepository>,
): Promise<string | undefined> {
  if (!repositoryId) {
    return undefined;
  }

  const repository = repositories.get(repositoryId);
  const localPath = repository?.localPath;
  if (!localPath) {
    return undefined;
  }

  return verifiedRepositoryPath(localPath, repository.github);
}

export async function conductorAvailable(
  platform: NodeJS.Platform = process.platform,
  exists: typeof pathExists = pathExists,
): Promise<boolean> {
  if (platform !== "darwin") {
    return false;
  }
  for (const application of CONDUCTOR_APPLICATIONS) {
    if (await exists(application)) {
      return true;
    }
  }
  return false;
}

function conductorUrl(input: {
  areaId: string;
  areaName: string;
  repository: string;
  repositoryPath: string;
  task: LocalTask;
}): string {
  const prompt = [
    `Work on Dokito Task ${input.task.id}: ${input.task.title}`,
    `Area: ${input.areaName} (${input.areaId})`,
    ...(input.task.project ? [`Project: ${input.task.project}`] : []),
    `Repository: ${input.repository}`,
    `Task file: ${input.task.relativePath}`,
    "",
    "Run `dokito context --json`, read the Task file, and follow the installed Dokito skill for its lifecycle and validation workflow.",
  ].join("\n");

  return `conductor://prompt=${encodeURIComponent(prompt)}&path=${encodeURIComponent(input.repositoryPath)}`;
}

async function localAction(
  input: BuildWebWorkItemsInput,
  task: LocalTask,
  projects: ReadonlyMap<string, ProjectDocument>,
  repositories: ReadonlyMap<string, WorkItemRepository>,
): Promise<Extract<WebWorkAction, { kind: "conductor" }> | undefined> {
  if (!(input.conductorAvailable ?? (await conductorAvailable()))) {
    return undefined;
  }

  const repository = repositoryForTask(task, projects);
  const repositoryPath = await safeRepositoryPath(repository, repositories);

  if (repository && repositoryPath) {
    return {
      kind: "conductor",
      label: "Start in Conductor",
      url: conductorUrl({
        areaId: input.areaId,
        areaName: input.areaName,
        repository,
        repositoryPath,
        task,
      }),
    };
  }

  return undefined;
}

export function compareWebWorkItems(a: WebWorkItem, b: WebWorkItem): number {
  return compareTaskOrder(a.task, b.task);
}

export async function buildWebWorkItems(
  input: BuildWebWorkItemsInput,
): Promise<WebWorkItem[]> {
  const projects = new Map(
    input.projects.map((project) => [project.id, project]),
  );
  const repositories = new Map(
    input.repositories.map((repository) => [repository.id, repository]),
  );
  const items = await Promise.all(
    input.localTasks.map(async (task): Promise<WebWorkItem> => {
      const action =
        input.includeLocalActions === false
          ? undefined
          : await localAction(input, task, projects, repositories);
      return {
        id: task.id,
        areaId: input.areaId,
        areaName: input.areaName,
        title: task.title,
        status: task.status,
        task,
        ...(action ? { action } : {}),
      };
    }),
  );

  return items.sort(compareWebWorkItems);
}

/**
 * Enrich one selected local Task with the action that needs filesystem
 * validation. Its full document is loaded beside this item by the detail path;
 * lists stay cheap and keep the same Conductor contract.
 */
export async function enrichWebWorkItem(
  input: BuildWebWorkItemsInput,
  item: WebWorkItem,
): Promise<WebWorkItem> {
  const projects = new Map(
    input.projects.map((project) => [project.id, project]),
  );
  const repositories = new Map(
    input.repositories.map((repository) => [repository.id, repository]),
  );
  const action = await localAction(input, item.task, projects, repositories);
  if (action) {
    return { ...item, action };
  }
  return item;
}
