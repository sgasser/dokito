import type { DocumentState } from "../core/state-model";
import type { WebDocumentKind } from "./data";

/**
 * How a document kind is written, in the singular for one document and in the
 * plural for a group of them. Every screen names them the same way, so they
 * are named in one place.
 */
export const KIND_LABELS: Record<WebDocumentKind, string> = {
  area: "Area",
  project: "Project",
  resource: "Resource",
  task: "Task",
};

/**
 * What the Resources explorer lists, in the order it lists them. Projects and
 * Tasks have screens of their own, so a second listing here would only be a
 * worse copy of them. The Area file leads without a heading: a heading over a
 * group of exactly one says nothing, and the Area file is the scope itself
 * rather than one entry among several. Search still reaches every kind.
 */
export const EXPLORER_GROUPS: readonly {
  kind: WebDocumentKind;
  label: string;
}[] = [
  { kind: "area", label: "" },
  { kind: "resource", label: "Resources" },
];

const EXPLORER_KINDS: readonly WebDocumentKind[] = EXPLORER_GROUPS.map(
  (group) => group.kind,
);

/**
 * Every place that shows the explorer's contents — the tree and its counter —
 * asks here, so the two cannot drift apart. The reader and the Related list
 * keep the full set, because a link into a Project file must still open it.
 */
export function explorerDocuments<T extends { kind: WebDocumentKind }>(
  documents: readonly T[],
): T[] {
  return documents.filter((document) => EXPLORER_KINDS.includes(document.kind));
}

/**
 * What the explorer actually shows. Archived material is held back rather than
 * dropped: the header says how much there is and reveals it on request, and
 * search and the palette keep reaching it either way.
 */
export function explorerTree<
  T extends { kind: WebDocumentKind; state: DocumentState },
>(documents: readonly T[], includeArchived: boolean): T[] {
  return explorerDocuments(documents).filter(
    (document) => includeArchived || document.state !== "archived",
  );
}

interface ResourceExplorerDirectory<T> {
  type: "directory";
  name: string;
  relativePath: string;
  documentCount: number;
  children: ResourceExplorerNode<T>[];
}

interface ResourceExplorerDocument<T> {
  type: "document";
  document: T;
}

export type ResourceExplorerNode<T> =
  | ResourceExplorerDirectory<T>
  | ResourceExplorerDocument<T>;

interface MutableResourceDirectory<T> {
  name: string;
  relativePath: string;
  directories: Map<string, MutableResourceDirectory<T>>;
  documents: T[];
}

/**
 * The Resource explorer mirrors the filesystem, so a document uses its path
 * segment rather than its content title. The extension adds no information:
 * every document in the tree is Markdown.
 */
export function resourceExplorerLabel(relativePath: string): string {
  const filename = relativePath.split("/").at(-1) ?? relativePath;
  return filename.replace(/\.md$/, "");
}

/**
 * How a document is named wherever it is listed or linked: by the name a reader
 * would say. For a Resource that is its filename, which is also what a link
 * resolves, so list and link agree. A Project is filed under a slug, a Task
 * under a ULID and the Area file is called `context`; none of those names the
 * thing, so those keep their heading.
 */
export function documentLabel(document: {
  kind: WebDocumentKind;
  relativePath: string;
  title: string;
}): string {
  return document.kind === "resource"
    ? resourceExplorerLabel(document.relativePath)
    : document.title;
}

/**
 * Builds the visible folder hierarchy from paths the document snapshot already
 * owns. Directory discovery therefore costs no filesystem pass: each path
 * segment is visited once and shared prefixes reuse the same Map entry.
 *
 * Empty directories deliberately stay out of the document explorer. They have
 * no readable destination and cannot be derived without expanding the core
 * file model beyond the Markdown files every other view consumes.
 */
export function resourceExplorerTree<
  T extends {
    kind: WebDocumentKind;
    relativePath: string;
  },
>(documents: readonly T[]): ResourceExplorerNode<T>[] {
  const root: MutableResourceDirectory<T> = {
    name: "",
    relativePath: "resources",
    directories: new Map(),
    documents: [],
  };

  for (const document of documents) {
    if (document.kind !== "resource") {
      continue;
    }

    const segments = document.relativePath.split("/").filter(Boolean);
    if (segments[0] === "resources") {
      segments.shift();
    }
    segments.pop();

    let directory = root;
    const directoryPath = ["resources"];
    for (const segment of segments) {
      directoryPath.push(segment);
      let child = directory.directories.get(segment);
      if (!child) {
        child = {
          name: segment,
          relativePath: directoryPath.join("/"),
          directories: new Map(),
          documents: [],
        };
        directory.directories.set(segment, child);
      }
      directory = child;
    }
    directory.documents.push(document);
  }

  const finish = (
    directory: MutableResourceDirectory<T>,
  ): { nodes: ResourceExplorerNode<T>[]; documentCount: number } => {
    let documentCount = directory.documents.length;
    const nodes: ResourceExplorerNode<T>[] = [
      ...Array.from(directory.directories.values(), (child) => {
        const finished = finish(child);
        documentCount += finished.documentCount;
        return {
          type: "directory" as const,
          name: child.name,
          relativePath: child.relativePath,
          documentCount: finished.documentCount,
          children: finished.nodes,
        };
      }),
      ...directory.documents.map((document) => ({
        type: "document" as const,
        document,
      })),
    ];

    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      const aLabel =
        a.type === "directory"
          ? a.name
          : resourceExplorerLabel(a.document.relativePath);
      const bLabel =
        b.type === "directory"
          ? b.name
          : resourceExplorerLabel(b.document.relativePath);
      return aLabel.localeCompare(bLabel);
    });
    return { nodes, documentCount };
  };

  return finish(root).nodes;
}

/** Related entries are a mixed list, so each one says what it is by colour. */
export const KIND_DOTS: Record<WebDocumentKind, string> = {
  area: "bg-ink",
  project: "bg-accent",
  resource: "bg-line-strong",
  task: "bg-success",
};
