import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { DokitoError, fail, normalizeError } from "./error";
import { type AreaFileReader, pathExists, readAreaFile } from "./files";
import {
  documentBody,
  headingTitle,
  leadParagraphs,
  projectNote,
  projectOutcome,
} from "./markdown";
import { isProjectStatus, PROJECT_STATUS_VALUES } from "./project-model";
import { assertProjectRepositoryRelation } from "./relations";
import {
  isTaskPriority,
  isTaskStatus,
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
} from "./task-model";
import type {
  AreaManifest,
  ProjectDocument,
  RepositoryConfig,
  TaskDocument,
} from "./types";
import { ULID_PATTERN } from "./ulid";
import {
  asRecord,
  assertKeys,
  optionalString,
  parseYaml,
  readYamlFile,
  requiredString,
  type UnknownRecord,
} from "./yaml";

const SLUG = /^[a-z][a-z0-9-]*$/;
const ULID_FILENAME = new RegExp(`^(${ULID_PATTERN})-([a-z0-9-]+)\\.md$`);

export function validateSlug(value: string, label: string): string {
  fail(SLUG.test(value), "invalid_slug", `${label} must be a lowercase slug.`, {
    value,
  });
  return value;
}

function recordMap(
  value: unknown,
  code: string,
  source: string,
): Record<string, UnknownRecord> {
  const record = asRecord(value, code, `${source} must be an object.`);
  const result: Record<string, UnknownRecord> = {};

  for (const [key, item] of Object.entries(record)) {
    result[key] = asRecord(item, code, `${source}.${key} must be an object.`);
  }

  return result;
}

function stringArray(value: unknown, code: string, source: string): string[] {
  fail(Array.isArray(value), code, `${source} must be an array.`);
  const strings: string[] = [];
  for (const item of value) {
    fail(
      typeof item === "string" && item.length > 0,
      code,
      `${source} must contain only non-empty strings.`,
    );
    strings.push(item);
  }
  return [...new Set(strings)];
}

export function parseAreaManifest(
  value: unknown,
  source: string,
): AreaManifest {
  const root = asRecord(
    value,
    "area_manifest_invalid",
    `${source} must contain an object.`,
  );
  assertKeys(
    root,
    ["version", "id", "name", "repositories"],
    "area_manifest_invalid",
    source,
  );
  fail(
    root.version === 1,
    "area_manifest_invalid",
    `${source}.version must be 1.`,
  );

  const id = validateSlug(
    requiredString(root, "id", "area_manifest_invalid", source),
    "Area ID",
  );
  const name = requiredString(root, "name", "area_manifest_invalid", source);
  const repositoryRecords =
    root.repositories === undefined
      ? {}
      : recordMap(
          root.repositories,
          "area_manifest_invalid",
          `${source}.repositories`,
        );
  const repositories: Record<string, RepositoryConfig> = {};
  for (const [repositoryId, repository] of Object.entries(repositoryRecords)) {
    validateSlug(repositoryId, "Repository ID");
    // Every connected Repository uses the Area's single context.md.
    assertKeys(
      repository,
      ["github"],
      "area_manifest_invalid",
      `${source}.repositories.${repositoryId}`,
    );
    const github = optionalString(
      repository,
      "github",
      "area_manifest_invalid",
      `${source}.repositories.${repositoryId}`,
    );
    if (github !== undefined) {
      fail(
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(github),
        "area_manifest_invalid",
        `Invalid GitHub repository: ${github}`,
      );
    }
    repositories[repositoryId] = github ? { github } : {};
  }

  return { version: 1, id, name, repositories };
}

export async function loadAreaManifest(
  areaRoot: string,
): Promise<AreaManifest> {
  const manifestPath = path.join(areaRoot, "dokito.yaml");
  fail(
    await pathExists(manifestPath),
    "area_manifest_not_found",
    `Area manifest not found: ${manifestPath}`,
  );
  return parseAreaManifest(await readYamlFile(manifestPath), manifestPath);
}

