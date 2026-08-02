import path from "node:path";
import { fail, normalizeError } from "../../core/error";
import {
  type AreaFile,
  type AreaFileReader,
  ensureRealDirectory,
  listAreaFiles,
  readAreaFile,
} from "../../core/files";
import { buildLinkGraph, type DocumentLinks } from "../../core/links";
import {
  type DocumentProblem,
  documentProblemWarning,
  type LoadedProjects,
  loadAreaManifest,
} from "../../core/manifests";
import { frontmatterField, headingTitle } from "../../core/markdown";
import { isProjectStatus, projectStatusLabel } from "../../core/project-model";
import { verifiedRepositoryPath } from "../../core/repositories";
import { areaState, resourceState } from "../../core/state-model";
import {
  isTaskStatus,
  taskStatusLabel,
  taskStatusMatches,
} from "../../core/task-model";
import { listAreaTasks } from "../../core/tasks";
import type { AreaManifest, LocalConfig, TaskDocument } from "../../core/types";
import { ownValue } from "../../core/yaml";
import { documentLabel } from "../kinds";
import { buildWebWorkItems } from "../work-items";
import type {
  WebDocument,
  WebDocumentKind,
  WebDocumentRef,
  WebDocumentsArea,
  WebRelatedDocument,
} from "./types";

/**
 * Well above any hand-written note, and small enough that reading every
 * document on every request stays cheap.
 */
const MAX_DOCUMENT_BYTES = 1024 * 1024;

export interface ResolvedWebArea {
  root: string;
  manifest: AreaManifest;
}

export interface DocumentRelations {
  graph: ReadonlyMap<string, DocumentLinks>;
  statuses: ReadonlyMap<string, string>;
}

function documentTitle(content: string, relativePath: string): string {
  return headingTitle(content) ?? path.basename(relativePath, ".md");
}

