import { projectStatusLabel } from "../../core/project-model";
import { documentStateLabel } from "../../core/state-model";
import { taskStatusLabel, taskStatusMatches } from "../../core/task-model";
import { documentLabel, explorerDocuments } from "../kinds";
import { routes, withQuery } from "../routes";
import { loadEachArea } from "./areas";
import { WorkspaceSnapshot, type WorkspaceSnapshotInput } from "./snapshot";

export interface PaletteEntry {
  title: string;
  meta: string;
  /**
   * Stated at the end of the row. Root search ranks commands and content in
   * one list, so the kind is what the row says about itself rather than a
   * heading a group of rows sits under.
   */
  kind: "Task" | "Project" | "Resource";
  url: string;
  /** A Task in progress or an active Project: it leads its ranking tier. */
  live?: true;
}

/**
 * Everything root search can jump to. Built on demand rather than embedded in
 * every page, so a reader who never opens it never pays for it. Bodies stay
 * out: matching them here would carry every Area to the browser, and
 * the row at the bottom of the list already leads to the search that reads
 * them on the server.
 */
export async function paletteIndex(
  input: WorkspaceSnapshotInput,
): Promise<PaletteEntry[]> {
  const snapshot = await WorkspaceSnapshot.create(input);
  const { scoped } = snapshot.scope;
  const entries: PaletteEntry[] = [];

  // An Area the palette cannot read is left out of it, not thrown at the user.
  const { loaded } = await loadEachArea(snapshot, scoped, async (area) => {
    const [projects, tasks, documents] = await Promise.all([
      snapshot.projects(area),
      snapshot.tasks(area),
      snapshot.documents(area),
    ]);
    return { areaId: area.manifest.id, projects, tasks, documents };
  });

  for (const { areaId, projects, tasks, documents } of loaded) {
    for (const project of projects) {
      entries.push({
        title: project.title,
        meta: projectStatusLabel(project.status),
        kind: "Project",
        ...(project.status === "active" ? { live: true as const } : {}),
        url: routes.project(areaId, project.id),
      });
    }
    for (const task of tasks) {
      entries.push({
        title: task.title,
        meta:
          task.priority === "urgent" ? "Urgent" : taskStatusLabel(task.status),
        kind: "Task",
        ...(task.status === "in_progress" ? { live: true as const } : {}),
        url: withQuery(routes.task(areaId, task.id), {
          status: taskStatusMatches(task.status, "closed")
            ? "closed"
            : undefined,
        }),
      });
    }
    // Projects and Tasks have purpose-built screens. Keeping their Markdown
    // files out avoids duplicate results that open the wrong representation.
    for (const document of explorerDocuments(documents.documents)) {
      entries.push({
        title: documentLabel(document),
        meta:
          document.state === "archived"
            ? `${documentStateLabel(document.state)} · ${document.relativePath}`
            : document.relativePath,
        kind: "Resource",
        url: withQuery(routes.document(areaId, document.relativePath), {
          archived: document.state === "archived" ? "1" : undefined,
        }),
      });
    }
  }

  return entries;
}
