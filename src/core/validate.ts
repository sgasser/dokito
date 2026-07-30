import path from "node:path";
import { CONTEXT_MAX_BYTES } from "./context";
import { DokitoError, fail } from "./error";
import { listAreaFiles, readAreaFile } from "./files";
import { createDocumentLookup, extractLinkTargets, resolveLink } from "./links";
import { loadProjects, loadTasks } from "./manifests";
import { frontmatterField, headingTitle } from "./markdown";
import { resolveScope, type ScopeInput } from "./scope";
import {
  AREA_STATE_VALUES,
  areaState,
  RESOURCE_STATE_VALUES,
} from "./state-model";

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

export async function validateArea(
  input: ScopeInput,
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
  for (const document of documents) {
    for (const target of extractLinkTargets(document.content)) {
      if (
        documentLinkTarget(target) &&
        !resolveLink(document.relativePath, target, documents, documentLookup)
      ) {
        warnings.push(
          `${document.relativePath} has unresolved document link '${target}'.`,
        );
      }
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
