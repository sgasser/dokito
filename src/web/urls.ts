import type { TaskLifecycleFilter } from "../core/types";
import { routes, withQuery } from "./routes";

export function resourcesUrl(input: {
  area?: string | undefined;
  document?: string | undefined;
  includeArchived?: boolean | undefined;
}): string {
  return withQuery(
    input.document && input.area
      ? routes.document(input.area, input.document)
      : routes.resources(input.area),
    { archived: input.includeArchived ? "1" : undefined },
  );
}

export function focusUrl(
  input: { includePaused?: boolean | undefined } = {},
): string {
  return withQuery(routes.focus(), {
    areas: input.includePaused ? "paused" : undefined,
  });
}

export function searchUrl(input: {
  area?: string | undefined;
  query?: string | undefined;
  type?: string | undefined;
  sort?: string | undefined;
  document?: string | undefined;
  documentArea?: string | undefined;
}): string {
  return withQuery(routes.search(input.area), {
    q: input.query,
    type: input.type,
    sort: input.sort === "relevance" ? undefined : input.sort,
    doc: input.document,
    docArea: input.document ? input.documentArea : undefined,
  });
}

export function projectsUrl(input: {
  area?: string | undefined;
  repository?: string | undefined;
  includeClosed?: boolean | undefined;
}): string {
  return withQuery(routes.projects(input.area), {
    repository: input.repository,
    closed: input.includeClosed ? "1" : undefined,
  });
}

export function projectUrl(input: { area: string; project: string }): string {
  return routes.project(input.area, input.project);
}

export function tasksUrl(input: {
  area?: string | undefined;
  task?: string | undefined;
  status?: TaskLifecycleFilter | undefined;
  project?: string | undefined;
  repository?: string | undefined;
}): string {
  return withQuery(
    input.task && input.area
      ? routes.task(input.area, input.task)
      : routes.tasks(input.area),
    {
      status:
        input.status && input.status !== "open" ? input.status : undefined,
      project: input.project,
      repository: input.repository,
    },
  );
}
