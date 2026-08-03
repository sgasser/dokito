import type { DocumentState } from "../../core/state-model";
import type {
  ProjectDocument,
  TaskDocument,
  TaskLifecycleFilter,
} from "../../core/types";
import type { FocusSelection } from "../focus";
import type { Facet, ProjectSummary, WorkFilter } from "../model";
import type { WebWorkItem } from "../work-items";

/**
 * Projects and Tasks are Markdown documents too, so the medium keeps its own
 * word. Resources is the destination that lists the Area file and the Area's
 * reference material; a Project file remains a document with a Project kind.
 */
export type WebDocumentKind = "area" | "project" | "resource" | "task";

export interface WebDocument {
  areaId: string;
  areaName: string;
  title: string;
  relativePath: string;
  kind: WebDocumentKind;
  /** What the file's own frontmatter declares; anything silent is active. */
  state: DocumentState;
  bytes: number;
  modifiedAt: string;
  content: string;
  /** The file is listed but could not be read; its content is empty. */
  unreadable?: boolean;
  /** The file is too large to read on every request; its content is empty. */
  oversized?: boolean;
}

/** A document reached from the open one, in either link direction. */
export interface WebRelatedDocument {
  title: string;
  relativePath: string;
  kind: WebDocumentKind;
  direction: "outbound" | "inbound";
  /** Kept so an archived target can reveal itself in the explorer on open. */
  state: DocumentState;
  /** Lifecycle of the Project or Task behind the document, when it has one. */
  status?: string;
}

export interface WebDocumentsArea {
  id: string;
  name: string;
  documents: WebDocument[];
}

/**
 * The switcher carries state rather than screen-specific counts, because an
 * archived Area should not be in the way.
 */
export interface WebAreaNavigationItem {
  id: string;
  name: string;
  state: DocumentState;
}

/**
 * No query here. There is one search in the product and it has its own screen,
 * so a query belongs to that screen rather than to every view.
 */
interface WebDashboardBase {
  areaNavigation: WebAreaNavigationItem[];
  selectedArea?: string;
  /** Areas Dokito could not read. */
  warnings: string[];
}

interface WebTaskDetail {
  item: WebWorkItem;
  task: TaskDocument;
  documents: WebDocumentRef[];
  /**
   * The Task names a Repository that Dokito has no checkout for, so
   * an agent sent here would have nothing to open.
   */
  repositoryWithoutCheckout?: string;
}

export interface WebTasksDashboardData extends WebDashboardBase {
  view: "tasks";
  status: TaskLifecycleFilter;
  items: WebWorkItem[];
  /** Counted before the other filters narrow the list. */
  projects: { id: string; title: string; count: number }[];
  repositories: string[];
  filter: WorkFilter;
  selected?: WebTaskDetail;
}

export interface WebResourcesDashboardData extends WebDashboardBase {
  view: "resources";
  areas: WebDocumentsArea[];
  selectedDocument?: WebDocument;
  /**
   * Whether the reader was asked for by URL. A document picked for the reader
   * on its own must not take over a phone screen the reader never requested.
   */
  documentRequested: boolean;
  related?: WebRelatedDocument[];
  includeArchived: boolean;
  /** How many the explorer is holding back, so the filter can say so. */
  archivedCount: number;
  /** Area and Resource documents that are still current, including a paused Area. */
  currentCount: number;
}

export interface WebProjectSummary extends ProjectSummary {
  areaId: string;
  areaName: string;
}

/** The full Markdown is carried only when one Project is open. */
interface WebProjectDetail extends WebProjectSummary {
  content: ProjectDocument["content"];
}

/** A document referenced from a Project or Task, without its body. */
export interface WebDocumentRef {
  title: string;
  relativePath: string;
  kind: WebDocumentKind;
}

export interface WebProjectsDashboardData extends WebDashboardBase {
  view: "projects";
  projects: WebProjectSummary[];
  repositories: Facet<string>[];
  includeClosed: boolean;
  repositoryFilter?: string;
}

export interface WebProjectDashboardData extends WebDashboardBase {
  view: "project";
  project: WebProjectDetail;
  tasks: WebWorkItem[];
  documents: WebDocumentRef[];
}

/**
 * Search reads all Areas, so its groups are the three things a
 * reader is looking for rather than the four kinds a file can have. The Area
 * file is reference material like the rest of Resources.
 */
export type WebSearchType = "tasks" | "projects" | "resources";

export type WebSearchSort = "relevance" | "updated";

/** Why a hit ranks where it does, stated on the hit itself. */
export type WebSearchReason = "in progress" | "active" | "title" | "content";

export interface WebSearchHit {
  areaId: string;
  areaName: string;
  path: string;
  title: string;
  kind: WebDocumentKind;
  type: WebSearchType;
  /**
   * What this hit is, said only where it distinguishes. Inside a group the
   * kind is the same on every row, so what earns the space is the state of
   * the work — or, for the one Area file among Resources, its kind.
   */
  meta: string;
  line: number;
  snippet: string;
  matchStart: number;
  matchLength: number;
  modifiedAt: string;
  reason: WebSearchReason;
}

export interface WebSearchFacet {
  type: WebSearchType | "all";
  label: string;
  count: number;
}

export interface WebSearchDashboardData extends WebDashboardBase {
  view: "search";
  query: string;
  hits: WebSearchHit[];
  facets: WebSearchFacet[];
  typeFilter?: WebSearchType;
  sort: WebSearchSort;
  preview?: { document: WebDocument; hit: WebSearchHit };
  /** See `documentRequested`: the same rule for the preview pane. */
  previewRequested: boolean;
}

/**
 * The one view that is not about an Area. It reads every Area in scope, so it
 * states that scope in its own header rather than in the Area switcher, and it
 * carries no `selectedArea`.
 */
export interface WebFocusDashboardData
  extends WebDashboardBase,
    FocusSelection {
  view: "focus";
  includePaused: boolean;
  /** What each option of the Areas filter would select. */
  scopeCounts: { active: number; withPaused: number };
}

export type WebDashboardData =
  | WebTasksDashboardData
  | WebSearchDashboardData
  | WebResourcesDashboardData
  | WebProjectsDashboardData
  | WebProjectDashboardData
  | WebFocusDashboardData;
