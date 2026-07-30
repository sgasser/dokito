import type { ProjectStatus } from "./project-model";
import type { TaskListStatus, TaskPriority, TaskStatus } from "./task-model";

export type {
  TaskLifecycleFilter,
  TaskListStatus,
  TaskStatus,
} from "./task-model";

export interface LocalConfig {
  areas: Record<string, LocalAreaConfig>;
}

export interface LocalAreaConfig {
  path: string;
  repositories: Record<string, LocalRepositoryConfig>;
}

export interface LocalRepositoryConfig {
  path: string;
}

export interface RepositoryConfig {
  github?: string;
}

export interface AreaManifest {
  version: 1;
  id: string;
  name: string;
  repositories: Record<string, RepositoryConfig>;
}

export interface ProjectDocument {
  id: string;
  status: ProjectStatus;
  repositories: string[];
  due?: string;
  title: string;
  /** First prose paragraph after the heading, without an "Outcome:" prefix. */
  outcome?: string;
  /** Second prose paragraph after the heading. */
  note?: string;
  relativePath: string;
  content: string;
}

export interface TaskDocument {
  id: string;
  status: TaskStatus;
  project?: string;
  repository?: string;
  priority?: TaskPriority;
  due?: string;
  title: string;
  /** First prose paragraph after the heading. */
  description?: string;
  relativePath: string;
  content: string;
}

export interface LocalTask {
  id: string;
  status: TaskStatus;
  project?: string;
  repository?: string;
  priority?: TaskPriority;
  due?: string;
  title: string;
  description?: string;
  relativePath: string;
}

export interface TaskListResult {
  area: string;
  areaName: string;
  repository?: string;
  project?: string;
  status: TaskListStatus;
  localTasks: LocalTask[];
  warnings: string[];
}

export type ScopeResolution =
  | "area_manifest"
  | "git_remote"
  | "repository_path";

export interface AreaScope {
  area: string;
  areaName: string;
  areaRoot: string;
  areaManifest: AreaManifest;
  repository?: string;
  codeRoot?: string;
  resolution: ScopeResolution;
  warnings: string[];
}

export interface ContextCollection {
  path: string;
  count: number;
}

export interface ContextResult {
  area: string;
  areaName: string;
  areaRoot: string;
  manifestPath: string;
  contextPath: string;
  repository?: string;
  codeRoot?: string;
  resolution: ScopeResolution;
  context: string;
  projects: ContextCollection;
  resources: ContextCollection;
  tasks: ContextCollection;
  warnings: string[];
}
