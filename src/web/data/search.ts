import { frontmatterField } from "../../core/markdown";
import { isProjectStatus, projectStatusLabel } from "../../core/project-model";
import {
  documentSearchType,
  openingExcerpt,
  searchDocumentContent,
} from "../../core/search";
import { documentStateLabel } from "../../core/state-model";
import { isTaskStatus, taskStatusLabel } from "../../core/task-model";
import { documentLabel } from "../kinds";
import { loadEachArea } from "./areas";
import { WorkspaceSnapshot, type WorkspaceSnapshotInput } from "./snapshot";
import type {
  WebDocument,
  WebSearchDashboardData,
  WebSearchFacet,
  WebSearchHit,
  WebSearchReason,
  WebSearchSort,
  WebSearchType,
} from "./types";

export interface SearchViewInput extends WorkspaceSnapshotInput {
  document?: string;
  documentArea?: string;
  type?: WebSearchType;
  sort?: WebSearchSort;
  query?: string;
}

const TYPE_LABELS: Record<WebSearchType, string> = {
  tasks: "Tasks",
  projects: "Projects",
  resources: "Resources",
};

/**
 * Active work first, then title matches, then content. The order was always
 * there; stating the reason on the hit is what makes it visible. It is this
 * screen's order over the shared reasons, not the only one: the CLI reads a
 * result whole and ranks the name before the running Task.
 */
const REASON_ORDER: readonly WebSearchReason[] = [
  "in progress",
  "active",
  "title",
  "content",
];

function hitReason(document: WebDocument, query: string): WebSearchReason {
  const status = frontmatterField(document.content, "status");
  if (document.kind === "task" && status === "in_progress") {
    return "in progress";
  }
  if (document.kind === "project" && status === "active") {
    return "active";
  }
  // Ranked and badged against the name on the row, not a heading the reader
  // never sees.
  return documentLabel(document).toLocaleLowerCase().includes(query)
    ? "title"
    : "content";
}

/**
 * Under Tasks every row is a Task and under Projects every row is a Project,
 * so naming the kind there carries nothing. What it stands beside is the state
 * of the work. Resources say nothing at all, except the one Area file among
 * them, where the kind is the thing that distinguishes.
 */
function hitMeta(document: WebDocument): string {
  const status = frontmatterField(document.content, "status");
  if (document.kind === "task") {
    const project = frontmatterField(document.content, "project");
    const label = status && isTaskStatus(status) ? taskStatusLabel(status) : "";
    return project ? [label, project].filter(Boolean).join(" · ") : label;
  }
  if (document.kind === "project") {
    return status && isProjectStatus(status) ? projectStatusLabel(status) : "";
  }
  if (document.kind === "area") {
    return [
      "Area",
      document.state === "active" ? "" : documentStateLabel(document.state),
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return document.state === "archived"
    ? documentStateLabel(document.state)
    : "";
}

const HIT_LIMIT = 60;

export async function loadSearchView(
  input: SearchViewInput,
): Promise<WebSearchDashboardData> {
  const snapshot = await WorkspaceSnapshot.create(input);
  const { scope } = snapshot;
  const query = input.query?.trim() ?? "";
  const sort: WebSearchSort =
    input.sort === "updated" ? "updated" : "relevance";

  /*
   * Search reads all Areas whatever the Area menu says. Every hit
   * names the Area it came from, so a second scope control would only make the
   * reader do the search's work.
   */
  const [scoped, navigation] = await Promise.all([
    loadEachArea(snapshot, scope.roots, (area) => snapshot.documents(area)),
    snapshot.navigation(),
  ]);

  const documents = new Map(
    scoped.loaded.flatMap((area) =>
      area.documents.map(
        (document) =>
          [`${area.id}:${document.relativePath}`, document] as const,
      ),
    ),
  );
  const needle = query.toLocaleLowerCase();
  const hits: WebSearchHit[] =
    query.length === 0
      ? []
      : [...documents.values()].flatMap((document) => {
          if (document.unreadable) {
            return [];
          }
          /*
           * A Resource is named by its file and needs no H1, so a name the body
           * never repeats would have no way into Search while the palette still
           * matched it.
           */
          const result =
            searchDocumentContent(
              document.content,
              query,
              true,
              document.kind === "resource",
            )[0] ??
            (documentLabel(document).toLocaleLowerCase().includes(needle)
              ? openingExcerpt(document.content)
              : undefined);
          return result
            ? [
                {
                  areaId: document.areaId,
                  areaName: document.areaName,
                  path: document.relativePath,
                  title: documentLabel(document),
                  kind: document.kind,
                  type: documentSearchType(document.kind),
                  meta: hitMeta(document),
                  ...result,
                  modifiedAt: document.modifiedAt,
                  reason: hitReason(document, needle),
                },
              ]
            : [];
        });
  hits.sort((a, b) =>
    sort === "updated"
      ? b.modifiedAt.localeCompare(a.modifiedAt) ||
        a.areaId.localeCompare(b.areaId) ||
        a.path.localeCompare(b.path)
      : REASON_ORDER.indexOf(a.reason) - REASON_ORDER.indexOf(b.reason) ||
        b.modifiedAt.localeCompare(a.modifiedAt) ||
        a.areaId.localeCompare(b.areaId) ||
        a.path.localeCompare(b.path),
  );

  const typeFilter =
    input.type && Object.hasOwn(TYPE_LABELS, input.type)
      ? input.type
      : undefined;
  const matching = typeFilter
    ? hits.filter((hit) => hit.type === typeFilter)
    : hits;
  const visible = matching.slice(0, HIT_LIMIT);
  const facets: WebSearchFacet[] = [
    { type: "all", label: "All", count: hits.length },
    ...(Object.keys(TYPE_LABELS) as WebSearchType[]).map((type) => ({
      type,
      label: TYPE_LABELS[type],
      count: hits.filter((hit) => hit.type === type).length,
    })),
  ];

  // A copied search URL keeps naming its document even if newer matches have
  // since pushed that hit beyond the visible result window.
  const requestedHit = matching.find(
    (hit) =>
      input.document &&
      hit.path === input.document &&
      (!input.documentArea || hit.areaId === input.documentArea),
  );
  const previewHit = requestedHit ?? visible[0];
  const previewDocument = previewHit
    ? documents.get(`${previewHit.areaId}:${previewHit.path}`)
    : undefined;

  return {
    view: "search",
    areaNavigation: navigation,
    ...(scope.selectedArea ? { selectedArea: scope.selectedArea } : {}),
    warnings: [...scope.warnings, ...scoped.warnings],
    query,
    hits: visible,
    facets,
    ...(typeFilter ? { typeFilter } : {}),
    sort,
    ...(previewHit && previewDocument
      ? { preview: { document: previewDocument, hit: previewHit } }
      : {}),
    previewRequested: input.document !== undefined,
  };
}
