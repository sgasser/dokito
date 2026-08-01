import path from "node:path";
import { loadRegisteredAreas } from "./areas";
import { loadConfig } from "./config";
import { CONTEXT_MAX_BYTES } from "./context";
import { DokitoError, fail } from "./error";
import { listAreaFiles, pathExists, readAreaFile } from "./files";
import {
  createDocumentLookup,
  type DocumentLookup,
  extractLinkTargets,
  type LinkableDocument,
  linkCandidates,
  shortestLinkForm,
} from "./links";
import { loadProjects, loadTasks } from "./manifests";
import { frontmatterField, headingTitle } from "./markdown";
import {
  hasReferencePrefix,
  isRelativeTarget,
  normalizeTargetPath,
  parseReference,
} from "./references";
import { resolveScope, type ScopeInput } from "./scope";
import {
  AREA_STATE_VALUES,
  areaState,
  RESOURCE_STATE_VALUES,
} from "./state-model";
import { ownValue } from "./yaml";

interface ValidationCollection {
  path: string;
  count: number;
}

interface ValidationDocument {
  relativePath: string;
  title: string;
  content: string;
}

export interface AreaValidationResult {
  area: string;
  context: {
    path: string;
    bytes: number;
    state: string;
  };
  projects: ValidationCollection;
  resources: ValidationCollection;
  tasks: ValidationCollection;
  warnings: string[];
}

function collection(
  areaRoot: string,
  directory: "projects" | "resources" | "tasks",
  count: number,
): ValidationCollection {
  return {
    path: path.join(areaRoot, directory),
    count,
  };
}

function documentLinkTarget(value: string): boolean {
  const target = value.split("#", 1)[0]?.trim() ?? "";
  const filename = target.split("/").at(-1) ?? target;
  const extension = path.posix.extname(filename).toLocaleLowerCase();
  return extension === "" || extension === ".md";
}

/** How to write a link that no longer resolves, so the warning names its fix. */
function suggestion<T extends LinkableDocument>(
  fromPath: string,
  target: string,
  lookup: DocumentLookup<T>,
): string {
  const cleaned = normalizeTargetPath(
    target
      .replaceAll("\\", "/")
      .split("/")
      .filter((segment) => segment !== "..")
      .join("/"),
  );
  const candidates = cleaned
    ? linkCandidates(fromPath, cleaned, lookup)
    : undefined;
  const only = candidates?.length === 1 ? candidates[0] : undefined;
  return only ? ` Write '${shortestLinkForm(only, lookup)}' instead.` : "";
}

/** Canonical checkout of each Repository the current machine has configured. */
async function localRepositoryRoots(
  configPath: string,
  area: string,
  areaRoot: string,
): Promise<Map<string, string>> {
  const config = await loadConfig(configPath);
  const roots = new Map<string, string>();
  for (const [repository, repositoryConfig] of Object.entries(
    ownValue(config.areas, area)?.repositories ?? {},
  )) {
    roots.set(repository, path.resolve(areaRoot, repositoryConfig.path));
  }
  return roots;
}

/**
 * The manifest is shared and always checked; a checkout belongs to one machine,
 * so it is checked only under `--links` and never decides whether an Area is
 * valid.
 */
async function repositoryWarnings(
  from: string,
  target: string,
  repository: string,
  inside: string | undefined,
  known: ReadonlySet<string>,
  roots: ReadonlyMap<string, string> | undefined,
): Promise<string[]> {
  if (!known.has(repository)) {
    return [
      `${from} links to Repository '${repository}', which dokito.yaml does not register.`,
    ];
  }
  if (!roots) {
    return [];
  }
  const root = roots.get(repository);
  if (!root) {
    return [
      `${from} links to Repository '${repository}', which has no local checkout on this machine.`,
    ];
  }
  if (!(await pathExists(root))) {
    return [
      `${from} links to Repository '${repository}', whose configured checkout '${root}' is missing.`,
    ];
  }
  if (inside && !(await pathExists(path.join(root, inside)))) {
    return [
      `${from} has reference '${target}', which names no file in '${root}'.`,
    ];
  }
  return [];
}

