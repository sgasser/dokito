/**
 * Identity lives in the path, filters live in the query. A Document, a Project
 * or a Task has one address; how a list is narrowed is a property of the
 * request, not of the thing being addressed.
 */
export const AREA_PREFIX = "/area";

/**
 * Area and Project ids are slugs — `^[a-z][a-z0-9-]*$`, rejected at parse time
 * — so they carry no character that needs escaping and go into the path as
 * they are. Task ids and document paths are encoded before they enter a path.
 */
function areaPath(area: string | undefined, suffix = ""): string {
  return area ? `${AREA_PREFIX}/${area}${suffix}` : suffix || "/";
}

/** Encoded per segment, so slashes keep separating and everything else does not. */
function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

export const routes = {
  /* No Area segment: Focus is about every Area in scope, and an address that
     named one would be claiming a scope the view does not have. */
  focus: (): string => "/focus",
  tasks: (area?: string): string => areaPath(area, "/tasks"),
  task: (area: string, id: string): string =>
    areaPath(area, `/tasks/${encodeURIComponent(id)}`),
  resources: (area?: string): string => areaPath(area, ""),
  /* Projects and Tasks are Markdown too, so a link into one opens in the same
     reader; the destination names what it lists, the path names the file. */
  document: (area: string, path: string): string =>
    areaPath(area, `/resources/${encodePath(path)}`),
  asset: (area: string, path: string): string =>
    areaPath(area, `/assets/${encodePath(path)}`),
  projects: (area?: string): string => areaPath(area, "/projects"),
  project: (area: string, id: string): string =>
    areaPath(area, `/projects/${id}`),
  search: (area?: string): string => areaPath(area, "/search"),
  paletteIndex: (area?: string): string =>
    area ? `/index.json?area=${area}` : "/index.json",
} as const;

export function withQuery(
  path: string,
  params: Record<string, string | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value.length > 0) {
      search.set(key, value);
    }
  }
  const suffix = search.toString();
  return suffix ? `${path}?${suffix}` : path;
}
