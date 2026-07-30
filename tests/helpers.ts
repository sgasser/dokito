import { cp, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type RegisterAreaResult,
  registerExistingArea,
} from "../src/core/areas";

export interface TestWorkspace {
  root: string;
  areaRoot: string;
  codeRoot: string;
  configPath: string;
  cleanup: () => Promise<void>;
}

export interface TestWorkspaceOptions {
  remotes?: Array<{ name: string; url: string }>;
}

const projectRoot = path.resolve(import.meta.dir, "..");

export async function registerTestArea(input: {
  cwd: string;
  target: string;
  id: string;
  name: string;
  configPath: string;
}): Promise<RegisterAreaResult> {
  const result = await registerExistingArea({
    cwd: input.cwd,
    target: input.target,
    configPath: input.configPath,
  });
  if (result.area !== input.id || result.name !== input.name) {
    throw new Error(
      `Fixture Area mismatch: expected ${input.id}/${input.name}, got ${result.area}/${result.name}.`,
    );
  }
  return result;
}

export async function run(command: string[], cwd: string): Promise<string> {
  const process = Bun.spawn(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed: ${stderr}`);
  }
  return stdout.trim();
}

async function initGit(cwd: string): Promise<void> {
  await run(["git", "init", "-q"], cwd);
  await run(["git", "add", "."], cwd);
  await run(
    [
      "git",
      "-c",
      "user.name=Dokito Test",
      "-c",
      "user.email=dokito@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "Initial fixture",
    ],
    cwd,
  );
}

export async function createTestWorkspace(
  options: TestWorkspaceOptions = {},
): Promise<TestWorkspace> {
  const createdRoot = await mkdtemp(path.join(os.tmpdir(), "dokito-test-"));
  const root = await realpath(createdRoot);
  const areaRoot = path.join(root, "product-area");
  const codeRoot = path.join(root, "web-app");
  const configPath = path.join(root, "config", "config.yaml");

  await cp(
    path.join(projectRoot, "tests", "fixtures", "product-area"),
    areaRoot,
    { recursive: true },
  );
  await cp(
    path.join(projectRoot, "tests", "fixtures", "code-repository"),
    codeRoot,
    { recursive: true },
  );
  await mkdir(path.join(codeRoot, "src", "nested"), { recursive: true });
  await initGit(areaRoot);
  await initGit(codeRoot);
  const remotes = options.remotes ?? [
    {
      name: "origin",
      url: "git@github.com:example/web-app.git",
    },
  ];
  for (const remote of remotes) {
    await run(["git", "remote", "add", remote.name, remote.url], codeRoot);
  }

  return {
    root,
    areaRoot,
    codeRoot,
    configPath,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

/**
 * A second Area, registered only where a test is about more than one of them.
 * The shared workspace stays single-Area so that every existing expectation
 * about counts, the switcher and the default Area still holds.
 *
 * It declares itself paused. A test that needs another state rewrites the
 * returned `context.md`, the way the state tests already do.
 */
export async function addTestArea(workspace: TestWorkspace): Promise<string> {
  const fixture = "writing-area";
  const root = path.join(workspace.root, fixture);
  await cp(path.join(projectRoot, "tests", "fixtures", fixture), root, {
    recursive: true,
  });
  await initGit(root);
  await registerTestArea({
    cwd: workspace.root,
    target: root,
    id: "writing",
    name: "Writing",
    configPath: workspace.configPath,
  });
  return root;
}

export const dokitoCli = path.join(projectRoot, "src", "cli", "index.ts");
