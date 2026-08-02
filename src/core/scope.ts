import { lstat } from "node:fs/promises";
import path from "node:path";
import {
  loadRegisteredAreas,
  type RegisteredArea,
  type RegisteredAreas,
} from "./areas";
import { loadConfig } from "./config";
import { DokitoError, fail } from "./error";
import { ensureRealDirectory, findUp } from "./files";
import {
  gitRemoteUrls,
  gitWorktreeRoot,
  normalizeGitHubRemote,
  normalizeGitHubRepository,
} from "./git";
import { loadAreaManifest } from "./manifests";
import { canonicalRepositoryPath } from "./repositories";
import type { AreaScope, LocalConfig, ScopeResolution } from "./types";
import { ownValue } from "./yaml";

export interface ScopeInput {
  cwd: string;
  configPath: string;
}

interface RepositoryMatch {
  area: RegisteredArea;
  repository: string;
}

async function assertRegularManifest(target: string): Promise<void> {
  const info = await lstat(target);
  fail(
    !info.isSymbolicLink(),
    "symlink_not_allowed",
    `Manifest is a symlink: ${target}`,
  );
  fail(info.isFile(), "manifest_not_file", `Manifest is not a file: ${target}`);
}

function repositoryScope(
  area: RegisteredArea,
  repository: string,
  codeRoot: string,
  resolution: Exclude<ScopeResolution, "area_manifest">,
  registrationWarnings: string[],
): AreaScope {
  fail(
    ownValue(area.manifest.repositories, repository) !== undefined,
    "repository_not_registered",
    `Repository '${repository}' is not registered in Area '${area.manifest.id}'.`,
  );

  return {
    area: area.manifest.id,
    areaName: area.manifest.name,
    areaRoot: area.root,
    areaManifest: area.manifest,
    repository,
    codeRoot,
    resolution,
    warnings: registrationWarnings,
  };
}

function remoteMatches(
  areas: ReadonlyMap<string, RegisteredArea>,
  remotes: ReadonlySet<string>,
): RepositoryMatch[] {
  const matches: RepositoryMatch[] = [];
  for (const area of areas.values()) {
    for (const [repository, registration] of Object.entries(
      area.manifest.repositories,
    )) {
      if (!registration.github) {
        continue;
      }
      const github = normalizeGitHubRepository(registration.github);
      fail(
        github,
        "area_manifest_invalid",
        `Invalid GitHub repository: ${registration.github}`,
      );
      if (remotes.has(github)) {
        matches.push({ area, repository });
      }
    }
  }
  return matches;
}

async function localPathMatch(
  config: LocalConfig,
  registered: RegisteredAreas,
  codeRoot: string,
): Promise<RepositoryMatch | null> {
  const matches: Array<{ area: string; repository: string }> = [];
  for (const [area, registration] of Object.entries(config.areas)) {
    for (const [repository, repositoryConfig] of Object.entries(
      registration.repositories,
    )) {
      const configuredPath = path.resolve(
        registration.path,
        repositoryConfig.path,
      );
      const candidate =
        configuredPath === codeRoot
          ? codeRoot
          : await canonicalRepositoryPath(configuredPath);
      if (candidate !== codeRoot) {
        continue;
      }
      matches.push({ area, repository });
    }
  }
  if (matches.length === 0) {
    return null;
  }
  if (matches.length > 1) {
    throw new DokitoError(
      "repository_path_ambiguous",
      `Several local Repository paths resolve '${codeRoot}'.`,
      {
        gitRoot: codeRoot,
        matches: matches
          .map((match) => `${match.area}/${match.repository}`)
          .sort(),
      },
    );
  }

  const match = matches[0];
  fail(match, "internal_error", "The Repository path match disappeared.");
  const area = registered.areas.get(match.area);
  const unavailable = registered.unavailable.get(match.area);
  if (unavailable) {
    throw new DokitoError(
      "repository_path_invalid",
      `Local Repository path for '${codeRoot}' points to unavailable Area '${match.area}': ${unavailable.error.message}`,
      {
        gitRoot: codeRoot,
        area: match.area,
        areaRoot: unavailable.root,
        cause: unavailable.error.code,
      },
    );
  }
  if (
    !area ||
    ownValue(area.manifest.repositories, match.repository) === undefined
  ) {
    throw new DokitoError(
      "repository_path_invalid",
      `Local Repository path for '${codeRoot}' points to an unknown Area or Repository.`,
      {
        gitRoot: codeRoot,
        area: match.area,
        repository: match.repository,
      },
    );
  }
  return {
    area,
    repository: match.repository,
  };
}

export async function resolveScope(input: ScopeInput): Promise<AreaScope> {
  const cwd = await ensureRealDirectory(input.cwd);
  const areaManifestPath = await findUp(cwd, "dokito.yaml");
  if (areaManifestPath) {
    await assertRegularManifest(areaManifestPath);
    const areaRoot = path.dirname(areaManifestPath);
    const areaManifest = await loadAreaManifest(areaRoot);
    return {
      area: areaManifest.id,
      areaName: areaManifest.name,
      areaRoot,
      areaManifest,
      resolution: "area_manifest",
      warnings: [],
    };
  }

  /*
   * Falling through to the Git path means no Area manifest was found above the
   * working directory. Reporting only Git's own failure names the second of two
   * resolution paths and never mentions Areas, which is the actual subject.
   */
  const codeRoot = await gitWorktreeRoot(cwd).catch((error) => {
    if (
      error instanceof DokitoError &&
      error.code === "git_worktree_not_found"
    ) {
      throw new DokitoError(
        "area_not_resolved",
        `No Area here: '${cwd}' holds no dokito.yaml above it and is not a Git checkout of a registered Repository. Run 'dokito areas' to list the registered Areas.`,
        { cwd },
      );
    }
    throw error;
  });
  const config = await loadConfig(input.configPath);
  const registered = await loadRegisteredAreas(config);
  const remoteIdentities = new Set(
    (await gitRemoteUrls(codeRoot))
      .map((remote) => normalizeGitHubRemote(remote))
      .filter((remote): remote is string => remote !== null),
  );
  const matches = remoteMatches(registered.areas, remoteIdentities);

  if (matches.length === 1 && matches[0]) {
    const match = matches[0];
    return repositoryScope(
      match.area,
      match.repository,
      codeRoot,
      "git_remote",
      registered.warnings,
    );
  }

  const localPath = await localPathMatch(config, registered, codeRoot);
  if (localPath) {
    return repositoryScope(
      localPath.area,
      localPath.repository,
      codeRoot,
      "repository_path",
      registered.warnings,
    );
  }

  if (matches.length > 1) {
    throw new DokitoError(
      "repository_match_ambiguous",
      "Several registered Repositories match the Git remotes and no configured local Repository path resolves the ambiguity.",
      {
        gitRoot: codeRoot,
        remotes: [...remoteIdentities].sort(),
        matches: matches
          .map((match) => `${match.area.manifest.id}/${match.repository}`)
          .sort(),
        warnings: registered.warnings,
      },
    );
  }

  throw new DokitoError(
    "repository_not_matched",
    "No registered Repository matches the Git remotes or configured local Repository paths.",
    {
      gitRoot: codeRoot,
      remotes: [...remoteIdentities].sort(),
      warnings: registered.warnings,
    },
  );
}
