import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DokitoError, fail } from "./error";
import { pathExists, readUtf8, writeTextAtomic } from "./files";
import { validateSlug } from "./manifests";
import type {
  LocalAreaConfig,
  LocalConfig,
  LocalRepositoryConfig,
} from "./types";
import { asRecord, assertKeys, ownValue, parseYaml } from "./yaml";

const CONFIG_LOCK_RETRY_MS = 10;
const CONFIG_LOCK_TIMEOUT_MS = 5_000;

async function withConfigLock<T>(
  configPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lockPath = `${configPath}.lock`;
  const deadline = Date.now() + CONFIG_LOCK_TIMEOUT_MS;
  await mkdir(path.dirname(configPath), { recursive: true });

  while (true) {
    try {
      await writeFile(lockPath, "", { flag: "wx" });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new DokitoError(
          "write_failed",
          `Could not lock ${configPath} for writing.`,
          {
            path: configPath,
            cause: error instanceof Error ? error.message : String(error),
          },
        );
      }
      fail(
        Date.now() < deadline,
        "config_locked",
        `Timed out waiting to write ${configPath}. If no other Dokito process is running, remove ${lockPath}.`,
        { path: configPath, lockPath },
      );
      await delay(CONFIG_LOCK_RETRY_MS);
    }
  }

  try {
    return await operation();
  } finally {
    await rm(lockPath, { force: true });
  }
}

