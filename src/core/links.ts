import type { Root, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { stripFrontmatter } from "./markdown";
import { hasReferencePrefix, parseReference } from "./references";

/**
 * A wiki target holds no brackets of its own. Excluding `[` as well as `]`
 * keeps the match anchored: allowing it let a run of unclosed `[` backtrack
 * over the rest of the document once per opening bracket, which is quadratic.
 */
const WIKI_LINK = /\[\[([^[\]\n]+)\]\]/g;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** A document is linkable by its path alone; a title is display text. */
export interface LinkableDocument {
  relativePath: string;
}

export interface DocumentLookup<T extends LinkableDocument> {
  byPath: ReadonlyMap<string, T>;
  /** Every trailing run of path segments, so a filename alone can be written. */
  bySuffix: ReadonlyMap<string, readonly T[]>;
  byTaskId: ReadonlyMap<string, readonly T[]>;
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
    if (!target || seen.has(target)) {
      return;
    }
    // `project:launch` matches the shape of a URL scheme, so the known
    // reference prefixes have to be admitted before external targets are cut.
    if (EXTERNAL.test(target) && !hasReferencePrefix(target)) {
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

function key(value: string): string {
  return value.toLocaleLowerCase();
}

/**
 * Link resolution runs while building the Area graph and while rendering every
 * link in one open document. Build the indexes once so neither caller has to
 * scan the complete document list for every target.
 */
export function createDocumentLookup<T extends LinkableDocument>(
  documents: readonly T[],
): DocumentLookup<T> {
  const byPath = new Map<string, T>();
  const bySuffix = new Map<string, T[]>();
  const byTaskId = new Map<string, T[]>();

  const append = (index: Map<string, T[]>, at: string, document: T): void => {
    const existing = index.get(at);
    if (existing) {
      existing.push(document);
    } else {
      index.set(at, [document]);
    }
  };

  for (const document of documents) {
    const segments = document.relativePath.split("/");
    byPath.set(key(document.relativePath), document);
    for (let index = 0; index < segments.length; index += 1) {
      append(bySuffix, key(segments.slice(index).join("/")), document);
    }
    const id = segments[1]?.replace(/\.md$/i, "").split("-", 1)[0];
    if (segments[0] === "tasks" && segments.length === 2 && id) {
      // Two files sharing a ULID is an invalid Area, and reporting both beats
      // resolving to whichever was read last.
      append(byTaskId, id.toUpperCase(), document);
    }
  }

  return { byPath, bySuffix, byTaskId };
}

/** Steps between two documents in the collection tree, via their shared folder. */
function treeDistance(fromPath: string, candidatePath: string): number {
  const from = fromPath.split("/").slice(0, -1);
  const candidate = candidatePath.split("/").slice(0, -1);
  let common = 0;
  while (
    common < from.length &&
    common < candidate.length &&
    key(from[common] ?? "") === key(candidate[common] ?? "")
  ) {
    common += 1;
  }
  return from.length - common + (candidate.length - common);
}

/**
 * Every document a target could name, without regard to where it was written.
 * A Repository is not a document and never matches.
 */
export function documentMatches<T extends LinkableDocument>(
  target: string,
  lookup: DocumentLookup<T>,
): readonly T[] {
  const reference = parseReference(target);
  if (!reference || reference.kind === "repository") {
    return [];
  }
  if (reference.kind === "project") {
    const project = lookup.byPath.get(key(`projects/${reference.id}.md`));
    return project ? [project] : [];
  }
  if (reference.kind === "task") {
    return lookup.byTaskId.get(reference.id) ?? [];
  }

  const wanted = key(reference.target);
  return (
    lookup.bySuffix.get(wanted) ?? lookup.bySuffix.get(`${wanted}.md`) ?? []
  );
}

/**
 * The documents a link could mean, narrowed to those nearest the linking
 * document. More than one is an ambiguous filename, which the caller reports
 * rather than resolves.
 */
export function linkCandidates<T extends LinkableDocument>(
  fromPath: string,
  target: string,
  lookup: DocumentLookup<T>,
): readonly T[] {
  const candidates = documentMatches(target, lookup);
  if (candidates.length < 2) {
    return candidates;
  }

  // A complete Area path is the document's identity, so it outranks a longer
  // path that merely ends the same way.
  const reference = parseReference(target);
  const wanted = reference?.kind === "document" ? key(reference.target) : "";
  const exact = candidates.filter(
    (candidate) =>
      key(candidate.relativePath) === wanted ||
      key(candidate.relativePath) === `${wanted}.md`,
  );
  if (exact.length === 1) {
    return exact;
  }

  let nearest = Number.POSITIVE_INFINITY;
  let closest: T[] = [];
  for (const candidate of candidates) {
    const distance = treeDistance(fromPath, candidate.relativePath);
    if (distance < nearest) {
      nearest = distance;
      closest = [candidate];
    } else if (distance === nearest) {
      closest.push(candidate);
    }
  }
  return closest;
}

/** The shortest end of a document's path that reaches it from anywhere. */
export function shortestLinkForm<T extends LinkableDocument>(
  document: T,
  lookup: DocumentLookup<T>,
): string {
  const segments = document.relativePath.split("/");
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const suffix = segments.slice(index).join("/");
    if ((lookup.bySuffix.get(key(suffix)) ?? []).length === 1) {
      return suffix.replace(/\.md$/i, "");
    }
  }
  return document.relativePath.replace(/\.md$/i, "");
}

/**
 * The document a link target means, or undefined when nothing matches and when
 * several documents match equally well.
 */
export function resolveLink<T extends LinkableDocument>(
  fromPath: string,
  target: string,
  documents: readonly T[],
  lookup: DocumentLookup<T> = createDocumentLookup(documents),
): T | undefined {
  const candidates = linkCandidates(fromPath, target, lookup);
  return candidates.length === 1 ? candidates[0] : undefined;
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
