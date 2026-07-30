import { afterEach, describe, expect, test } from "bun:test";
import { readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig, registerArea } from "../../src/core/config";
import { ensureRealDirectory } from "../../src/core/files";
import { normalizeGitHubRemote } from "../../src/core/git";
import { resolveScope } from "../../src/core/scope";
import {
  createTestWorkspace,
  dokitoCli,
  registerTestArea,
  run,
  type TestWorkspace,
  type TestWorkspaceOptions,
} from "../helpers";

describe("Repository discovery", () => {
  let workspace: TestWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
  });

  async function setup(options?: TestWorkspaceOptions): Promise<TestWorkspace> {
    workspace = await createTestWorkspace(options);
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    return workspace;
  }

  test("normalizes GitHub SSH and HTTPS URLs", () => {
    expect(normalizeGitHubRemote("git@github.com:Example/Web-App.git")).toBe(
      "example/web-app",
    );
    expect(
      normalizeGitHubRemote("https://github.com/example/web-app.git"),
    ).toBe("example/web-app");
    expect(
      normalizeGitHubRemote("ssh://git@github.com/example/web-app.git"),
    ).toBe("example/web-app");
    expect(
      normalizeGitHubRemote("git@gitlab.com:example/web-app.git"),
    ).toBeNull();
  });

  test("checks every remote and leaves the worktree unchanged", async () => {
    const fixture = await setup({
      remotes: [
        { name: "origin", url: "git@github.com:fork/web-app.git" },
        {
          name: "upstream",
          url: "https://github.com/example/web-app.git",
        },
      ],
    });
    const before = await run(
      ["git", "status", "--porcelain", "--untracked-files=all"],
      fixture.codeRoot,
    );
    const scope = await resolveScope({
      cwd: path.join(fixture.codeRoot, "src", "nested"),
      configPath: fixture.configPath,
    });

    expect(scope.repository).toBe("web-app");
    expect(scope.resolution).toBe("git_remote");
    expect(
      await run(
        ["git", "status", "--porcelain", "--untracked-files=all"],
        fixture.codeRoot,
      ),
    ).toBe(before);
  });

  test("uses the actual root of a linked Git worktree", async () => {
    const fixture = await setup();
    const worktreeRoot = path.join(fixture.root, "linked-worktree");
    await run(
      ["git", "worktree", "add", "-q", "-b", "worktree-test", worktreeRoot],
      fixture.codeRoot,
    );
    const scope = await resolveScope({
      cwd: worktreeRoot,
      configPath: fixture.configPath,
    });

    expect(scope.codeRoot).toBe(worktreeRoot);
    expect(scope.repository).toBe("web-app");
    expect(scope.resolution).toBe("git_remote");
  });

  test("fails clearly when no remote or configured path matches", async () => {
    const fixture = await setup({
      remotes: [
        { name: "origin", url: "git@github.com:other/unregistered.git" },
      ],
    });

    await expect(
      resolveScope({
        cwd: fixture.codeRoot,
        configPath: fixture.configPath,
      }),
    ).rejects.toMatchObject({ code: "repository_not_matched" });
  });

  test("reports missing and non-directory paths as domain errors", async () => {
    const fixture = await setup();
    const missing = path.join(fixture.root, "missing-area");

    await expect(ensureRealDirectory(missing)).rejects.toMatchObject({
      code: "directory_not_found",
      message: `Directory does not exist: ${missing}`,
      details: { path: missing },
    });
    await expect(ensureRealDirectory(fixture.configPath)).rejects.toMatchObject(
      {
        code: "not_a_directory",
        message: `Not a directory: ${fixture.configPath}`,
        details: { path: fixture.configPath },
      },
    );
  });

  test("skips an unavailable unrelated Area during remote resolution", async () => {
    const fixture = await setup();
    const missing = path.join(fixture.root, "missing-area");
    await registerArea(fixture.configPath, "archive", missing);
    const process = Bun.spawn(
      [
        "bun",
        "run",
        dokitoCli,
        "--json",
        "--config",
        fixture.configPath,
        "--cwd",
        fixture.codeRoot,
        "context",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    const result = JSON.parse(stdout) as {
      ok: boolean;
      data: {
        projects: { path: string };
        warnings: string[];
      };
    };

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).not.toContain("ENOENT");
    expect(result.ok).toBe(true);
    expect(result.data.projects.path).toBe(
      path.join(fixture.areaRoot, "projects"),
    );
    expect(result.data.warnings).toHaveLength(1);
    expect(result.data.warnings[0]).toContain(
      "Skipped registered Area 'archive'",
    );
    expect(result.data.warnings[0]).toContain(
      `Directory does not exist: ${missing}`,
    );
  });

  test("rejects a local Repository path to an unavailable Area", async () => {
    const fixture = await setup({ remotes: [] });
    const missing = path.join(fixture.root, "missing-area");
    await registerArea(fixture.configPath, "archive", missing, {
      "web-app": {
        path: path.relative(missing, fixture.codeRoot),
      },
    });

    await expect(
      resolveScope({
        cwd: fixture.codeRoot,
        configPath: fixture.configPath,
      }),
    ).rejects.toMatchObject({
      code: "repository_path_invalid",
      details: {
        gitRoot: fixture.codeRoot,
        area: "archive",
        areaRoot: missing,
        cause: "directory_not_found",
      },
    });
  });

  test("stores and resolves one canonical local Repository path", async () => {
    const fixture = await setup({ remotes: [] });
    const before = await run(
      ["git", "status", "--porcelain", "--untracked-files=all"],
      fixture.codeRoot,
    );
    await registerArea(fixture.configPath, "product", fixture.areaRoot, {
      "web-app": {
        path: path.relative(fixture.areaRoot, fixture.codeRoot),
      },
    });
    const config = await loadConfig(fixture.configPath);
    const scope = await resolveScope({
      cwd: fixture.codeRoot,
      configPath: fixture.configPath,
    });

    expect(config.areas.product?.repositories["web-app"]).toEqual({
      path: "../web-app",
    });
    expect(scope.resolution).toBe("repository_path");
    expect(
      await run(
        ["git", "status", "--porcelain", "--untracked-files=all"],
        fixture.codeRoot,
      ),
    ).toBe(before);
  });

  test("resolves a configured Repository path through a symlink", async () => {
    const fixture = await setup({ remotes: [] });
    const alias = path.join(fixture.root, "web-app-alias");
    await symlink(fixture.codeRoot, alias, "dir");
    await registerArea(fixture.configPath, "product", fixture.areaRoot, {
      api: {
        path: "../missing-api",
      },
      "web-app": {
        path: path.relative(fixture.areaRoot, alias),
      },
    });

    const scope = await resolveScope({
      cwd: fixture.codeRoot,
      configPath: fixture.configPath,
    });

    expect(scope.repository).toBe("web-app");
    expect(scope.resolution).toBe("repository_path");
  });

  test("uses the configured local path to resolve ambiguous remote registrations", async () => {
    workspace = await createTestWorkspace();
    const fixture = workspace;
    await registerArea(fixture.configPath, "product", fixture.areaRoot, {
      "web-app": {
        path: path.relative(fixture.areaRoot, fixture.codeRoot),
      },
    });
    const manifestPath = path.join(fixture.areaRoot, "dokito.yaml");
    const manifest = await readFile(manifestPath, "utf8");
    await writeFile(
      manifestPath,
      manifest.replace(
        "  api:",
        ["  duplicate-web-app:", "    github: example/web-app", "  api:"].join(
          "\n",
        ),
      ),
      "utf8",
    );

    const scope = await resolveScope({
      cwd: fixture.codeRoot,
      configPath: fixture.configPath,
    });
    expect(scope.repository).toBe("web-app");
    expect(scope.resolution).toBe("repository_path");
  });

  test("rejects one checkout configured for several Repositories", async () => {
    const fixture = await setup();
    await expect(
      registerArea(fixture.configPath, "product", fixture.areaRoot, {
        api: {
          path: path.relative(fixture.areaRoot, fixture.codeRoot),
        },
      }),
    ).rejects.toMatchObject({ code: "config_invalid" });
  });

  test("rejects an invalid configured Repository path", async () => {
    const fixture = await setup({ remotes: [] });
    await registerArea(fixture.configPath, "product", fixture.areaRoot, {
      "unknown-repository": {
        path: path.relative(fixture.areaRoot, fixture.codeRoot),
      },
    });

    await expect(
      resolveScope({
        cwd: fixture.codeRoot,
        configPath: fixture.configPath,
      }),
    ).rejects.toMatchObject({ code: "repository_path_invalid" });
  });

  test("removes the link command from the CLI", async () => {
    const fixture = await setup();
    const process = Bun.spawn(
      [
        "bun",
        "run",
        dokitoCli,
        "--json",
        "--config",
        fixture.configPath,
        "link",
        fixture.codeRoot,
      ],
      { cwd: fixture.root, stdout: "pipe", stderr: "pipe" },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    const result = JSON.parse(stdout) as {
      ok: boolean;
      error: { code: string; message: string };
    };

    expect(exitCode).toBe(1);
    expect(stderr).toBe("");
    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      code: "unknown_command",
      message: "Unknown command: link",
    });
  });
});
