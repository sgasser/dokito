import path from "node:path";
import { loadConfig, registerArea } from "./config";
import { DokitoError, fail } from "./error";
import { ensureRealDirectory } from "./files";
import { loadAreaManifest } from "./manifests";
import { siblingRepositoryPath, verifiedRepositoryPath } from "./repositories";
import type {
  AreaManifest,
  LocalAreaConfig,
  LocalConfig,
  LocalRepositoryConfig,
} from "./types";
import { ownValue } from "./yaml";

export interface RegisteredArea {
  root: string;
  manifest: AreaManifest;
  registration: LocalAreaConfig;
}

interface UnavailableArea {
  root: string;
  error: DokitoError;
}

export interface RegisteredAreas {
  areas: Map<string, RegisteredArea>;
  unavailable: Map<string, UnavailableArea>;
  warnings: string[];
}

interface AvailableAreaSummary {
  id: string;
  name: string;
  path: string;
  available: true;
  repositoryCount: number;
}

interface UnavailableAreaSummary {
  id: string;
  path: string;
  available: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

type AreaSummary = AvailableAreaSummary | UnavailableAreaSummary;

export interface AreaListResult {
  configPath: string;
  areas: AreaSummary[];
  warnings: string[];
}

export interface RegisterAreaResult {
  area: string;
  name: string;
  path: string;
  manifestPath: string;
  configPath: string;
  changed: boolean;
}

async function discoverRepositoryPaths(
  areaRoot: string,
  manifest: AreaManifest,
): Promise<Record<string, LocalRepositoryConfig>> {
  const repositories: Record<string, LocalRepositoryConfig> = {};

  for (const [repository, repositoryConfig] of Object.entries(
    manifest.repositories,
  )) {
    const gitRoot = await verifiedRepositoryPath(
      siblingRepositoryPath(areaRoot, repository),
      repositoryConfig.github,
    );
    if (gitRoot) {
      repositories[repository] = {
        path: path.relative(areaRoot, gitRoot) || ".",
      };
    }
  }

  return repositories;
}

function omitOwnedRepositoryPaths(
  config: LocalConfig,
  area: string,
  areaRoot: string,
  manifest: AreaManifest,
  repositories: Record<string, LocalRepositoryConfig>,
): Record<string, LocalRepositoryConfig> {
  const owners = new Map<string, string>();
  for (const [configuredArea, registration] of Object.entries(config.areas)) {
    for (const [repository, repositoryConfig] of Object.entries(
      registration.repositories,
    )) {
      if (
        configuredArea === area &&
        ownValue(manifest.repositories, repository) === undefined
      ) {
        continue;
      }
      owners.set(
        path.resolve(registration.path, repositoryConfig.path),
        `${configuredArea}/${repository}`,
      );
    }
  }

  return Object.fromEntries(
    Object.entries(repositories).filter(([repository, repositoryConfig]) => {
      const owner = owners.get(path.resolve(areaRoot, repositoryConfig.path));
      return owner === undefined || owner === `${area}/${repository}`;
    }),
  );
}

export async function registerExistingArea(input: {
  cwd: string;
  target: string;
  configPath: string;
}): Promise<RegisterAreaResult> {
  const root = await ensureRealDirectory(path.resolve(input.cwd, input.target));
  const manifest = await loadAreaManifest(root);
  const config = await loadConfig(input.configPath);
  const repositoryIds = new Set(Object.keys(manifest.repositories));
  const discoveredRepositories = omitOwnedRepositoryPaths(
    config,
    manifest.id,
    root,
    manifest,
    await discoverRepositoryPaths(root, manifest),
  );

  const changed = await registerArea(
    input.configPath,
    manifest.id,
    root,
    discoveredRepositories,
    { allowedRepositories: repositoryIds },
  );
  return {
    area: manifest.id,
    name: manifest.name,
    path: root,
    manifestPath: path.join(root, "dokito.yaml"),
    configPath: input.configPath,
    changed,
  };
}

export async function loadRegisteredAreas(
  config: LocalConfig,
): Promise<RegisteredAreas> {
  const areas = new Map<string, RegisteredArea>();
  const unavailable = new Map<string, UnavailableArea>();
  const warnings: string[] = [];

  for (const [areaId, registration] of Object.entries(config.areas).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    const configuredRoot = registration.path;
    try {
      const root = await ensureRealDirectory(configuredRoot);
      const manifest = await loadAreaManifest(root);
      fail(
        manifest.id === areaId,
        "area_mismatch",
        `Configured Area '${areaId}' contains manifest '${manifest.id}'.`,
        { area: areaId, areaRoot: root },
      );
      for (const repository of Object.keys(registration.repositories)) {
        fail(
          ownValue(manifest.repositories, repository) !== undefined,
          "repository_path_invalid",
          `Local Repository path for '${areaId}/${repository}' names an unknown Repository.`,
          { area: areaId, repository, areaRoot: root },
        );
      }
      areas.set(areaId, { root, manifest, registration });
    } catch (error) {
      if (!(error instanceof DokitoError)) {
        throw error;
      }
      unavailable.set(areaId, { root: configuredRoot, error });
      warnings.push(
        `Skipped registered Area '${areaId}' at '${configuredRoot}': ${error.message}`,
      );
    }
  }

  return { areas, unavailable, warnings };
}

export async function listAreas(input: {
  configPath: string;
}): Promise<AreaListResult> {
  const config = await loadConfig(input.configPath);
  const registered = await loadRegisteredAreas(config);
  const areas = Object.entries(config.areas)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, registration]): AreaSummary => {
      const configuredRoot = registration.path;
      const available = registered.areas.get(id);
      if (available) {
        return {
          id,
          name: available.manifest.name,
          path: available.root,
          available: true,
          repositoryCount: Object.keys(available.manifest.repositories).length,
        };
      }

      const unavailable = registered.unavailable.get(id);
      if (!unavailable) {
        throw new DokitoError(
          "internal_error",
          `Registered Area '${id}' was neither available nor unavailable.`,
        );
      }
      return {
        id,
        path: configuredRoot,
        available: false,
        error: {
          code: unavailable.error.code,
          message: unavailable.error.message,
          ...(unavailable.error.details
            ? { details: unavailable.error.details }
            : {}),
        },
      };
    });

  return {
    configPath: input.configPath,
    areas,
    warnings: registered.warnings,
  };
}
