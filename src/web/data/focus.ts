import type { DocumentState } from "../../core/state-model";
import { type FocusArea, selectFocus } from "../focus";
import { loadEachArea } from "./areas";
import { WorkspaceSnapshot, type WorkspaceSnapshotInput } from "./snapshot";
import type { WebFocusDashboardData } from "./types";

/**
 * Focus reads every Area in scope rather than a selected one, so `area` is
 * omitted rather than accepted and dropped: nothing above the sidebar hairline
 * is Area-scoped, and a caller that passes one should hear about it.
 */
export interface FocusViewInput extends Omit<WorkspaceSnapshotInput, "area"> {
  includePaused?: boolean;
  /** Focus is measured against a day, so tests can name which one. */
  now?: Date;
}

/** Archived Areas never appear, under either setting of the filter. */
function inFocusScope(state: DocumentState, includePaused: boolean): boolean {
  return state === "active" || (includePaused && state === "paused");
}

export async function loadFocusView(
  input: FocusViewInput,
): Promise<WebFocusDashboardData> {
  const snapshot = await WorkspaceSnapshot.create({
    configPath: input.configPath,
    ...(input.workspaceStore ? { workspaceStore: input.workspaceStore } : {}),
  });
  const { scope } = snapshot;
  const includePaused = input.includePaused === true;
  const navigation = await snapshot.navigation();
  const states = new Map(navigation.map((entry) => [entry.id, entry.state]));

  const roots = scope.roots.filter((area) =>
    inFocusScope(states.get(area.manifest.id) ?? "active", includePaused),
  );
  const areas = await loadEachArea(
    snapshot,
    roots,
    async (area): Promise<FocusArea> => {
      const [projects, tasks] = await Promise.all([
        snapshot.projects(area),
        snapshot.tasks(area),
      ]);
      return {
        id: area.manifest.id,
        name: area.manifest.name,
        projects,
        tasks,
      };
    },
  );

  const selection = selectFocus(areas.loaded, input.now);
  const active = navigation.filter((entry) => entry.state === "active").length;

  return {
    view: "focus",
    ...selection,
    areaNavigation: navigation,
    includePaused,
    scopeCounts: {
      active,
      withPaused: navigation.filter((entry) => entry.state !== "archived")
        .length,
    },
    warnings: [...scope.warnings, ...areas.warnings],
  };
}
