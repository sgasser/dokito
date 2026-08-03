import { fail } from "./error";
import {
  type LoadedProjects,
  loadProject,
  loadTasks,
  validateSlug,
} from "./manifests";
import { assertProjectRepositoryRelation } from "./relations";
import {
  compareTaskOrder,
  isTaskListStatus,
  TASK_LIFECYCLE_FILTER_VALUES,
  TASK_STATUS_VALUES,
  taskStatusMatches,
} from "./task-model";
import type {
  AreaManifest,
  LocalTask,
  ProjectDocument,
  TaskDocument,
  TaskListResult,
  TaskListStatus,
} from "./types";

interface ListAreaTasksInput {
  areaRoot: string;
  areaManifest: AreaManifest;
  projects: LoadedProjects;
  /**
   * A request-local caller may already have parsed the Task files. Reusing
   * that snapshot keeps one response internally consistent and avoids a
   * second filesystem pass without introducing a persistent cache.
   */
  localTasks?: TaskDocument[];
  status?: string;
}

interface ResolvedTaskListInput extends ListAreaTasksInput {
  repository?: string;
  project?: string;
  warnings: string[];
}

function parseStatus(value: string | undefined): TaskListStatus {
  const status = value ?? "open";
  fail(
    isTaskListStatus(status),
    "task_status_invalid",
    `Invalid Task status filter: ${status}`,
    {
      status,
      allowed: [...TASK_LIFECYCLE_FILTER_VALUES, ...TASK_STATUS_VALUES],
    },
  );
  return status;
}

function localStatusMatches(
  task: TaskDocument,
  status: TaskListStatus,
): boolean {
  return taskStatusMatches(task.status, status);
}

function taskMatchesRepository(
  task: TaskDocument,
  repository: string,
  projects: ReadonlyMap<string, ProjectDocument>,
): boolean {
  if (task.repository === repository) {
    return true;
  }
  return task.project
    ? projects.get(task.project)?.status === "active" &&
        (projects.get(task.project)?.repositories.includes(repository) ?? false)
    : false;
}

/** Drop the Markdown body when a Task enters a compact list surface. */
export function toLocalTask(task: TaskDocument): LocalTask {
  return {
    id: task.id,
    status: task.status,
    ...(task.assignee ? { assignee: task.assignee } : {}),
    ...(task.project ? { project: task.project } : {}),
    ...(task.repository ? { repository: task.repository } : {}),
    ...(task.priority ? { priority: task.priority } : {}),
    ...(task.due ? { due: task.due } : {}),
    title: task.title,
    ...(task.description ? { description: task.description } : {}),
    relativePath: task.relativePath,
  };
}

async function listResolvedTasks(
  input: ResolvedTaskListInput,
): Promise<TaskListResult> {
  const knownRepositories = new Set(
    Object.keys(input.areaManifest.repositories),
  );
  const projects = input.projects;
  const projectMap = new Map(
    projects.projects.map((project) => [project.id, project]),
  );
  const repository = input.repository;
  const projectId = input.project;
  const status = parseStatus(input.status);

  if (repository) {
    validateSlug(repository, "Repository ID");
    fail(
      knownRepositories.has(repository),
      "repository_not_registered",
      `Repository '${repository}' is not registered in Area '${input.areaManifest.id}'.`,
    );
  }
  const project = projectId
    ? await loadProject(input.areaRoot, projectId, knownRepositories)
    : undefined;
  if (project && repository) {
    assertProjectRepositoryRelation(project, repository);
  }

  const loadedTasks =
    input.localTasks ??
    (
      await loadTasks(input.areaRoot, knownRepositories, undefined, {
        projects,
      })
    ).tasks;
  const localTasks = loadedTasks
    .filter((task) => localStatusMatches(task, status))
    .filter((task) => !project || task.project === project.id)
    .filter(
      (task) =>
        !repository || taskMatchesRepository(task, repository, projectMap),
    )
    .sort(compareTaskOrder)
    .map(toLocalTask);

  return {
    area: input.areaManifest.id,
    areaName: input.areaManifest.name,
    ...(repository ? { repository } : {}),
    ...(project ? { project: project.id } : {}),
    status,
    localTasks,
    warnings: input.warnings,
  };
}

export async function listAreaTasks(
  input: ListAreaTasksInput,
): Promise<TaskListResult> {
  return listResolvedTasks({ ...input, warnings: [] });
}
