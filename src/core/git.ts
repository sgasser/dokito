import { DokitoError, fail } from "./error";
import { ensureRealDirectory } from "./files";

interface GitResult {
  exitCode: number;
  stdout: string;
}

async function runGit(cwd: string, args: string[]): Promise<GitResult | null> {
  try {
    const process = Bun.spawn(["git", "-C", cwd, ...args], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const [stdout, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      process.exited,
    ]);
    return {
      exitCode,
      stdout: stdout.trim(),
    };
  } catch {
    return null;
  }
}

export async function gitWorktreeRoot(cwd: string): Promise<string> {
  const result = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (!result) {
    throw new DokitoError("git_unavailable", "Git is not available.");
  }
  fail(
    result.exitCode === 0 && result.stdout.length > 0,
    "git_worktree_not_found",
    "The current directory is not inside a Git worktree.",
    { cwd },
  );
  return ensureRealDirectory(result.stdout);
}

export async function gitRemoteUrls(gitRoot: string): Promise<string[]> {
  const names = await runGit(gitRoot, ["remote"]);
  if (!names) {
    throw new DokitoError("git_unavailable", "Git is not available.");
  }
  fail(
    names.exitCode === 0,
    "git_remotes_failed",
    "Could not read Git remotes.",
    { gitRoot },
  );

  const remoteNames = names.stdout.split(/\r?\n/).filter(Boolean);
  const results = await Promise.all(
    remoteNames.map(async (name) => {
      const urls = await runGit(gitRoot, ["remote", "get-url", "--all", name]);
      fail(
        urls?.exitCode === 0,
        "git_remotes_failed",
        `Could not read Git remote '${name}'.`,
        { gitRoot, remote: name },
      );
      return urls.stdout.split(/\r?\n/).filter(Boolean);
    }),
  );
  return results.flat();
}

function normalizedRepository(
  owner: string,
  repository: string,
): string | null {
  const cleanRepository = repository.replace(/\.git$/i, "");
  const validPart = /^[A-Za-z0-9_.-]+$/;
  if (!validPart.test(owner) || !validPart.test(cleanRepository)) {
    return null;
  }
  return `${owner}/${cleanRepository}`.toLocaleLowerCase("en-US");
}

export function normalizeGitHubRepository(value: string): string | null {
  const match = /^([^/]+)\/([^/]+)$/.exec(value.trim());
  return match?.[1] && match[2]
    ? normalizedRepository(match[1], match[2])
    : null;
}

export function normalizeGitHubRemote(value: string): string | null {
  const remote = value.trim();
  const scp = /^(?:[^@/:]+@)?github\.com:([^/]+)\/([^/]+)$/i.exec(remote);
  if (scp?.[1] && scp[2]) {
    return normalizedRepository(scp[1], scp[2]);
  }

  let parsed: URL;
  try {
    parsed = new URL(remote);
  } catch {
    return null;
  }
  if (
    parsed.hostname.toLocaleLowerCase("en-US") !== "github.com" ||
    !["https:", "ssh:"].includes(parsed.protocol)
  ) {
    return null;
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  return parts[0] && parts[1] && parts.length === 2
    ? normalizedRepository(parts[0], parts[1])
    : null;
}
