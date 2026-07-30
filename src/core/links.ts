import type { Root, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { stripFrontmatter } from "./markdown";

/**
 * A wiki target holds no brackets of its own. Excluding `[` as well as `]`
 * keeps the match anchored: allowing it let a run of unclosed `[` backtrack
 * over the rest of the document once per opening bracket, which is quadratic.
 */
const WIKI_LINK = /\[\[([^[\]\n]+)\]\]/g;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export interface LinkableDocument {
  relativePath: string;
  title: string;
}

export interface DocumentLookup<T extends LinkableDocument> {
  byPath: ReadonlyMap<string, T>;
  byTitle: ReadonlyMap<string, T>;
  byBasename: ReadonlyMap<string, T>;
}

export interface DocumentLinks {
  outbound: string[];
  inbound: string[];
}

export interface RawMarkdownLink {
  start: number;
  end: number;
  label: string;
  target: string;
}

/**
 * 1 where the character at that index is backslash-escaped. Deciding this by
 * walking backslashes backwards answered the same question once per candidate
 * link, which is quadratic on a document that opens with a long run of them.
 */
function escapeFlags(value: string): Uint8Array {
  const escaped = new Uint8Array(value.length);
  for (let index = 1; index < value.length; index += 1) {
    escaped[index] =
      value[index - 1] === "\\" && escaped[index - 1] === 0 ? 1 : 0;
  }
  return escaped;
}

/**
 * The `)` closing each unescaped `(`, or -1. Depth-matching per candidate link
 * let a run of `[](` re-walk the rest of the body once per link, so a single
 * large document blocked the Web view for minutes instead of milliseconds.
 */
function closingParens(value: string, escaped: Uint8Array): Int32Array {
  const closing = new Int32Array(value.length).fill(-1);
  const open: number[] = [];

  for (let index = 0; index < value.length; index += 1) {
    if (escaped[index] === 1) {
      continue;
    }
    if (value[index] === "(") {
      open.push(index);
    } else if (value[index] === ")") {
      const opener = open.pop();
      if (opener !== undefined) {
        closing[opener] = index;
      }
    }
  }

  return closing;
}

/**
 * CommonMark requires destinations containing spaces to use angle brackets.
 * Existing Dokito notes commonly use the more human spelling
 * `[label](my notes.md)`, so preserve that local convention without replacing
 * the Markdown parser for every valid link shape.
 */
export function rawMarkdownLinks(value: string): RawMarkdownLink[] {
  const links: RawMarkdownLink[] = [];
  const escaped = escapeFlags(value);
  const closing = closingParens(value, escaped);
  /*
   * The search for `]` only ever moves forward. Restarting it at every opening
   * bracket is what made a run of unclosed `[` cost minutes per request.
   */
  let labelEnd = 0;

  for (let start = 0; start < value.length; start += 1) {
    if (
      value[start] !== "[" ||
      escaped[start] === 1 ||
      (start > 0 && value[start - 1] === "!")
    ) {
      continue;
    }

    if (labelEnd < start + 1) {
      labelEnd = start + 1;
    }
    while (
      labelEnd < value.length &&
      (value[labelEnd] !== "]" || escaped[labelEnd] === 1)
    ) {
      labelEnd += 1;
    }
    // No `]` ahead of this bracket leaves none ahead of any later one either.
    if (labelEnd >= value.length) {
      break;
    }
    if (value[labelEnd + 1] !== "(") {
      continue;
    }

    const closingParen = closing[labelEnd + 1] ?? -1;
    if (closingParen === -1) {
      continue;
    }
    const targetEnd = closingParen + 1;

    const rawTarget = value.slice(labelEnd + 2, targetEnd - 1).trim();
    const target =
      rawTarget.startsWith("<") && rawTarget.endsWith(">")
        ? rawTarget.slice(1, -1).trim()
        : rawTarget;
    if (!target) {
      continue;
    }

    links.push({
      start,
      end: targetEnd,
      label: value.slice(start + 1, labelEnd),
      target,
    });
    start = targetEnd - 1;
  }

  return links;
}

type MarkdownNode = Root | RootContent;

function visitMarkdown(
  node: MarkdownNode,
  visit: (node: MarkdownNode) => false | undefined,
): void {
  if (visit(node) === false || !("children" in node)) {
    return;
  }
  for (const child of node.children) {
    visitMarkdown(child, visit);
  }
}

/**
 * Every document target referenced from a document body, in source order and
 * deduplicated. Covers `[[wiki links]]` and relative Markdown links; external
 * URLs, images and pure fragments are not document references.
 */
export function extractLinkTargets(content: string): string[] {
  const tree = fromMarkdown(stripFrontmatter(content));
  const targets: string[] = [];
  const seen = new Set<string>();
  const definitions = new Map<string, string>();

  const add = (value: string | undefined): void => {
    const target = value?.split("#", 1)[0]?.trim();
    if (!target || EXTERNAL.test(target) || seen.has(target)) {
      return;
    }
    seen.add(target);
    targets.push(target);
  };

  visitMarkdown(tree, (node) => {
    if (node.type === "definition") {
      definitions.set(node.identifier, node.url);
    }
    return undefined;
  });

  visitMarkdown(tree, (node) => {
    if (
      node.type === "code" ||
      node.type === "inlineCode" ||
      node.type === "html" ||
      node.type === "image" ||
      node.type === "imageReference" ||
      node.type === "definition"
    ) {
      return false;
    }
    if (node.type === "link") {
      add(node.url);
      return false;
    }
    if (node.type === "linkReference") {
      add(definitions.get(node.identifier));
      return false;
    }
    if (node.type === "text") {
      for (const match of node.value.matchAll(WIKI_LINK)) {
        add(match[1]?.split("|", 1)[0]);
      }
      for (const link of rawMarkdownLinks(node.value)) {
        add(link.target);
      }
    }
    return undefined;
  });

  return targets;
}

function decodeTarget(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    // A literal percent is a valid filename character even though it is not a
    // valid percent escape, so malformed encoding stays literal.
    return target;
  }
}