interface FrontmatterDocument {
  metadata: UnknownRecord;
  body: string;
}

function parseFrontmatter(
  content: string,
  source: string,
): FrontmatterDocument {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(content);
  fail(match, "frontmatter_invalid", `Missing YAML frontmatter in ${source}.`);
  const yaml = match[1];
  fail(
    yaml !== undefined,
    "frontmatter_invalid",
    `Invalid frontmatter in ${source}.`,
  );
  const metadata = asRecord(
    parseYaml(yaml, source),
    "frontmatter_invalid",
    `Frontmatter in ${source} must be an object.`,
  );
  return { metadata, body: content.slice(match[0].length) };
}

function firstH1(body: string, source: string): string {
  const title = headingTitle(body);
  fail(title, "heading_missing", `Missing H1 heading in ${source}.`);
  return title;
}

export async function loadProject(
  areaRoot: string,
  projectId: string,
  knownRepositories: ReadonlySet<string>,
  readFile: AreaFileReader = readAreaFile,
): Promise<ProjectDocument> {
  validateSlug(projectId, "Project ID");
  const relativePath = `projects/${projectId}.md`;
  const content = await readFile(areaRoot, relativePath);
  const { metadata, body } = parseFrontmatter(content, relativePath);
  assertKeys(
    metadata,
    ["status", "repositories", "due"],
    "project_invalid",
    relativePath,
  );
  const statusValue = requiredString(
    metadata,
    "status",
    "project_invalid",
    relativePath,
  );
  fail(
    isProjectStatus(statusValue),
    "project_invalid",
    `Invalid Project status in ${relativePath}: ${statusValue}`,
    {
      status: statusValue,
      allowed: PROJECT_STATUS_VALUES,
    },
  );
  const repositories =
    metadata.repositories === undefined
      ? []
      : stringArray(
          metadata.repositories,
          "project_invalid",
          `${relativePath}.repositories`,
        );
  for (const repository of repositories) {
    fail(
      knownRepositories.has(repository),
      "project_invalid",
      `Unknown Repository in ${relativePath}: ${repository}`,
    );
  }
  const due = optionalString(metadata, "due", "project_invalid", relativePath);
  if (due !== undefined) {
    fail(
      validDate(due),
      "project_invalid",
      `Invalid due date in ${relativePath}.`,
    );
  }

  const prose = documentBody(body);
  const outcome = projectOutcome(prose);
  const note = projectNote(prose);

  return {
    id: projectId,
    status: statusValue,
    repositories,
    ...(due ? { due } : {}),
    title: firstH1(body, relativePath),
    ...(outcome ? { outcome } : {}),
    ...(note ? { note } : {}),
    relativePath,
    content,
  };
}

/**
 * A document Dokito could not read, reported next to the ones it could. The
 * error is kept whole so `validate` can raise it with its own code and details
 * rather than a flattened copy.
 */
export interface DocumentProblem {
  path: string;
  error: DokitoError;
  /** The Project or Task identity, when the filename carried a usable one. */
  id?: string;
  /**
   * The document is still in the result and only its reference is unusable.
   * Kept apart from a skipped document so the wording cannot contradict the
   * list beside it.
   */
  retained?: true;
}

export interface LoadedProjects {
  projects: ProjectDocument[];
  problems: DocumentProblem[];
}

/** One wording for a skipped document, so the CLI and the Web agree. */
export function documentProblemWarning(
  areaId: string,
  problem: DocumentProblem,
): string {
  const lead = problem.retained ? "Unresolved reference in" : "Skipped";
  return `${lead} ${problem.path} in Area '${areaId}': ${problem.error.message}`;
}

/*
 * A defect in Dokito is not a statement about the user's files, so it still
 * stops the read. A file the operating system refuses is one: `readUtf8` maps
 * every per-file failure to `file_unavailable`, so treating that as fatal would
 * let one unreadable file hide the Area, which is what this all exists to stop.
 */
const INTERNAL_CODE = "internal_error";

