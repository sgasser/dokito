import { DokitoError } from "../core/error";
import {
  isTaskLifecycleFilter,
  type TaskLifecycleFilter,
} from "../core/task-model";
import type { WebSearchSort, WebSearchType } from "./data";

type Query = Record<string, string>;

function optional(query: Query, name: string): string | undefined {
  const value = query[name]?.trim();
  return value ? value : undefined;
}

function invalid(
  name: string,
  value: string,
  allowed: readonly string[],
): never {
  throw new DokitoError(
    "web_query_invalid",
    `Invalid Web query parameter '${name}': ${value}`,
    { name, value, allowed: [...allowed] },
  );
}

function flag(query: Query, name: string): boolean {
  const value = optional(query, name);
  if (value === undefined) {
    return false;
  }
  if (value !== "1") {
    invalid(name, value, ["1"]);
  }
  return true;
}

export interface ParsedTasksQuery {
  status?: TaskLifecycleFilter;
  project?: string;
  repository?: string;
}

/**
 * A `q` here is read and dropped rather than rejected. Tasks had a filter no
 * control could set, see or clear, and the header counted as if the Area were
 * that short; finding a Task by name is root search's job. A saved link still
 * opens the list, now whole.
 */
export function parseTasksQuery(query: Query): ParsedTasksQuery {
  const status = optional(query, "status");
  const project = optional(query, "project");
  const repository = optional(query, "repository");
  const parsed: ParsedTasksQuery = {};
  if (status) {
    if (!isTaskLifecycleFilter(status)) {
      throw new DokitoError(
        "task_status_invalid",
        `Invalid Web status filter: ${status}`,
      );
    }
    parsed.status = status;
  }
  if (project) parsed.project = project;
  if (repository) parsed.repository = repository;
  return parsed;
}

export interface ParsedResourcesQuery {
  archived: boolean;
}

export function parseResourcesQuery(query: Query): ParsedResourcesQuery {
  return { archived: flag(query, "archived") };
}

export interface ParsedFocusQuery {
  includePaused: boolean;
}

/**
 * One control, and it names what it adds rather than the scope it produces:
 * archived Areas are never in Focus, so `all` would overstate it.
 */
export function parseFocusQuery(query: Query): ParsedFocusQuery {
  const areas = optional(query, "areas");
  if (areas !== undefined && areas !== "paused") {
    invalid("areas", areas, ["paused"]);
  }
  return { includePaused: areas === "paused" };
}

export interface ParsedProjectsQuery {
  repository?: string;
  includeClosed: boolean;
}

export function parseProjectsQuery(query: Query): ParsedProjectsQuery {
  const repository = optional(query, "repository");
  return {
    ...(repository ? { repository } : {}),
    includeClosed: flag(query, "closed"),
  };
}

const SEARCH_TYPES: readonly WebSearchType[] = [
  "tasks",
  "projects",
  "resources",
];
const SEARCH_SORTS: readonly WebSearchSort[] = ["relevance", "updated"];

function isSearchType(value: string): value is WebSearchType {
  return SEARCH_TYPES.some((candidate) => candidate === value);
}

function isSearchSort(value: string): value is WebSearchSort {
  return SEARCH_SORTS.some((candidate) => candidate === value);
}

export interface ParsedSearchQuery {
  document?: string;
  documentArea?: string;
  type?: WebSearchType;
  sort?: WebSearchSort;
  query?: string;
}

export function parseSearchQuery(query: Query): ParsedSearchQuery {
  const type = optional(query, "type");
  const sort = optional(query, "sort");
  const document = optional(query, "doc");
  const documentArea = optional(query, "docArea");
  const search = optional(query, "q");
  const parsed: ParsedSearchQuery = {};
  if (document) parsed.document = document;
  if (documentArea) parsed.documentArea = documentArea;
  if (type) {
    if (!isSearchType(type)) {
      invalid("type", type, SEARCH_TYPES);
    }
    parsed.type = type;
  }
  if (sort) {
    if (!isSearchSort(sort)) {
      invalid("sort", sort, SEARCH_SORTS);
    }
    parsed.sort = sort;
  }
  if (search) parsed.query = search;
  return parsed;
}
