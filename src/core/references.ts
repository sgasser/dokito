import { ULID_PATTERN } from "./ulid";

/**
 * A link target names one thing by filename. `project:`, `task:` and `repo:`
 * say which kind is meant; anything else is a document path or the unambiguous
 * end of one. Nothing resolves through a title, so the filename is the only
 * identity to keep in agreement.
 */
export type Reference =
  | { kind: "document"; target: string }
  | { kind: "project"; id: string }
  | { kind: "task"; id: string }
  | { kind: "repository"; repository: string; path?: string };

const PREFIXES = ["project", "task", "repo"] as const;
const TASK_ID = new RegExp(`^${ULID_PATTERN}$`);

/**
 * The prefix a target carries, matched without regard to case so that a capital
 * cannot turn a reference back into what looks like a URL scheme.
 */
function referencePrefix(
  target: string,
): (typeof PREFIXES)[number] | undefined {
  const colon = target.indexOf(":");
  const head = colon > 0 ? target.slice(0, colon).toLocaleLowerCase() : "";
  return PREFIXES.find((prefix) => prefix === head);
}

/** `[[project:launch]]` reads as a URL scheme; link extraction must not cut it. */
export function hasReferencePrefix(target: string): boolean {
  return referencePrefix(target) !== undefined;
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
 * An Area-relative path with separators, escaping and casing settled, or
 * undefined when the target leaves the Area or names nothing. `..` is not
 * accepted: a link is written as a filename, not as a route from its writer.
 */
export function normalizeTargetPath(target: string): string | undefined {
  const withoutFragment = target.split("#", 1)[0]?.trim();
  if (!withoutFragment) {
    return undefined;
  }

  const segments: string[] = [];
  for (const segment of decodeTarget(withoutFragment)
    .replaceAll("\\", "/")
    .split("/")) {
    if (segment === "." || segment.length === 0) {
      continue;
    }
    if (segment === "..") {
      return undefined;
    }
    segments.push(segment);
  }
  return segments.length > 0 ? segments.join("/") : undefined;
}

/** True for a target that only a removed relative form could have produced. */
export function isRelativeTarget(target: string): boolean {
  const withoutFragment = target.split("#", 1)[0] ?? "";
  return decodeTarget(withoutFragment)
    .replaceAll("\\", "/")
    .split("/")
    .includes("..");
}

export function parseReference(target: string): Reference | undefined {
  const prefix = referencePrefix(target);
  if (!prefix) {
    const normalized = normalizeTargetPath(target);
    return normalized ? { kind: "document", target: normalized } : undefined;
  }

  const rest = normalizeTargetPath(target.slice(prefix.length + 1));
  if (!rest) {
    return undefined;
  }
  if (prefix === "project") {
    return rest.includes("/") ? undefined : { kind: "project", id: rest };
  }
  if (prefix === "task") {
    // A ULID carries no path, so anything after it is reported rather than
    // quietly dropped, the same way `project:a/b` is.
    const id = rest.toUpperCase();
    return TASK_ID.test(id) ? { kind: "task", id } : undefined;
  }

  const [repository, ...inside] = rest.split("/");
  if (!repository) {
    return undefined;
  }
  const file = inside.join("/");
  return {
    kind: "repository",
    repository,
    ...(file ? { path: file } : {}),
  };
}
