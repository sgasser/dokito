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
  /** The match sits in a Markdown heading rather than in the prose under it. */
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

/**
 * Why a hit ranks where it does. One list, because a reason means the same
 * thing wherever it is shown; each surface states its own order over it, since
 * what a reader scrolls and what an agent reads whole are not the same
 * question.
 */
export type SearchReason =
  | "in progress"
  | "active"
  | "filename"
  | "title"
  | "heading"
  | "content";

/**
 * What a reader is looking for, rather than the four kinds a file can have.
 * The Area file is reference material, so it groups with the Resources.
 */
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
  /** The lifecycle a Project or Task declares; other documents have none. */
  status?: string;
  /** The matched line, or 0 when only the name earned the hit. */
  line: number;
  snippet: string;
  reason: SearchReason;
}

export interface DocumentSearchResult {
  /** Areas that were read; one that could not be read is excluded. */
  areaCount: number;
  hits: DocumentHit[];
  warnings: string[];
}

export interface DocumentSearchInput {
  /** The Areas to read. The core has no default scope; the caller states it. */
  areas: readonly DocumentArea[];
  query: string;
  type?: SearchType;
  /** How this surface ranks the reasons it produces. */
  reasonOrder: readonly SearchReason[];
}

/**
 * Work that is under way outranks work that is not, and only within one
 * reason: a document that merely mentions the words is not promoted over the
 * one that is named after them because a Task happens to be running.
 */
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

  /*
   * A hit its name earned shows what the document opens with. The heading a
   * name match usually also matches would spend the line repeating the title
   * the reader has just read, and there is no line to send them to anyway.
   */
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

/**
 * One hit per document, read live from the files. There is no index to keep in
 * agreement with the Area, so a document is findable as soon as it is written.
 */
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
  // Area and path last, so the same Areas answer the same query the same way
  // on every machine. Nothing here reads a clock.
  hits.sort(
    (a, b) =>
      input.reasonOrder.indexOf(a.reason) -
        input.reasonOrder.indexOf(b.reason) ||
      statusRank(a) - statusRank(b) ||
      a.area.localeCompare(b.area) ||
      a.relativePath.localeCompare(b.relativePath),
  );

  return {
    // The Areas that were read, the way every listing counts them: one that
    // could not be read at all is reported and left out rather than counted.
    areaCount: scanned.filter((area) => area.read).length,
    hits,
    warnings: scanned.flatMap((area) => area.warnings),
  };
}

/**
 * Every registered Area, for a caller that chose the whole registry over the
 * one Area it is standing in.
 */
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