/**
 * Resolve a link target against the linking document's path. Returns the
 * area-relative path, or undefined when the target escapes the Area.
 */
export function normalizeLinkTarget(
  fromPath: string,
  target: string,
): string | undefined {
  const withoutFragment = target.split("#", 1)[0]?.trim();
  if (!withoutFragment) {
    return undefined;
  }

  const input = decodeTarget(withoutFragment).replaceAll("\\", "/");
  const segments = input.startsWith("/")
    ? []
    : fromPath.split("/").slice(0, -1);
  for (const segment of input.replace(/^\/+/, "").split("/")) {
    if (segment === "." || segment.length === 0) {
      continue;
    }
    if (segment === "..") {
      if (segments.length === 0) {
        return undefined;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function basename(relativePath: string): string {
  return (relativePath.split("/").at(-1) ?? relativePath)
    .replace(/\.md$/i, "")
    .toLocaleLowerCase();
}

/**
 * Link resolution is used while building the Area graph and while rendering
 * every link in one open document. Build its three indexes once so neither
 * caller has to scan the complete document list for every target.
 *
 * Duplicate titles and basenames keep the first document in catalogue order,
 * matching the former `documents.find(...)` behaviour.
 */
export function createDocumentLookup<T extends LinkableDocument>(
  documents: readonly T[],
): DocumentLookup<T> {
  const byPath = new Map<string, T>();
  const byTitle = new Map<string, T>();
  const byBasename = new Map<string, T>();

  for (const document of documents) {
    byPath.set(document.relativePath, document);
    const title = document.title.toLocaleLowerCase();
    if (!byTitle.has(title)) {
      byTitle.set(title, document);
    }
    const name = basename(document.relativePath);
    if (!byBasename.has(name)) {
      byBasename.set(name, document);
    }
  }

  return { byPath, byTitle, byBasename };
}

/**
 * Resolve a link target to a known document. Matches the resolved path first,
 * then falls back to a document title or filename so that `[[Security]]`
 * reaches `resources/security.md` from anywhere in the Area.
 */
export function resolveLink<T extends LinkableDocument>(
  fromPath: string,
  target: string,
  documents: readonly T[],
  lookup: DocumentLookup<T> = createDocumentLookup(documents),
): T | undefined {
  const normalized = normalizeLinkTarget(fromPath, target);
  const withExtension =
    normalized && !normalized.endsWith(".md") ? `${normalized}.md` : normalized;
  const name = decodeTarget(target.split("#", 1)[0] ?? "")
    ?.replace(/\.md$/i, "")
    .toLocaleLowerCase();

  return (
    (normalized ? lookup.byPath.get(normalized) : undefined) ??
    (withExtension ? lookup.byPath.get(withExtension) : undefined) ??
    (name ? lookup.byTitle.get(name) : undefined) ??
    (name ? lookup.byBasename.get(name) : undefined)
  );
}

/**
 * Outbound and inbound document links for every document in an Area. A
 * document never links to itself, and both directions are path-sorted so the
 * "Related" list is stable between renders.
 */
export function buildLinkGraph(
  documents: readonly (LinkableDocument & { content: string })[],
): Map<string, DocumentLinks> {
  const lookup = createDocumentLookup(documents);
  const graph = new Map<string, DocumentLinks>(
    documents.map((document) => [
      document.relativePath,
      { outbound: [], inbound: [] },
    ]),
  );

  for (const document of documents) {
    const links = graph.get(document.relativePath);
    if (!links) {
      continue;
    }
    for (const target of extractLinkTargets(document.content)) {
      const resolved = resolveLink(
        document.relativePath,
        target,
        documents,
        lookup,
      );
      if (!resolved || resolved.relativePath === document.relativePath) {
        continue;
      }
      if (!links.outbound.includes(resolved.relativePath)) {
        links.outbound.push(resolved.relativePath);
      }
      const inbound = graph.get(resolved.relativePath);
      if (inbound && !inbound.inbound.includes(document.relativePath)) {
        inbound.inbound.push(document.relativePath);
      }
    }
  }

  for (const links of graph.values()) {
    links.outbound.sort();
    links.inbound.sort();
  }

  return graph;
}
