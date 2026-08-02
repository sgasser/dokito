import { fail } from "../../core/error";
import {
  isTaskLifecycleFilter,
  type TaskLifecycleFilter,
  taskStatusMatches,
} from "../../core/task-model";
import { isWorkItemId, type WorkFilter, workItemMatches } from "../model";
import { enrichWebWorkItem } from "../work-items";
import { documentRefs, loadEachArea, loadWorkArea } from "./areas";
import { WorkspaceSnapshot, type WorkspaceSnapshotInput } from "./snapshot";
import type { WebTasksDashboardData } from "./types";

export interface TasksViewInput extends WorkspaceSnapshotInput {
  task?: string;
  status?: string;
  project?: string;
  repository?: string;
}

function parseStatus(value: string | undefined): TaskLifecycleFilter {
  const status = value ?? "open";
  fail(
    isTaskLifecycleFilter(status),
    "task_status_invalid",
    `Invalid Web status filter: ${status}`,
  );
  return status;
}

function loadTaskAreas(snapshot: WorkspaceSnapshot) {
  const { scope } = snapshot;
  return loadEachArea(snapshot, scope.scoped, async (area) => {
    const [projects, localTasks] = await Promise.all([
      snapshot.loadedProjects(area),
      snapshot.tasks(area),
    ]);
    return loadWorkArea({
      area,
      config: scope.config,
      projects,
      localTasks,
    });
  });
}

export async function loadTasksView(
  input: TasksViewInput,
): Promise<WebTasksDashboardData> {
  fail(
    input.task === undefined || isWorkItemId(input.task),
    "task_not_found",
    `Task not found: ${input.task ?? ""}`,
  );
  const snapshot = await WorkspaceSnapshot.create(input);
  const { scope } = snapshot;
  const status = parseStatus(input.status);

  // Only the Areas on screen are read. The switcher names Areas without
  // counts, so loading the rest would be work nothing renders.
  const [shown, navigation] = await Promise.all([
    loadTaskAreas(snapshot),
    snapshot.navigation(),
  ]);
  const inScope = shown.loaded;
  const all = inScope.flatMap((area) => area.workItems);
  const inLifecycle = all.filter((item) => {
    return taskStatusMatches(item.status, status);
  });

  const filter: WorkFilter = {
    ...(input.project ? { project: input.project } : {}),
    ...(input.repository ? { repository: input.repository } : {}),
  };
  const items = inLifecycle.filter((item) => workItemMatches(item, filter));

  const selected = input.task
    ? all.find((item) => item.id === input.task)
    : undefined;
  fail(
    input.task === undefined || selected !== undefined,
    "task_not_found",
    `Task not found${scope.selectedArea ? ` in Area '${scope.selectedArea}'` : ""}: ${input.task ?? ""}`,
  );
  const selectedEntry = selected
    ? inScope.find((area) => area.id === selected.areaId)
    : undefined;
  const selectedRoot = selected
    ? scope.scoped.find((area) => area.manifest.id === selected.areaId)
    : undefined;

  const named = selected?.task.repository;
  const missingCheckout =
    named &&
    inScope
      .flatMap((area) => area.repositories)
      .some((entry) => entry.id === named && entry.localPath === undefined)
      ? named
      : undefined;

  return {
    view: "tasks",
    areaNavigation: navigation,
    ...(scope.selectedArea ? { selectedArea: scope.selectedArea } : {}),
    status,
    items,
    projects: inScope
      .flatMap((area) => area.projects)
      .map((project) => ({
        id: project.id,
        title: project.id,
        count: inLifecycle.filter((item) => item.task.project === project.id)
          .length,
      })),
    repositories: [
      ...new Set(
        inScope.flatMap((area) => area.repositories.map((entry) => entry.id)),
      ),
    ].sort(),
    filter,
    ...(selected && selectedRoot && selectedEntry
      ? await (async () => {
          const [item, documents, relations] = await Promise.all([
            enrichWebWorkItem(
              {
                areaId: selectedRoot.manifest.id,
                areaName: selectedRoot.manifest.name,
                projects: selectedEntry.projects,
                repositories: selectedEntry.repositories,
                localTasks: [],
              },
              selected,
            ),
            snapshot.documents(selectedRoot),
            snapshot.relations(selectedRoot),
          ]);
          const linkedPaths = item.task
            ? (relations.graph.get(item.task.relativePath)?.outbound ?? [])
            : [];
          return {
            selected: {
              item,
              documents: documentRefs(documents.documents, linkedPaths),
              ...(missingCheckout
                ? { repositoryWithoutCheckout: missingCheckout }
                : {}),
            },
          };
        })()
      : {}),
    warnings: [
      ...scope.warnings,
      ...shown.warnings,
      ...inScope.flatMap((area) => area.warnings),
    ],
  };
}