async function collectDocument<T>(
  document: { path: string; id?: string },
  problems: DocumentProblem[],
  load: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await load();
  } catch (error) {
    const normalized = normalizeError(error);
    if (normalized.code === INTERNAL_CODE) {
      throw error;
    }
    problems.push({
      path: document.path,
      error: normalized,
      ...(document.id ? { id: document.id } : {}),
    });
    return undefined;
  }
}

/** Directories are carried through so the check that rejects them can name them. */
function isDocumentEntry(entry: Dirent): boolean {
  return entry.isDirectory() || (entry.isFile() && entry.name.endsWith(".md"));
}

export async function loadProjects(
  areaRoot: string,
  knownRepositories: ReadonlySet<string>,
  readFile: AreaFileReader = readAreaFile,
): Promise<LoadedProjects> {
  const projectsRoot = path.join(areaRoot, "projects");
  if (!(await pathExists(projectsRoot))) {
    return { projects: [], problems: [] };
  }

  const projects: ProjectDocument[] = [];
  const problems: DocumentProblem[] = [];
  const entries = await readdir(projectsRoot, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink() || !isDocumentEntry(entry)) {
      continue;
    }
    const relativePath = `projects/${entry.name}`;
    // Read from the filename rather than the path, so a non-slug filename or a
    // directory without the suffix yields no identity a Task could ever name.
    // A directory named like a document does carry one: no real document of
    // that name can sit beside it.
    const slug = /^([a-z][a-z0-9-]*)\.md$/.exec(entry.name)?.[1];
    const project = await collectDocument(
      { path: relativePath, ...(slug ? { id: slug } : {}) },
      problems,
      async () => {
        fail(
          !entry.isDirectory(),
          "project_invalid",
          `Project documents must be stored directly under projects/: ${relativePath}`,
          { path: relativePath },
        );
        fail(
          slug,
          "project_invalid",
          `Project filename must be a lowercase slug: ${entry.name}`,
        );
        return loadProject(areaRoot, slug, knownRepositories, readFile);
      },
    );
    if (project) {
      projects.push(project);
    }
  }
  return { projects, problems };
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value);
}

export interface LoadTasksOptions {
  /** The Projects already read for this Area, with whatever failed to read. */
  projects?: LoadedProjects;
}

export interface LoadedTasks {
  tasks: TaskDocument[];
  problems: DocumentProblem[];
}