function expandHome(value: string): string {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function assertRepositoryPaths(config: LocalConfig, source: string): void {
  const owners = new Map<string, string>();
  for (const [area, registration] of Object.entries(config.areas)) {
    for (const [repository, repositoryConfig] of Object.entries(
      registration.repositories,
    )) {
      fail(
        repositoryConfig.path.length > 0 &&
          !path.isAbsolute(repositoryConfig.path),
        "config_invalid",
        `${source}.areas.${area}.repositories.${repository}.path must be relative to the Area path.`,
      );
      const absolutePath = path.resolve(
        registration.path,
        repositoryConfig.path,
      );
      const owner = `${area}/${repository}`;
      const existing = owners.get(absolutePath);
      fail(
        existing === undefined || existing === owner,
        "config_invalid",
        `${source} configures '${absolutePath}' for both '${existing}' and '${owner}'.`,
      );
      owners.set(absolutePath, owner);
    }
  }
}

export function defaultConfigPath(explicitPath?: string): string {
  if (explicitPath) {
    return path.resolve(expandHome(explicitPath));
  }

  const environmentPath = process.env.DOKITO_CONFIG_PATH;
  if (environmentPath) {
    return path.resolve(expandHome(environmentPath));
  }

  const configHome = process.env.XDG_CONFIG_HOME
    ? path.resolve(expandHome(process.env.XDG_CONFIG_HOME))
    : path.join(os.homedir(), ".config");

  return path.join(configHome, "dokito", "config.yaml");
}

export function parseConfig(value: unknown, source: string): LocalConfig {
  const root = asRecord(
    value,
    "config_invalid",
    `${source} must be an object.`,
  );
  assertKeys(root, ["areas"], "config_invalid", source);
  const areaRecord = asRecord(
    root.areas ?? {},
    "config_invalid",
    `${source}.areas must be an object.`,
  );
  const areas: Record<string, LocalAreaConfig> = {};

  for (const [area, areaValue] of Object.entries(areaRecord)) {
    validateSlug(area, "Area ID");
    const registration = asRecord(
      areaValue,
      "config_invalid",
      `${source}.areas.${area} must be an object.`,
    );
    assertKeys(
      registration,
      ["path", "repositories"],
      "config_invalid",
      `${source}.areas.${area}`,
    );
    const areaPath = registration.path;
    fail(
      typeof areaPath === "string" && areaPath.length > 0,
      "config_invalid",
      `${source}.areas.${area}.path must be a path.`,
    );
    const expanded = expandHome(areaPath);
    fail(
      path.isAbsolute(expanded),
      "config_invalid",
      `${source}.areas.${area}.path must be absolute.`,
    );
    const repositoryRecord = asRecord(
      registration.repositories ?? {},
      "config_invalid",
      `${source}.areas.${area}.repositories must be an object.`,
    );
    const repositories: Record<string, LocalRepositoryConfig> = {};
    for (const [repository, repositoryValue] of Object.entries(
      repositoryRecord,
    )) {
      validateSlug(repository, "Repository ID");
      const repositoryConfig = asRecord(
        repositoryValue,
        "config_invalid",
        `${source}.areas.${area}.repositories.${repository} must be an object.`,
      );
      assertKeys(
        repositoryConfig,
        ["path"],
        "config_invalid",
        `${source}.areas.${area}.repositories.${repository}`,
      );
      const repositoryPath = repositoryConfig.path;
      fail(
        typeof repositoryPath === "string" && repositoryPath.length > 0,
        "config_invalid",
        `${source}.areas.${area}.repositories.${repository}.path must be a path.`,
      );
      fail(
        !path.isAbsolute(repositoryPath),
        "config_invalid",
        `${source}.areas.${area}.repositories.${repository}.path must be relative to the Area path.`,
      );
      repositories[repository] = { path: path.normalize(repositoryPath) };
    }
    areas[area] = {
      path: path.normalize(expanded),
      repositories,
    };
  }

  const config = { areas };
  assertRepositoryPaths(config, source);
  return config;
}

export async function loadConfig(configPath: string): Promise<LocalConfig> {
  if (!(await pathExists(configPath))) {
    return { areas: {} };
  }
  // An empty or comment-only file parses to null. Treating that as "no Areas
  // yet" keeps `register` able to repair a config the user cannot read.
  const parsed = parseYaml(await readUtf8(configPath), configPath);
  if (parsed === null || parsed === undefined) {
    return { areas: {} };
  }
  return parseConfig(parsed, configPath);
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function renderConfig(config: LocalConfig): string {
  const lines = ["areas:"];
  const areaEntries = Object.entries(config.areas).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (areaEntries.length === 0) {
    lines[0] = "areas: {}";
  } else {
    for (const [area, registration] of areaEntries) {
      lines.push(`  ${area}:`, `    path: ${yamlString(registration.path)}`);
      const repositories = Object.entries(registration.repositories).sort(
        ([a], [b]) => a.localeCompare(b),
      );
      if (repositories.length === 0) {
        lines.push("    repositories: {}");
        continue;
      }
      lines.push("    repositories:");
      for (const [repository, repositoryConfig] of repositories) {
        lines.push(
          `      ${repository}:`,
          `        path: ${yamlString(repositoryConfig.path)}`,
        );
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function registerArea(
  configPath: string,
  area: string,
  areaRoot: string,
  repositories: Record<string, LocalRepositoryConfig> = {},
  options: { allowedRepositories?: ReadonlySet<string> } = {},
): Promise<boolean> {
  return withConfigLock(configPath, async () => {
    const config = await loadConfig(configPath);
    const before = renderConfig(config);
    const existing = ownValue(config.areas, area);
    const normalizedRoot = path.normalize(areaRoot);
    fail(
      existing === undefined ||
        path.normalize(existing.path) === normalizedRoot,
      "area_registration_conflict",
      `Area '${area}' is already registered at another path.`,
      {
        area,
        registeredPath: existing?.path,
        requestedPath: normalizedRoot,
      },
    );
    const existingRepositories = Object.fromEntries(
      Object.entries(existing?.repositories ?? {}).filter(
        ([repository]) => options.allowedRepositories?.has(repository) ?? true,
      ),
    );
    config.areas[area] = {
      path: normalizedRoot,
      repositories: {
        ...repositories,
        ...existingRepositories,
      },
    };
    assertRepositoryPaths(config, configPath);
    const rendered = renderConfig(config);
    if (rendered === before) {
      return false;
    }
    await writeTextAtomic(configPath, rendered);
    return true;
  });
}