/**
 * Area-relative path suffixes of every other registered Area, so `--links` can
 * say where a name that this Area does not hold actually lives.
 */
async function otherAreaSuffixes(
  configPath: string,
  currentArea: string,
): Promise<Map<string, string[]>> {
  const registered = await loadRegisteredAreas(await loadConfig(configPath));
  const suffixes = new Map<string, string[]>();

  for (const [id, area] of registered.areas) {
    if (id === currentArea) {
      continue;
    }
    let files: Awaited<ReturnType<typeof listAreaFiles>>;
    try {
      files = await listAreaFiles(area.root);
    } catch {
      // An Area that cannot be listed is a fact about that Area, and this pass
      // only ever adds a hint to a warning the current Area already earned.
      continue;
    }
    for (const file of files) {
      const segments = file.path.split("/");
      for (let index = 0; index < segments.length; index += 1) {
        const suffix = segments.slice(index).join("/").toLocaleLowerCase();
        const areas = suffixes.get(suffix);
        if (!areas) {
          suffixes.set(suffix, [id]);
        } else if (!areas.includes(id)) {
          areas.push(id);
        }
      }
    }
  }

  return suffixes;
}

export async function validateArea(
  input: ScopeInput & { links?: boolean },
): Promise<AreaValidationResult> {
  const scope = await resolveScope(input);
  const knownRepositories = new Set(
    Object.keys(scope.areaManifest.repositories),
  );
  const [context, files] = await Promise.all([
    readAreaFile(scope.areaRoot, "context.md"),
    listAreaFiles(scope.areaRoot),
  ]);
  const bytes = Buffer.byteLength(context, "utf8");
  fail(
    bytes <= CONTEXT_MAX_BYTES,
    "context_too_large",
    `Context is ${bytes} bytes and exceeds the ${CONTEXT_MAX_BYTES} byte limit.`,
    {
      bytes,
      maxBytes: CONTEXT_MAX_BYTES,
      path: "context.md",
    },
  );

  const loadedProjects = await loadProjects(scope.areaRoot, knownRepositories);
  const loadedTasks = await loadTasks(
    scope.areaRoot,
    knownRepositories,
    undefined,
    { projects: loadedProjects },
  );
  /*
   * Reading skips a malformed document so the rest of the Area stays usable.
   * validate is the command that rejects it, and it reports every one it found
   * rather than sending the reader back for the next file. The shape is the
   * same for one problem and for many, so a script never has to branch on it.
   */
  const problems = [...loadedProjects.problems, ...loadedTasks.problems];
  const firstProblem = problems[0];
  if (firstProblem) {
    throw new DokitoError(
      firstProblem.error.code,
      problems.map((problem) => problem.error.message).join("\n"),
      {
        problems: problems.map((problem) => ({
          path: problem.path,
          code: problem.error.code,
          message: problem.error.message,
          ...(problem.error.details ? { details: problem.error.details } : {}),
        })),
      },
    );
  }
  const projects = loadedProjects.projects;
  const tasks = loadedTasks.tasks;
  const resourceFiles = files.filter((file) =>
    file.path.startsWith("resources/"),
  );
  const warnings = [...scope.warnings];
  const declaredAreaState = frontmatterField(context, "state");
  if (
    declaredAreaState !== undefined &&
    !AREA_STATE_VALUES.some((state) => state === declaredAreaState)
  ) {
    warnings.push(
      `context.md declares unknown Area state '${declaredAreaState}'; Dokito reads it as active.`,
    );
  }
  if (!headingTitle(context)) {
    warnings.push(
      "context.md has no H1 heading; the Web view falls back to its filename.",
    );
  }

  const resourceDocuments: ValidationDocument[] = [];
  for (const resource of resourceFiles) {
    const content = await readAreaFile(scope.areaRoot, resource.path);
    const state = frontmatterField(content, "state");
    if (
      state !== undefined &&
      !RESOURCE_STATE_VALUES.some((allowed) => allowed === state)
    ) {
      warnings.push(
        `${resource.path} declares unknown Resource state '${state}'; Dokito reads it as active.`,
      );
    }
    if (!headingTitle(content)) {
      warnings.push(
        `${resource.path} has no H1 heading; the Web view falls back to its filename.`,
      );
    }
    resourceDocuments.push({
      relativePath: resource.path,
      title: headingTitle(content) ?? path.basename(resource.path, ".md"),
      content,
    });
  }

  const documents: ValidationDocument[] = [
    {
      relativePath: "context.md",
      title: headingTitle(context) ?? "context",
      content: context,
    },
    ...projects.map((project) => ({
      relativePath: project.relativePath,
      title: project.title,
      content: project.content,
    })),
    ...tasks.map((task) => ({
      relativePath: task.relativePath,
      title: task.title,
      content: task.content,
    })),
    ...resourceDocuments,
  ];
  const documentLookup = createDocumentLookup(documents);
  const elsewhere = input.links
    ? await otherAreaSuffixes(input.configPath, scope.area)
    : undefined;
  const repositoryRoots = input.links
    ? await localRepositoryRoots(input.configPath, scope.area, scope.areaRoot)
    : undefined;

  for (const document of documents) {
    const from = document.relativePath;
    for (const target of extractLinkTargets(document.content)) {
      if (hasReferencePrefix(target)) {
        const reference = parseReference(target);
        if (!reference) {
          warnings.push(`${from} has malformed reference '${target}'.`);
          continue;
        }
        if (reference.kind === "repository") {
          warnings.push(
            ...(await repositoryWarnings(
              from,
              target,
              reference.repository,
              reference.path,
              knownRepositories,
              repositoryRoots,
            )),
          );
          continue;
        }
      } else if (!documentLinkTarget(target)) {
        // A target that is not a document was never resolved here, and saying
        // it is written wrong would ask for an edit Dokito cannot check.
        continue;
      } else if (isRelativeTarget(target)) {
        warnings.push(
          `${from} has relative document link '${target}'; links are written as filenames.${suggestion(from, target, documentLookup)}`,
        );
        continue;
      }

      const candidates = linkCandidates(from, target, documentLookup);
      if (candidates.length === 1) {
        continue;
      }
      if (candidates.length > 1) {
        const named = candidates
          .map((candidate) => `'${candidate.relativePath}'`)
          .join(", ");
        warnings.push(
          `${from} has ambiguous document link '${target}'; ${named} are equally close. Give one of them a filename that is unique in the Area.`,
        );
        continue;
      }

      const normalized = normalizeTargetPath(target)?.toLocaleLowerCase();
      const holders = normalized
        ? (elsewhere?.get(normalized) ?? elsewhere?.get(`${normalized}.md`))
        : undefined;
      /*
       * No suggestion here: a target that reaches this point carries no `..`,
       * so the form `suggestion` would clean up is the form that already
       * failed. Only the relative branch above can name a replacement.
       */
      warnings.push(
        `${from} has unresolved document link '${target}'.${
          holders?.length
            ? ` Area '${holders.join("', '")}' holds that name; an Area links only within itself.`
            : ""
        }`,
      );
    }
  }

  return {
    area: scope.area,
    context: {
      path: path.join(scope.areaRoot, "context.md"),
      bytes,
      state: areaState(context),
    },
    projects: collection(scope.areaRoot, "projects", projects.length),
    resources: collection(scope.areaRoot, "resources", resourceFiles.length),
    tasks: collection(scope.areaRoot, "tasks", tasks.length),
    warnings,
  };
}
