import { loadConfig } from "../../core/config";
import { fail } from "../../core/error";
import type { LocalConfig } from "../../core/types";
import { type ResolvedWebArea, resolveWebAreas } from "./areas";
import type { WebAreaNavigationItem } from "./types";

export interface WorkspaceScope {
  config: LocalConfig;
  /** Every registered Area, for the Area menu and its counts. */
  roots: ResolvedWebArea[];
  /** The Areas this request reads: one when scoped, otherwise all of them. */
  scoped: ResolvedWebArea[];
  selectedArea?: string;
  /** Areas that could not be read, so a screen can say so. */
  warnings: string[];
}

/**
 * The part every screen needs: which Areas exist and which ones this request is
 * about. Each view loader starts here and then reads only what it renders.
 */
export async function resolveWorkspace(input: {
  configPath: string;
  area?: string;
}): Promise<WorkspaceScope> {
  const config = await loadConfig(input.configPath);
  const { areas: roots, warnings } = await resolveWebAreas(config);
  return selectWorkspaceScope(
    {
      config,
      roots,
      warnings,
    },
    input.area,
  );
}

function selectWorkspaceScope(
  workspace: Pick<WorkspaceScope, "config" | "roots" | "warnings">,
  area?: string,
): WorkspaceScope {
  if (area !== undefined) {
    fail(
      workspace.roots.some(({ manifest }) => manifest.id === area),
      "area_not_found",
      `Unknown Area: ${area}`,
    );
  }

  const scoped = area
    ? workspace.roots.filter(({ manifest }) => manifest.id === area)
    : workspace.roots;

  return {
    config: workspace.config,
    roots: workspace.roots,
    scoped,
    ...(area ? { selectedArea: area } : {}),
    warnings: workspace.warnings,
  };
}

/** The Area a scoped request is about; the router guarantees there is one. */
export function requireArea(scope: WorkspaceScope): ResolvedWebArea {
  const area = scope.scoped[0];
  fail(area !== undefined, "area_not_found", "The Area could not be read.");
  return area;
}

/**
 * Where an address without an Area lands. Active work comes first, then an
 * Area that is only paused. An archived Area remains a last resort so a
 * workspace containing history only is still readable.
 */
export function defaultArea(
  scope: WorkspaceScope,
  navigation: readonly WebAreaNavigationItem[],
): ResolvedWebArea {
  const states = new Map(navigation.map((area) => [area.id, area.state]));
  const preferred =
    scope.roots.find(({ manifest }) => states.get(manifest.id) === "active") ??
    scope.roots.find(({ manifest }) => states.get(manifest.id) === "paused");
  return preferred ?? requireArea(scope);
}
