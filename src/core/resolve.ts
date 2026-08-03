import path from "node:path";
import { loadRegisteredAreas, type RegisteredArea } from "./areas";
import { loadConfig } from "./config";
import { DokitoError } from "./error";
import { listAreaFiles, pathExists } from "./files";
import { createDocumentLookup, documentMatches } from "./links";
import { parseReference, type Reference } from "./references";
import { resolveScope, type ScopeInput } from "./scope";
import { ownValue } from "./yaml";

interface ResolveMatch {
  kind: "document" | "repository";
  area: string;
  areaName: string;
  areaRoot: string;
  /** Area-relative path of a document match. */
  relativePath?: string;
  /** Repository ID of a Repository match. */
  repository?: string;
  path: string;
  exists: boolean;
}

export interface ResolveResult {
  configPath: string;
  reference: string;
  /** Area the working directory resolves to, when it resolves to one. */
  area?: string;
  matches: ResolveMatch[];
  warnings: string[];
}

/**
 * Everything one name could mean in one Area. A lookup returns all of them
 * because its caller knows which was meant; only a link in a document needs
 * exactly one answer.
 */
async function areaMatches(
  id: string,
  area: RegisteredArea,
  input: string,
  reference: Reference,
): Promise<ResolveMatch[]> {
  const identity = {
    area: id,
    areaName: area.manifest.name,
    areaRoot: area.root,
  };

  if (reference.kind === "repository") {
    if (
      ownValue(area.manifest.repositories, reference.repository) === undefined
    ) {
      return [];
    }
    const configured = ownValue(
      area.registration.repositories,
      reference.repository,
    );
    if (!configured) {
      return [];
    }
    const root = path.resolve(area.root, configured.path);
    const target = reference.path ? path.join(root, reference.path) : root;
    return [
      {
        kind: "repository",
        ...identity,
        repository: reference.repository,
        path: target,
        exists: await pathExists(target),
      },
    ];
  }

  const lookup = createDocumentLookup(
    (await listAreaFiles(area.root)).map((file) => ({
      relativePath: file.path,
    })),
  );

  return documentMatches(input, lookup).map((document) => ({
    kind: "document" as const,
    ...identity,
    relativePath: document.relativePath,
    path: path.join(area.root, document.relativePath),
    exists: true,
  }));
}

/**
 * `[[Data retention|what to read]]` is the link as written in a document, not a
 * name any Area holds. Reporting it as a malformed reference says what to do,
 * where searching for it as a filename would only report it as unknown. Half of
 * it counts too: a link target is cut at the first `|`, so no name that can be
 * linked contains one.
 */
function isLinkSyntax(reference: string): boolean {
  const trimmed = reference.trim();
  return (
    (trimmed.startsWith("[[") && trimmed.endsWith("]]")) ||
    trimmed.includes("|")
  );
}

/** The Area of the working directory, or undefined outside every Area. */
async function currentArea(input: ScopeInput): Promise<string | undefined> {
  try {
    return (await resolveScope(input)).area;
  } catch (error) {
    if (!(error instanceof DokitoError)) {
      throw error;
    }
    return undefined;
  }
}

export async function resolveReference(
  input: ScopeInput & { reference: string },
): Promise<ResolveResult> {
  if (isLinkSyntax(input.reference)) {
    throw new DokitoError(
      "reference_invalid",
      `'${input.reference}' is Wikilink syntax, not a target. Pass only the target, without '[[...]]' or '|display text'.`,
      { reference: input.reference },
    );
  }

  const reference = parseReference(input.reference);
  if (!reference) {
    throw new DokitoError(
      "reference_invalid",
      `'${input.reference}' is not a filename, 'project:<id>', 'task:<ULID>' or 'repo:<id>[/path]'.`,
      { reference: input.reference },
    );
  }

  const registered = await loadRegisteredAreas(
    await loadConfig(input.configPath),
  );
  const here = await currentArea(input);
  const matches: ResolveMatch[] = [];
  const warnings = [...registered.warnings];

  for (const [id, area] of registered.areas) {
    try {
      matches.push(
        ...(await areaMatches(id, area, input.reference, reference)),
      );
    } catch (error) {
      warnings.push(
        `Skipped Area '${id}' while resolving: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  matches.sort((a, b) => {
    const home = Number(b.area === here) - Number(a.area === here);
    if (home !== 0) {
      return home;
    }
    const area = a.area.localeCompare(b.area);
    return area !== 0
      ? area
      : (a.relativePath ?? a.path).localeCompare(b.relativePath ?? b.path);
  });

  if (matches.length === 0) {
    if (reference.kind === "repository") {
      const repository = reference.repository;
      const registering = [...registered.areas]
        .filter(
          ([, area]) =>
            ownValue(area.manifest.repositories, repository) !== undefined,
        )
        .map(([id]) => id);
      /*
       * A Repository the Area registers but this machine has not checked out
       * is a fact about the machine, so it earns its own code rather than
       * reading as an unknown name.
       */
      if (registering.length > 0) {
        throw new DokitoError(
          "repository_not_local",
          `Repository '${repository}' is registered by Area '${registering.join("', '")}' but has no local checkout on this machine.`,
          { repository, areas: registering },
        );
      }
    }
    throw new DokitoError(
      "reference_not_found",
      `No registered Area holds '${input.reference}'.`,
      { reference: input.reference },
    );
  }

  return {
    configPath: input.configPath,
    reference: input.reference,
    ...(here ? { area: here } : {}),
    matches,
    warnings,
  };
}
