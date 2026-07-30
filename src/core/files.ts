import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { DokitoError, fail } from "./error";

/**
 * Only `resources/` is walked recursively, so these names are only ever met
 * inside a folder of notes. A checkout there is worth skipping; a note in a
 * folder that happens to be called `app` or `dist` is not.
 */
const DEFAULT_EXCLUDES = new Set([".git", ".obsidian", "node_modules"]);

export async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readUtf8(target: string): Promise<string> {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(target);
  } catch (error) {
    const cause =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : error instanceof Error
          ? error.message
          : String(error);
    throw new DokitoError(
      "file_unavailable",
      `Could not read file: ${target}`,
      {
        path: target,
        cause,
      },
    );
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new DokitoError(
      "file_not_utf8",
      `File is not valid UTF-8: ${target}`,
      {
        path: target,
      },
    );
  }
}

export function validateRelativePath(relativePath: string): string {
  fail(relativePath.length > 0, "unsafe_path", "Path cannot be empty.");
  fail(
    !path.isAbsolute(relativePath),
    "unsafe_path",
    "Path must be relative.",
    {
      path: relativePath,
    },
  );
  fail(
    !relativePath.split(/[\\/]/).includes(".."),
    "unsafe_path",
    "Path cannot contain '..'.",
    { path: relativePath },
  );
  fail(
    !relativePath.includes("\0"),
    "unsafe_path",
    "Path contains a null byte.",
  );

  return relativePath;
}

export async function readAreaFile(
  areaRoot: string,
  relativePath: string,
): Promise<string> {
  validateRelativePath(relativePath);
  const segments = relativePath.split(/[\\/]/).filter(Boolean);
  let current = areaRoot;

  for (const segment of segments) {
    current = path.join(current, segment);
    let info: Awaited<ReturnType<typeof lstat>>;

    try {
      info = await lstat(current);
    } catch {
      throw new DokitoError(
        "source_not_found",
        `Context source does not exist: ${relativePath}`,
        { path: relativePath },
      );
    }

    fail(
      !info.isSymbolicLink(),
      "symlink_not_allowed",
      `Symlinks are not allowed in Area sources: ${relativePath}`,
      { path: relativePath },
    );
  }

  const finalInfo = await lstat(current);
  fail(
    finalInfo.isFile(),
    "source_not_file",
    `Context source is not a file: ${relativePath}`,
    { path: relativePath },
  );

  return readUtf8(current);
}

export type AreaFileReader = (
  areaRoot: string,
  relativePath: string,
) => Promise<string>;

function directoryAccessError(error: unknown, target: string): never {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : undefined;

  if (code === "ENOENT") {
    throw new DokitoError(
      "directory_not_found",
      `Directory does not exist: ${target}`,
      { path: target },
    );
  }
  if (code === "ENOTDIR") {
    throw new DokitoError("not_a_directory", `Not a directory: ${target}`, {
      path: target,
    });
  }
  if (code !== undefined) {
    throw new DokitoError(
      "directory_unavailable",
      `Could not access directory: ${target}`,
      { path: target, cause: code },
    );
  }
  throw error;
}

export async function ensureRealDirectory(target: string): Promise<string> {
  let resolved: string;
  try {
    resolved = await realpath(target);
  } catch (error) {
    directoryAccessError(error, target);
  }

  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(resolved);
  } catch (error) {
    directoryAccessError(error, target);
  }

  fail(info.isDirectory(), "not_a_directory", `Not a directory: ${target}`, {
    path: target,
  });
  return resolved;
}

export async function writeTextAtomic(
  target: string,
  content: string,
): Promise<void> {
  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true });

  const parentInfo = await lstat(parent);
  fail(
    !parentInfo.isSymbolicLink(),
    "symlink_not_allowed",
    `Cannot write through a symlink directory: ${parent}`,
  );

  if (await pathExists(target)) {
    const targetInfo = await lstat(target);
    fail(
      !targetInfo.isSymbolicLink(),
      "symlink_not_allowed",
      `Cannot replace a symlink: ${target}`,
    );
  }

  const temporary = path.join(
    parent,
    `.${path.basename(target)}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw new DokitoError("write_failed", `Could not write ${target}`, {
      path: target,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function findUp(
  start: string,
  filename: string,
): Promise<string | null> {
  let current = await ensureRealDirectory(start);

  while (true) {
    const candidate = path.join(current, filename);
    if (await pathExists(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export interface AreaFile {
  path: string;
  bytes: number;
  modifiedAt: string;
  /** Stable only while the underlying file identity and metadata are equal. */
  revision: string;
}

export async function listAreaFiles(areaRoot: string): Promise<AreaFile[]> {
  const files: AreaFile[] = [];
  const roots = ["context.md", "projects", "resources", "tasks"];

  async function visit(
    relativePath: string,
    recursive: boolean,
  ): Promise<void> {
    const absolutePath = path.join(areaRoot, relativePath);
    if (!(await pathExists(absolutePath))) {
      return;
    }

    const info = await lstat(absolutePath);
    if (info.isSymbolicLink()) {
      return;
    }

    if (info.isFile()) {
      if (absolutePath.endsWith(".md")) {
        files.push({
          path: relativePath.split(path.sep).join("/"),
          bytes: info.size,
          modifiedAt: info.mtime.toISOString(),
          revision: [
            info.dev,
            info.ino,
            info.size,
            info.mtimeMs,
            info.ctimeMs,
          ].join(":"),
        });
      }
      return;
    }

    if (!info.isDirectory()) {
      return;
    }

    const entries = await readdir(absolutePath, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (DEFAULT_EXCLUDES.has(entry.name) || entry.isSymbolicLink()) {
        continue;
      }
      if (!recursive && entry.isDirectory()) {
        continue;
      }
      await visit(path.join(relativePath, entry.name), recursive);
    }
  }

  for (const root of roots) {
    await visit(root, root === "resources");
  }

  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
