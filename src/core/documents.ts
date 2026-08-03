import path from "node:path";
import {
  type AreaFile,
  type AreaFileReader,
  listAreaFiles,
  readAreaFile,
} from "./files";
import { headingTitle } from "./markdown";
import { areaState, type DocumentState, resourceState } from "./state-model";

/**
 * Well above any hand-written note, and small enough that reading every
 * document of an Area stays cheap.
 */
const MAX_DOCUMENT_BYTES = 1024 * 1024;

/**
 * Projects and Tasks are Markdown documents too, so the medium keeps its own
 * word. A Resource is everything outside the Area context, Projects, and Tasks.
 */
export type DocumentKind = "area" | "project" | "resource" | "task";

/** One Markdown file of an Area, read as the document a reader sees. */
export interface AreaDocument {
  areaId: string;
  areaName: string;
  title: string;
  relativePath: string;
  kind: DocumentKind;
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

/** The Area a document set is read from, named the way its registry names it. */
export interface DocumentArea {
  id: string;
  name: string;
  root: string;
}

export interface LoadAreaDocumentsOptions {
  files?: readonly AreaFile[];
  readFile?: AreaFileReader;
}

function documentTitle(content: string, relativePath: string): string {
  return headingTitle(content) ?? path.basename(relativePath, ".md");
}

/** Everything outside the Area context, Projects, and Tasks is a Resource. */
function documentKind(relativePath: string): DocumentKind {
  if (relativePath === "context.md") {
    return "area";
  }
  if (relativePath.startsWith("projects/")) {
    return "project";
  }
  if (relativePath.startsWith("tasks/")) {
    return "task";
  }
  return "resource";
}

/** The name a link resolves and a filename search matches. */
export function documentName(relativePath: string): string {
  return path.basename(relativePath, ".md");
}

async function loadAreaDocument(input: {
  area: DocumentArea;
  file: AreaFile;
  readFile: AreaFileReader;
}): Promise<AreaDocument> {
  // A file Dokito lists but cannot read is one broken document, not a
  // broken Area: it keeps its place so the reader can say what is wrong. The
  // same applies to one that is simply too big: every view reads every body,
  // so a single huge file would otherwise stall the whole server.
  const oversized = input.file.bytes > MAX_DOCUMENT_BYTES;
  let content = "";
  let unreadable = false;
  if (!oversized) {
    try {
      content = await input.readFile(input.area.root, input.file.path);
    } catch {
      unreadable = true;
    }
  }

  const kind = documentKind(input.file.path);
  return {
    ...(unreadable ? { unreadable: true } : {}),
    ...(oversized ? { oversized: true } : {}),
    areaId: input.area.id,
    areaName: input.area.name,
    relativePath: input.file.path,
    title: documentTitle(content, input.file.path),
    kind,
    state: kind === "area" ? areaState(content) : resourceState(content),
    bytes: input.file.bytes,
    modifiedAt: input.file.modifiedAt,
    content,
  };
}

/**
 * Every Markdown document of one Area, in the inventory's path order. A caller
 * that already holds the inventory or a shared reader passes them in, so one
 * request never reads the same file twice.
 */
export async function loadAreaDocuments(
  area: DocumentArea,
  options: LoadAreaDocumentsOptions = {},
): Promise<AreaDocument[]> {
  const files = options.files ?? (await listAreaFiles(area.root));
  const readFile = options.readFile ?? readAreaFile;
  return Promise.all(
    files.map((file) => loadAreaDocument({ area, file, readFile })),
  );
}
