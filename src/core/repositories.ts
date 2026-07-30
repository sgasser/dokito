import path from "node:path";
import { DokitoError } from "./error";
import { ensureRealDirectory } from "./files";
import {
  gitRemoteUrls,
  gitWorktreeRoot,
  normalizeGitHubRemote,
  normalizeGitHubRepository,
} from "./git";

export function siblingRepositoryPath(
  areaRoot: string,
  repository: string,
): string {
  return path.join(path.dirname(areaRoot), repository);
}

export async function canonicalRepositoryPath(
  candidate: string,
): Promise<string | undefined> {
  try {
    return await ensureRealDirectory(candidate);
  } catch (error) {
    if (!(error instanceof DokitoError)) {
      throw error;
    }
    return undefined;
  }
}

export async function verifiedRepositoryPath(
  candidate: string,
  github?: string,
): Promise<string | undefined> {
  const directory = await canonicalRepositoryPath(candidate);
  if (!directory) {
    return undefined;
  }

  try {
    const gitRoot = await gitWorktreeRoot(directory);
    if (gitRoot !== directory) {
      return undefined;
    }
    if (github) {
      const expected = normalizeGitHubRepository(github);
      const remotes = (await gitRemoteUrls(gitRoot))
        .map(normalizeGitHubRemote)
        .filter((remote): remote is string => remote !== null);
      if (!expected || !remotes.includes(expected)) {
        return undefined;
      }
    }
    return directory;
  } catch (error) {
    if (!(error instanceof DokitoError)) {
      throw error;
    }
    return undefined;
  }
}
