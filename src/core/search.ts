import { loadRegisteredAreas } from "./areas";
import { loadConfig } from "./config";
import {
  type AreaDocument,
  type DocumentArea,
  type DocumentKind,
  documentName,
  loadAreaDocuments,
} from "./documents";
import { fail, normalizeError } from "./error";
import { frontmatterField } from "./markdown";

const SNIPPET_LENGTH = 240;
const LEADING_MARKUP = /^(?:#{1,6}\s+|>\s+|[-*+]\s+|\d+[.)]\s+)/;

/**
 * Normalize a line for matching and display: collapse whitespace and drop the
 * heading or list marker, so a snippet reads as the sentence it is rather than
 * as raw Markup. Offsets are computed against this form.
 */
function compact(value: string): string {
  return value.trim().replace(LEADING_MARKUP, "").replace(/\s+/g, " ");
}

/**
 * Where the document's prose starts. Frontmatter is structured metadata with
 * controls of its own, so searching it only produces snippets that read as
 * YAML. Under `perDocument`, those header lines would also win over the
 * sentence the reader was looking for.
 */
function firstProseLine(lines: readonly string[]): number {
  if (lines[0]?.trim() !== "---") {
    return 0;
  }
  const closing = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  return closing < 0 ? 0 : closing + 1;
}

/**
 * Where the text a reader is shown begins. `skipHeading` is for a document
 * whose leading H1 the reader removes: matching a line nobody can see sends
 * the reader to a page that does not contain the words they searched for.
 */
function firstShownLine(
  lines: readonly string[],
  skipHeading: boolean,
): number {
  let index = firstProseLine(lines);
  while (skipHeading && lines[index]?.trim() === "") {
    index += 1;
  }
  return skipHeading && lines[index]?.trimStart().startsWith("# ")
    ? index + 1
    : index;
}

interface Excerpt {
  snippet: string;
  matchStart: number;
  matchLength: number;
}

export interface SearchContentResult extends Excerpt {
  line: number;
  heading?: boolean;
}

/**
 * A snippet windowed around the match rather than truncated from the left, so
 * that a hit late in a long line still appears — and stays highlightable.
 */
function excerpt(line: string, index: number, length: number): Excerpt {
  if (line.length <= SNIPPET_LENGTH) {
    return { snippet: line, matchStart: index, matchLength: length };
  }

  const context = Math.max(0, Math.floor((SNIPPET_LENGTH - length) / 2));
  const end = Math.min(
    line.length,
    Math.max(index - context, 0) + SNIPPET_LENGTH,
  );
  const start = Math.max(0, end - SNIPPET_LENGTH);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < line.length ? "…" : "";

  return {
    snippet: `${prefix}${line.slice(start, end)}${suffix}`,
    matchStart: index - start + prefix.length,
    matchLength: length,
  };
}

/**
 * Search content already held by a caller. Web uses this against its
 * request-local document snapshot.
 */
/**
 * The document's opening line, for a hit its name earned rather than its body.
 * It goes through the same compaction and cap as any other snippet.
 */
export function openingExcerpt(content: string): SearchContentResult {
  const lines = content.split(/\r?\n/);
  const line =
    lines
      .slice(firstShownLine(lines, true))
      .map(compact)
      .find((value) => value.length > 0) ?? "";
  return {
    line: 0,
    snippet: line.slice(0, SNIPPET_LENGTH),
    matchStart: 0,
    matchLength: 0,
  };
}

export function searchDocumentContent(
  content: string,
  query: string,
  perDocument = false,
  skipHeading = false,
): SearchContentResult[] {
  const normalizedQuery = query.trim();
  fail(
    normalizedQuery.length > 0,
    "query_empty",
    "Search query cannot be empty.",
  );
  const needle = compact(normalizedQuery).toLocaleLowerCase();
  const lines = content.split(/\r?\n/);
  const matches: SearchContentResult[] = [];
  let heading: SearchContentResult | undefined;

  for (
    let index = firstShownLine(lines, skipHeading);
    index < lines.length;
    index += 1
  ) {
    const raw = lines[index] ?? "";
    const line = compact(raw);
    const match = line.toLocaleLowerCase().indexOf(needle);
    if (match < 0) {
      continue;
    }
    const isHeading = raw.trimStart().startsWith("#");
    const result = {
      line: index + 1,
      ...excerpt(line, match, needle.length),
      ...(isHeading ? { heading: true } : {}),
    };
    if (perDocument && isHeading) {
      heading ??= result;
      continue;
    }
    matches.push(result);
    heading = undefined;
    if (perDocument) {
      break;
    }
  }

  if (heading) {
    matches.push(heading);
  }
  return matches;
}

/** Match category; callers supply their own ranking. */
export type SearchReason =
  | "in progress"
  | "active"
  | "filename"
  | "title"
  | "heading"
  | "content";

/** User-facing groups; Area documents count as Resources. */
export type SearchType = "projects" | "tasks" | "resources";

export const SEARCH_TYPE_VALUES = Object.freeze([
  "projects",
  "tasks",
  "resources",
] as const satisfies readonly SearchType[]);

export function isSearchType(value: string): value is SearchType {
  return SEARCH_TYPE_VALUES.some((type) => type === value);
}

export function documentSearchType(kind: DocumentKind): SearchType {
  if (kind === "task") {
    return "tasks";
  }
  return kind === "project" ? "projects" : "resources";
}

export interface DocumentHit {
  area: string;
  kind: DocumentKind;
  title: string;
  relativePath: string;
  status?: string;
  line: number;
  snippet: string;
  reason: SearchReason;
}

export interface DocumentSearchResult {
  areaCount: number;
  hits: DocumentHit[];
  warnings: string[];
}

export interface DocumentSearchInput {
  areas: readonly DocumentArea[];
  query: string;
  type?: SearchType;
  reasonOrder: readonly SearchReason[];
}

function statusRank(hit: DocumentHit): number {
  if (hit.kind === "task") {
    return hit.status === "in_progress" ? 0 : 1;
  }
  return hit.kind === "project" && hit.status === "active" ? 0 : 1;
}

function documentHit(
  document: AreaDocument,
  query: string,
  needle: string,
): DocumentHit | undefined {
  const named = documentName(document.relativePath)
    .toLocaleLowerCase()
    .includes(needle);
  const titled = document.title.toLocaleLowerCase().includes(needle);
  const match = searchDocumentContent(document.content, query, true)[0];
  if (!match && !named && !titled) {
    return undefined;
  }

  // Name matches show opening prose instead of repeating the title.
  const excerpt =
    match && !(match.heading && (named || titled))
      ? match
      : openingExcerpt(document.content);
  const status =
    document.kind === "project" || document.kind === "task"
      ? frontmatterField(document.content, "status")
      : undefined;

  return {
    area: document.areaId,
    kind: document.kind,
    title: document.title,
    relativePath: document.relativePath,
    ...(status ? { status } : {}),
    line: excerpt.line,
    snippet: excerpt.snippet,
    reason: named
      ? "filename"
      : titled
        ? "title"
        : match?.heading
          ? "heading"
          : "content",
  };
}

export async function searchAreaDocuments(
  input: DocumentSearchInput,
): Promise<DocumentSearchResult> {
  const query = input.query.trim();
  fail(query.length > 0, "query_empty", "Search query cannot be empty.");
  const needle = compact(query).toLocaleLowerCase();

  const scanned = await Promise.all(
    input.areas.map(async (area) => {
      const hits: DocumentHit[] = [];
      const warnings: string[] = [];
      let documents: AreaDocument[];
      try {
        documents = await loadAreaDocuments(area);
      } catch (error) {
        return {
          read: false,
          hits,
          warnings: [
            `Skipped Area '${area.id}': ${normalizeError(error).message}`,
          ],
        };
      }

      for (const document of documents) {
        if (document.unreadable || document.oversized) {
          warnings.push(
            `Skipped ${document.relativePath} in Area '${area.id}': the file is ${
              document.unreadable ? "unreadable" : "too large to search"
            }.`,
          );
          continue;
        }
        if (input.type && documentSearchType(document.kind) !== input.type) {
          continue;
        }
        const hit = documentHit(document, query, needle);
        if (hit) {
          hits.push(hit);
        }
      }
      return { read: true, hits, warnings };
    }),
  );

  const hits = scanned.flatMap((area) => area.hits);
  // Area and path make the final order stable.
  hits.sort(
    (a, b) =>
      input.reasonOrder.indexOf(a.reason) -
        input.reasonOrder.indexOf(b.reason) ||
      statusRank(a) - statusRank(b) ||
      a.area.localeCompare(b.area) ||
      a.relativePath.localeCompare(b.relativePath),
  );

  return {
    areaCount: scanned.filter((area) => area.read).length,
    hits,
    warnings: scanned.flatMap((area) => area.warnings),
  };
}

export async function registeredSearchAreas(configPath: string): Promise<{
  areas: DocumentArea[];
  warnings: string[];
}> {
  const registered = await loadRegisteredAreas(await loadConfig(configPath));
  return {
    areas: [...registered.areas].map(([id, area]) => ({
      id,
      name: area.manifest.name,
      root: area.root,
    })),
    warnings: registered.warnings,
  };
}
