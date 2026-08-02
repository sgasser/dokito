import { fail } from "./error";

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
    const result = {
      line: index + 1,
      ...excerpt(line, match, needle.length),
    };
    if (perDocument && raw.trimStart().startsWith("#")) {
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