/** Everything outside the Area context, Projects, and Tasks is a Resource. */
function documentKind(relativePath: string): WebDocumentKind {
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

const DOCUMENT_KIND_ORDER: Record<WebDocumentKind, number> = {
  area: 0,
  project: 1,
  resource: 2,
  task: 3,
};

function compareDocuments(a: WebDocument, b: WebDocument): number {
  return (
    DOCUMENT_KIND_ORDER[a.kind] - DOCUMENT_KIND_ORDER[b.kind] ||
    documentLabel(a).localeCompare(documentLabel(b)) ||
    a.relativePath.localeCompare(b.relativePath)
  );
}

async function loadWebDocument(input: {
  root: string;
  areaId: string;
  areaName: string;
  file: AreaFile;
  readFile: AreaFileReader;
}): Promise<WebDocument> {
  // A file Dokito lists but cannot read is one broken document, not a
  // broken Area: it keeps its place so the reader can say what is wrong. The
  // same applies to one that is simply too big: every view reads every body,
  // so a single huge file would otherwise stall the whole server.
  const oversized = input.file.bytes > MAX_DOCUMENT_BYTES;
  let content = "";
  let unreadable = false;
  if (!oversized) {
    try {
      content = await input.readFile(input.root, input.file.path);
    } catch {
      unreadable = true;
    }
  }

  const kind = documentKind(input.file.path);
  return {
    ...(unreadable ? { unreadable: true } : {}),
    ...(oversized ? { oversized: true } : {}),
    areaId: input.areaId,
    areaName: input.areaName,
    relativePath: input.file.path,
    title: documentTitle(content, input.file.path),
    kind,
    state: kind === "area" ? areaState(content) : resourceState(content),
    bytes: input.file.bytes,
    modifiedAt: input.file.modifiedAt,
    content,
  };
}

async function repositoryEntries(
  config: LocalConfig,
  root: string,
  manifest: AreaManifest,
) {
  return Promise.all(
    Object.entries(manifest.repositories)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(async ([id, repository]) => {
        const areaRegistration = ownValue(config.areas, manifest.id);
        const repositoryPath = areaRegistration
          ? ownValue(areaRegistration.repositories, id)?.path
          : undefined;
        const verifiedPath = repositoryPath
          ? await verifiedRepositoryPath(
              path.resolve(root, repositoryPath),
              repository.github,
            )
          : undefined;
        return {
          id,
          ...(repository.github
            ? {
                github: repository.github,
                url: `https://github.com/${repository.github}`,
              }
            : {}),
          ...(verifiedPath ? { localPath: verifiedPath } : {}),
        };
      }),
  );
}

/**
 * One Area that cannot be read must not take the others with it: a stale
 * manifest, a moved directory, or an invalid Area directory is reported and
 * skipped, the same way scope resolution handles it.
 */
export async function resolveWebAreas(
  config: LocalConfig,
): Promise<{ areas: ResolvedWebArea[]; warnings: string[] }> {
  const areas: ResolvedWebArea[] = [];
  const warnings: string[] = [];

  for (const [configuredId, registration] of Object.entries(config.areas).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    const configuredRoot = registration.path;
    try {
      const root = await ensureRealDirectory(configuredRoot);
      const manifest = await loadAreaManifest(root);
      fail(
        manifest.id === configuredId,
        "area_mismatch",
        `Configured Area '${configuredId}' contains manifest '${manifest.id}'.`,
      );
      areas.push({ root, manifest });
    } catch (error) {
      warnings.push(
        `Skipped Area '${configuredId}': ${normalizeError(error).message}`,
      );
    }
  }

  return { areas, warnings };
}

/**
 * `resolveWebAreas` promises that one Area which cannot be read does not take
 * the others with it. The promise has to hold for the files inside an Area
 * too: a filename no loader accepts is that Area's problem, not the
 * workspace's, and the Area still worth reading is why the tool was opened.
 */
/**
 * What `loadEachArea` needs from a snapshot. Structural rather than the class
 * itself, because the snapshot is built on this module.
 */
export interface AreaProblemSource {
  recordedProblems(area: ResolvedWebArea): readonly DocumentProblem[];
}

export async function loadEachArea<T>(
  /*
   * Required, not optional: documents an Area skipped are reported here rather
   * than by each screen, so no view can render a short list and stay silent
   * about why. Only problems the load already produced are read, so a screen
   * that never asks for Projects or Tasks pays nothing.
   */
  source: AreaProblemSource,
  areas: readonly ResolvedWebArea[],
  load: (area: ResolvedWebArea) => Promise<T>,
): Promise<{ loaded: T[]; warnings: string[] }> {
  const results = await Promise.all(
    areas.map(
      async (
        area,
      ): Promise<
        | { ok: true; value: T; warnings: string[] }
        | { ok: false; warnings: string[] }
      > => {
        try {
          const value = await load(area);
          return {
            ok: true,
            value,
            warnings: source
              .recordedProblems(area)
              .map((problem) =>
                documentProblemWarning(area.manifest.id, problem),
              ),
          };
        } catch (error) {
          return {
            ok: false,
            warnings: [
              `Skipped Area '${area.manifest.id}': ${
                normalizeError(error).message
              }`,
            ],
          };
        }
      },
    ),
  );

  return {
    loaded: results.flatMap((result) => (result.ok ? [result.value] : [])),
    warnings: results.flatMap((result) => result.warnings),
  };
}

export async function loadWorkArea(input: {
  area: ResolvedWebArea;
  config: LocalConfig;
  /*
   * Required: loading here instead would read past the snapshot, so whatever
   * it skipped would never reach `recordedProblems` and never be reported.
   */
  projects: LoadedProjects;
  localTasks?: TaskDocument[];
}) {
  const { root, manifest } = input.area;
  const projects = input.projects;
  const repositories = await repositoryEntries(input.config, root, manifest);
  const taskList = await listAreaTasks({
    areaRoot: root,
    areaManifest: manifest,
    projects,
    ...(input.localTasks ? { localTasks: input.localTasks } : {}),
    status: "all",
  });
  const workItems = await buildWebWorkItems({
    areaId: manifest.id,
    areaName: manifest.name,
    projects: projects.projects,
    repositories,
    localTasks: taskList.localTasks,
    includeLocalActions: false,
  });

  return {
    id: manifest.id,
    name: manifest.name,
    projects: projects.projects,
    repositories,
    workItems,
    warnings: taskList.warnings,
  };
}

export async function loadDocumentsArea(
  area: ResolvedWebArea,
  options: {
    files?: readonly AreaFile[];
    readFile?: AreaFileReader;
  } = {},
): Promise<WebDocumentsArea> {
  const files = options.files ?? (await listAreaFiles(area.root));
  const readFile = options.readFile ?? readAreaFile;
  const documents = await Promise.all(
    files.map((file) =>
      loadWebDocument({
        root: area.root,
        areaId: area.manifest.id,
        areaName: area.manifest.name,
        file,
        readFile,
      }),
    ),
  );
  return {
    id: area.manifest.id,
    name: area.manifest.name,
    documents: documents.sort(compareDocuments),
  };
}

/**
 * The document snapshot already contains the frontmatter the typed Project
 * and Task loaders would read again. Related metadata can be derived from it
 * without another filesystem pass.
 */
function documentStatuses(documents: readonly WebDocument[]) {
  const statuses = new Map<string, string>();
  for (const document of documents) {
    const status = frontmatterField(document.content, "status");
    if (document.kind === "project" && status && isProjectStatus(status)) {
      statuses.set(document.relativePath, projectStatusLabel(status));
    }
    if (document.kind === "task" && status && isTaskStatus(status)) {
      const urgent =
        frontmatterField(document.content, "priority") === "urgent" &&
        taskStatusMatches(status, "open");
      statuses.set(
        document.relativePath,
        urgent ? "Urgent" : taskStatusLabel(status),
      );
    }
  }
  return statuses;
}

/** Derived once per Area revision and shared by every detail surface. */
export function createDocumentRelations(
  documents: readonly WebDocument[],
): DocumentRelations {
  return {
    graph: buildLinkGraph(documents),
    statuses: documentStatuses(documents),
  };
}

/** Documents the open one links to, plus the ones that link back to it. */
export function relatedDocuments(
  documents: readonly WebDocument[],
  selected: WebDocument,
  statuses: ReadonlyMap<string, string>,
  graph: ReadonlyMap<string, DocumentLinks> = buildLinkGraph(documents),
): WebRelatedDocument[] {
  const links = graph.get(selected.relativePath);
  if (!links) {
    return [];
  }

  const byPath = new Map(
    documents.map((document) => [document.relativePath, document]),
  );
  const collect = (
    paths: readonly string[],
    direction: WebRelatedDocument["direction"],
  ): WebRelatedDocument[] =>
    paths.flatMap((path) => {
      const document = byPath.get(path);
      if (!document) {
        return [];
      }
      const status = statuses.get(document.relativePath);
      return [
        {
          title: document.title,
          relativePath: document.relativePath,
          kind: document.kind,
          direction,
          state: document.state,
          ...(status ? { status } : {}),
        },
      ];
    });

  return [
    ...collect(links.outbound, "outbound"),
    ...collect(links.inbound, "inbound"),
  ];
}

export function documentRefs(
  documents: readonly WebDocument[],
  paths: readonly string[],
): WebDocumentRef[] {
  const byPath = new Map(
    documents.map((document) => [document.relativePath, document]),
  );
  return paths.flatMap((path) => {
    const document = byPath.get(path);
    return document
      ? [
          {
            title: document.title,
            relativePath: document.relativePath,
            kind: document.kind,
          },
        ]
      : [];
  });
}
