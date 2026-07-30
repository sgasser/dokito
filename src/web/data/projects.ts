import { fail } from "../../core/error";
import { PROJECT_STATUS } from "../../core/project-model";
import { projectDocumentPaths, summarizeProject } from "../model";
import { documentRefs, loadEachArea, loadWorkArea } from "./areas";
import { WorkspaceSnapshot, type WorkspaceSnapshotInput } from "./snapshot";
import type {
  WebProjectDashboardData,
  WebProjectSummary,
  WebProjectsDashboardData,
} from "./types";

export interface ProjectsViewInput extends WorkspaceSnapshotInput {
  repository?: string;
  includeClosed?: boolean;
}

export interface ProjectViewInput extends WorkspaceSnapshotInput {
  area: string;
  project: string;
}

/** Summaries need the Area's work items, so every Project loader shares them. */
async function summarize(snapshot: WorkspaceSnapshot) {
  const { scope } = snapshot;
  // Only the Areas on screen are read: the switcher names Areas rather than
  // counting their Projects, so the rest have nothing to contribute here.
  const workAreas = await loadEachArea(snapshot, scope.scoped, async (area) => {
    const [projects, localTasks] = await Promise.all([
      snapshot.loadedProjects(area),
      snapshot.tasks(area),
    ]);
    return loadWorkArea({
      area,
      projects,
      localTasks,
      config: scope.config,
    });
  });

  const work = workAreas.loaded;
  const summaries: WebProjectSummary[] = work.flatMap((entry) =>
    entry.projects.map((project) => ({
      ...summarizeProject(project, entry.workItems),
      areaId: entry.id,
      areaName: entry.name,
    })),
  );

  return {
    scope,
    work,
    summaries,
    warnings: [
      ...scope.warnings,
      // An Area skipped here is reported once, not once per loader.
      ...new Set(workAreas.warnings),
      ...work.flatMap((area) => area.warnings),
    ],
  };
}

export async function loadProjectsView(
  input: ProjectsViewInput,
): Promise<WebProjectsDashboardData> {
  const snapshot = await WorkspaceSnapshot.create(input);
  const [{ scope, summaries, warnings }, areaNavigation] = await Promise.all([
    summarize(snapshot),
    snapshot.navigation(),
  ]);
  const eligible = summaries.filter(
    (project) =>
      input.includeClosed ||
      PROJECT_STATUS[project.status].lifecycle === "open",
  );
  const visible = eligible.filter(
    (project) =>
      !input.repository || project.repositories.includes(input.repository),
  );
  const repositoryIds = [
    ...new Set(eligible.flatMap((project) => project.repositories)),
  ].sort();

  return {
    view: "projects",
    areaNavigation,
    ...(scope.selectedArea ? { selectedArea: scope.selectedArea } : {}),
    projects: visible,
    repositories: repositoryIds.map((repository) => ({
      value: repository,
      label: repository,
      count: eligible.filter((project) =>
        project.repositories.includes(repository),
      ).length,
    })),
    includeClosed: input.includeClosed ?? false,
    ...(input.repository ? { repositoryFilter: input.repository } : {}),
    warnings,
  };
}

export async function loadProjectView(
  input: ProjectViewInput,
): Promise<WebProjectDashboardData> {
  const snapshot = await WorkspaceSnapshot.create(input);
  const [summary, areaNavigation] = await Promise.all([
    summarize(snapshot),
    snapshot.navigation(),
  ]);
  const { warnings } = summary;
  const { project, source, workArea, area } = requireProject(input, summary);
  const [documents, relations] = await Promise.all([
    snapshot.documents(area),
    snapshot.relations(area),
  ]);
  const links = relations.graph.get(source.relativePath);

  return {
    view: "project",
    areaNavigation,
    selectedArea: input.area,
    project: { ...project, content: source.content },
    tasks: workArea.workItems.filter(
      (item) => item.task.project === project.id,
    ),
    documents: documentRefs(
      documents.documents,
      projectDocumentPaths(source, links?.outbound ?? []),
    ),
    warnings,
  };
}

function requireProject(
  input: ProjectViewInput,
  summary: Awaited<ReturnType<typeof summarize>>,
) {
  const project = summary.summaries.find(
    (candidate) => candidate.id === input.project,
  );
  fail(
    project !== undefined,
    "project_not_found",
    `Project not found in Area '${input.area}': ${input.project}`,
  );
  const workArea = summary.work.find(
    (candidate) => candidate.id === project.areaId,
  );
  fail(workArea !== undefined, "area_not_found", "The Area could not be read.");
  const source = workArea.projects.find(
    (candidate) => candidate.id === project.id,
  );
  fail(
    source !== undefined,
    "project_not_found",
    `Project not found in Area '${input.area}': ${input.project}`,
  );
  const area = summary.scope.scoped.find(
    (candidate) => candidate.manifest.id === project.areaId,
  );
  fail(area !== undefined, "area_not_found", "The Area could not be read.");
  return { project, source, workArea, area };
}
