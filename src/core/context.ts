import path from "node:path";
import { fail } from "./error";
import { type AreaFile, listAreaFiles, readAreaFile } from "./files";
import { resolveScope } from "./scope";
import type { ContextCollection, ContextResult } from "./types";

const CONTEXT_PATH = "context.md";
export const CONTEXT_MAX_BYTES = 64 * 1024;
const DEFAULT_MAX_BYTES = CONTEXT_MAX_BYTES;

export interface ContextInput {
  cwd: string;
  configPath: string;
  maxBytes?: number;
}

function collection(
  areaRoot: string,
  directory: "projects" | "resources" | "tasks",
  files: readonly AreaFile[],
): ContextCollection {
  return {
    path: path.join(areaRoot, directory),
    count: files.filter((file) => file.path.startsWith(`${directory}/`)).length,
  };
}

export async function context(input: ContextInput): Promise<ContextResult> {
  const scope = await resolveScope(input);
  const [content, files] = await Promise.all([
    readAreaFile(scope.areaRoot, CONTEXT_PATH),
    listAreaFiles(scope.areaRoot),
  ]);
  const bytes = Buffer.byteLength(content, "utf8");
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  fail(
    bytes <= maxBytes,
    "context_too_large",
    `Context is ${bytes} bytes and exceeds the ${maxBytes} byte limit.`,
    {
      bytes,
      maxBytes,
      path: CONTEXT_PATH,
    },
  );

  return {
    area: scope.area,
    areaName: scope.areaName,
    areaRoot: scope.areaRoot,
    manifestPath: path.join(scope.areaRoot, "dokito.yaml"),
    contextPath: path.join(scope.areaRoot, CONTEXT_PATH),
    ...(scope.repository ? { repository: scope.repository } : {}),
    ...(scope.codeRoot ? { codeRoot: scope.codeRoot } : {}),
    resolution: scope.resolution,
    context: content,
    projects: collection(scope.areaRoot, "projects", files),
    resources: collection(scope.areaRoot, "resources", files),
    tasks: collection(scope.areaRoot, "tasks", files),
    warnings: scope.warnings,
  };
}
