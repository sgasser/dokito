import path from "node:path";
import {
  type AreaFile,
  type AreaFileReader,
  listAreaFiles,
  readAreaFile,
} from "../../core/files";
import {
  type DocumentProblem,
  type LoadedProjects,
  type LoadedTasks,
  loadProjects,
  loadTasks,
} from "../../core/manifests";
import { areaState } from "../../core/state-model";
import { toLocalTask } from "../../core/tasks";
import type {
  LocalTask,
  ProjectDocument,
  TaskDocument,
} from "../../core/types";
import {
  createDocumentRelations,
  type DocumentRelations,
  loadDocumentsArea,
  type ResolvedWebArea,
} from "./areas";
import type { WebAreaNavigationItem, WebDocumentsArea } from "./types";
import { resolveWorkspace, type WorkspaceScope } from "./workspace";

export interface WorkspaceSnapshotInput {
  configPath: string;
  area?: string;
  /** The Web server supplies its snapshot factory; direct callers omit it. */
  workspaceStore?: WorkspaceStore;
}

interface AreaData {
  files: AreaFile[];
  readFile: AreaFileReader;
  documents?: Promise<WebDocumentsArea>;
  relations?: Promise<DocumentRelations>;
  projects?: Promise<LoadedProjects>;
  tasks?: Promise<LoadedTasks>;
  localTasks?: Promise<LocalTask[]>;
}

export interface WorkspaceStoreOptions {
  inventory?: typeof listAreaFiles;
  readFile?: AreaFileReader;
}

/**
 * Creates a fresh request-local snapshot. It owns no data cache: external file
 * changes are visible on the next request without invalidation machinery.
 */
export class WorkspaceStore {
  readonly configPath: string;
  readonly inventory: typeof listAreaFiles;
  readonly readFile: AreaFileReader;

  constructor(configPath: string, options: WorkspaceStoreOptions = {}) {
    this.configPath = path.resolve(configPath);
    this.inventory = options.inventory ?? listAreaFiles;
    this.readFile = options.readFile ?? readAreaFile;
  }

  async snapshot(input: { area?: string } = {}): Promise<WorkspaceSnapshot> {
    const scope = await resolveWorkspace({
      configPath: this.configPath,
      ...(input.area ? { area: input.area } : {}),
    });
    return new WorkspaceSnapshot(scope, this.inventory, this.readFile);
  }
}

/**
 * One coherent catalogue per HTTP request. Bodies and parsed products are
 * shared only inside this snapshot and discarded with the response.
 */
export class WorkspaceSnapshot {
  private navigationResult?: Promise<WebAreaNavigationItem[]>;
  private readonly dataResults = new Map<string, Promise<AreaData>>();
  private readonly problemsByRoot = new Map<string, DocumentProblem[]>();
  private readonly bodyResults = new Map<string, Promise<string>>();

  constructor(
    readonly scope: WorkspaceScope,
    private readonly inventory: typeof listAreaFiles,
    private readonly sourceReader: AreaFileReader,
  ) {}

  static async create(
    input: WorkspaceSnapshotInput,
  ): Promise<WorkspaceSnapshot> {
    const store = input.workspaceStore ?? new WorkspaceStore(input.configPath);
    if (store.configPath !== path.resolve(input.configPath)) {
      throw new Error("WorkspaceStore and loader config paths do not match.");
    }
    return store.snapshot({
      ...(input.area ? { area: input.area } : {}),
    });
  }

  navigation(): Promise<WebAreaNavigationItem[]> {
    this.navigationResult ??= Promise.all(
      this.scope.roots.map(async (area) => {
        try {
          return {
            id: area.manifest.id,
            name: area.manifest.name,
            state: areaState(await this.read(area.root, "context.md")),
          };
        } catch {
          return {
            id: area.manifest.id,
            name: area.manifest.name,
            state: "active" as const,
          };
        }
      }),
    );
    return this.navigationResult;
  }

  documents(area: ResolvedWebArea): Promise<WebDocumentsArea> {
    return this.areaData(area).then((data) => {
      data.documents ??= loadDocumentsArea(area, {
        files: data.files,
        readFile: data.readFile,
      });
      return data.documents;
    });
  }

  relations(area: ResolvedWebArea): Promise<DocumentRelations> {
    return this.areaData(area).then((data) => {
      data.relations ??= this.documents(area).then((documents) =>
        createDocumentRelations(documents.documents),
      );
      return data.relations;
    });
  }

  projects(area: ResolvedWebArea): Promise<ProjectDocument[]> {
    return this.loadedProjects(area).then((loaded) => loaded.projects);
  }

  tasks(area: ResolvedWebArea): Promise<LocalTask[]> {
    return this.areaData(area).then((data) => {
      data.localTasks ??= this.loadedTasks(area).then((loaded) =>
        loaded.tasks.map(toLocalTask),
      );
      return data.localTasks;
    });
  }

  /** The full Markdown document is exposed only for one selected Task. */
  task(area: ResolvedWebArea, id: string): Promise<TaskDocument | undefined> {
    return this.loadedTasks(area).then((loaded) =>
      loaded.tasks.find((task) => task.id === id),
    );
  }

  /**
   * Documents this Area skipped, from the reads that already happened. It does
   * not start one: a screen that never asked for Projects or Tasks has nothing
   * to answer for.
   */
  recordedProblems(area: ResolvedWebArea): readonly DocumentProblem[] {
    return this.problemsByRoot.get(area.root) ?? [];
  }

  /** The Projects with whatever failed to read, for a caller that needs both. */
  loadedProjects(area: ResolvedWebArea): Promise<LoadedProjects> {
    return this.areaData(area).then((data) => {
      data.projects ??= loadProjects(
        area.root,
        new Set(Object.keys(area.manifest.repositories)),
        data.readFile,
      ).then((loaded) => this.record(area.root, loaded));
      return data.projects;
    });
  }

  private loadedTasks(area: ResolvedWebArea): Promise<LoadedTasks> {
    return this.areaData(area).then((data) => {
      data.tasks ??= this.loadedProjects(area).then((projects) =>
        loadTasks(
          area.root,
          new Set(Object.keys(area.manifest.repositories)),
          data.readFile,
          { projects },
        ).then((loaded) => this.record(area.root, loaded)),
      );
      return data.tasks;
    });
  }

  private record<T extends { problems: DocumentProblem[] }>(
    root: string,
    loaded: T,
  ): T {
    const existing = this.problemsByRoot.get(root);
    if (existing) {
      existing.push(...loaded.problems);
    } else {
      this.problemsByRoot.set(root, [...loaded.problems]);
    }
    return loaded;
  }

  private areaData(area: ResolvedWebArea): Promise<AreaData> {
    let result = this.dataResults.get(area.root);
    if (!result) {
      result = this.inventory(area.root).then((files) => ({
        files,
        readFile: (root, relativePath) => this.read(root, relativePath),
      }));
      this.dataResults.set(area.root, result);
    }
    return result;
  }

  private read(areaRoot: string, relativePath: string): Promise<string> {
    const key = `${areaRoot}\0${relativePath}`;
    let result = this.bodyResults.get(key);
    if (!result) {
      result = this.sourceReader(areaRoot, relativePath);
      this.bodyResults.set(key, result);
    }
    return result;
  }
}
