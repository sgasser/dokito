import path from "node:path";
import {
  type AreaFile,
  type AreaFileReader,
  listAreaFiles,
  readAreaFile,
} from "./files";
import { headingTitle } from "./markdown";
import { areaState, type DocumentState, resourceState } from "./state-model";

const MAX_DOCUMENT_BYTES = 1024 * 1024;

export type DocumentKind = "area" | "project" | "resource" | "task";

export interface AreaDocument {
  areaId: string;
  areaName: string;
  title: string;
  relativePath: string;
  kind: DocumentKind;
  state: DocumentState;
  bytes: number;
  modifiedAt: string;
  content: string;
  unreadable?: boolean;
  oversized?: boolean;
}

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

export function documentName(relativePath: string): string {
  return path.basename(relativePath, ".md");
}

async function loadAreaDocument(input: {
  area: DocumentArea;
  file: AreaFile;
  readFile: AreaFileReader;
}): Promise<AreaDocument> {
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