export async function loadTasks(
  areaRoot: string,
  knownRepositories: ReadonlySet<string>,
  readFile: AreaFileReader = readAreaFile,
  options: LoadTasksOptions = {},
): Promise<LoadedTasks> {
  const tasksRoot = path.join(areaRoot, "tasks");
  if (!(await pathExists(tasksRoot))) {
    return { tasks: [], problems: [] };
  }

  const tasks: TaskDocument[] = [];
  const problems: DocumentProblem[] = [];
  const pathsById = new Map<string, string>();
  const entries = await readdir(tasksRoot, { withFileTypes: true });

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink() || !isDocumentEntry(entry)) {
      continue;
    }
    const relativePath = `tasks/${entry.name}`;
    const task = await collectDocument(
      { path: relativePath },
      problems,
      async () => {
        fail(
          !entry.isDirectory(),
          "task_invalid",
          `Task documents must be stored directly under tasks/: ${relativePath}`,
          { path: relativePath },
        );

        const filename = ULID_FILENAME.exec(entry.name);
        fail(
          filename?.[1],
          "task_invalid",
          `Task filename must be <26-character ULID>-<lowercase slug>.md, where the slug uses only lowercase letters, digits, and hyphens: ${entry.name}`,
        );
        const id = filename[1];
        const existingPath = pathsById.get(id);
        fail(
          existingPath === undefined,
          "task_invalid",
          `Duplicate Task ID ${id}: ${existingPath} and ${relativePath}`,
          { id, paths: [existingPath, relativePath] },
        );
        const content = await readFile(areaRoot, relativePath);
        const { metadata, body } = parseFrontmatter(content, relativePath);
        assertKeys(
          metadata,
          ["status", "project", "repository", "priority", "due"],
          "task_invalid",
          relativePath,
        );

        const statusValue = requiredString(
          metadata,
          "status",
          "task_invalid",
          relativePath,
        );
        fail(
          isTaskStatus(statusValue),
          "task_invalid",
          `Invalid Task status in ${relativePath}: ${statusValue}`,
          {
            status: statusValue,
            allowed: TASK_STATUS_VALUES,
          },
        );

        const projectValue = optionalString(
          metadata,
          "project",
          "task_invalid",
          relativePath,
        );
        const project =
          projectValue === undefined
            ? undefined
            : validateSlug(projectValue, "Project ID");
        const repositoryValue = optionalString(
          metadata,
          "repository",
          "task_invalid",
          relativePath,
        );
        const repository =
          repositoryValue === undefined
            ? undefined
            : validateSlug(repositoryValue, "Repository ID");
        if (repository !== undefined) {
          fail(
            knownRepositories.has(repository),
            "task_invalid",
            `Unknown Repository in ${relativePath}: ${repository}`,
          );
        }
        const priorityValue = optionalString(
          metadata,
          "priority",
          "task_invalid",
          relativePath,
        );
        if (priorityValue !== undefined) {
          fail(
            isTaskPriority(priorityValue),
            "task_invalid",
            `Invalid Task priority in ${relativePath}: ${priorityValue}`,
            {
              priority: priorityValue,
              allowed: TASK_PRIORITY_VALUES,
            },
          );
        }

        const due = optionalString(
          metadata,
          "due",
          "task_invalid",
          relativePath,
        );
        if (due !== undefined) {
          fail(
            validDate(due),
            "task_invalid",
            `Invalid due date in ${relativePath}.`,
          );
        }

        const description = leadParagraphs(documentBody(body), 1)[0];

        const document = {
          id,
          status: statusValue,
          ...(project ? { project } : {}),
          ...(repository ? { repository } : {}),
          ...(priorityValue ? { priority: priorityValue } : {}),
          ...(due ? { due } : {}),
          title: firstH1(body, relativePath),
          ...(description ? { description } : {}),
          relativePath,
          content,
        } satisfies TaskDocument;
        // Claimed only once every check on this file has passed, so a rejected
        // document cannot take the ID from a valid one that shares it.
        pathsById.set(id, relativePath);
        return document;
      },
    );
    if (task) {
      tasks.push(task);
    }
  }

  const loadedProjects =
    options.projects ??
    (await loadProjects(areaRoot, knownRepositories, readFile));
  const projectMap = new Map(
    loadedProjects.projects.map((project) => [project.id, project] as const),
  );
  // A Project whose file could not be read already carries its own report.
  // Repeating it against each dependent Task would say the file is missing
  // when it is on disk, and say it once per Task.
  const unreadableProjects = new Set(
    loadedProjects.problems.flatMap((problem) =>
      problem.id ? [problem.id] : [],
    ),
  );

  /*
   * A relation never removes a Task. The Task file is readable and the work is
   * real; only the link to its Project is not usable, and both readers already
   * render an unresolved reference.
   */
  for (const task of tasks) {
    if (!task.project) {
      continue;
    }
    const project = projectMap.get(task.project);
    if (!project) {
      if (!unreadableProjects.has(task.project)) {
        problems.push({
          path: task.relativePath,
          retained: true,
          error: new DokitoError(
            "source_not_found",
            `Context source does not exist: projects/${task.project}.md`,
            { path: `projects/${task.project}.md`, task: task.id },
          ),
        });
      }
      continue;
    }
    if (task.repository) {
      try {
        assertProjectRepositoryRelation(project, task.repository, task.id);
      } catch (error) {
        problems.push({
          path: task.relativePath,
          error: normalizeError(error),
        });
      }
    }
  }

  return { tasks, problems };
}
