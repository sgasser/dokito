import { afterEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createTestWorkspace,
  dokitoCli,
  registerTestArea,
  type TestWorkspace,
} from "../helpers";

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  json: {
    ok: boolean;
    data?: Record<string, unknown>;
    error?: { code: string; message: string };
  };
}

async function jsonCli(
  fixture: TestWorkspace,
  arguments_: string[],
  /** `--cwd` belongs only to the commands that resolve a single Area. */
  options: { scoped?: boolean } = {},
): Promise<CliResult> {
  const process = Bun.spawn(
    [
      "bun",
      "run",
      dokitoCli,
      "--json",
      "--config",
      fixture.configPath,
      ...(options.scoped === false ? [] : ["--cwd", fixture.areaRoot]),
      ...arguments_,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return {
    exitCode,
    stdout,
    stderr,
    json: JSON.parse(stdout),
  };
}

describe("File-first model workflow", () => {
  let workspace: TestWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
  });

  async function setup(): Promise<TestWorkspace> {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    return workspace;
  }

  test("creates model files directly and validates their relations", async () => {
    const fixture = await setup();
    const idResult = await jsonCli(fixture, ["id"], { scoped: false });
    const id = idResult.json.data?.id;

    expect(idResult.exitCode).toBe(0);
    expect(idResult.stderr).toBe("");
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    if (typeof id !== "string") {
      throw new Error("Expected the CLI to return a Task ULID.");
    }

    await writeFile(
      path.join(fixture.areaRoot, "resources", "release.md"),
      "# Release\n\nOperational release notes.\n",
      "utf8",
    );
    await writeFile(
      path.join(fixture.areaRoot, "projects", "mobile.md"),
      [
        "---",
        "status: active",
        "repositories:",
        "  - web-app",
        "---",
        "",
        "# Mobile launch",
        "",
        "Outcome: The mobile experience is released.",
        "",
      ].join("\n"),
      "utf8",
    );
    const taskPath = path.join(
      fixture.areaRoot,
      "tasks",
      `${id}-prepare-mobile-launch.md`,
    );
    await writeFile(
      taskPath,
      [
        "---",
        "status: todo",
        "project: mobile",
        "repository: web-app",
        "---",
        "",
        "# Prepare the mobile launch",
        "",
        "Verify the mobile release.",
        "",
      ].join("\n"),
      "utf8",
    );

    const valid = await jsonCli(fixture, ["validate"]);
    expect(valid.exitCode).toBe(0);
    expect(valid.stderr).toBe("");
    expect(valid.json).toMatchObject({
      ok: true,
      data: {
        area: "product",
        projects: { count: 2 },
        resources: { count: 6 },
        tasks: { count: 3 },
      },
    });

    await writeFile(
      path.join(fixture.areaRoot, "projects", "mobile.md"),
      [
        "---",
        "status: active",
        "repositories:",
        "  - api",
        "---",
        "",
        "# Mobile launch",
        "",
        "Outcome: The mobile experience is released.",
        "",
      ].join("\n"),
      "utf8",
    );
    const invalid = await jsonCli(fixture, ["validate"]);
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stderr).toBe("");
    expect(invalid.json).toMatchObject({
      ok: false,
      error: { code: "project_repository_mismatch" },
    });

    await writeFile(
      taskPath,
      [
        "---",
        "status: todo",
        "project: mobile",
        "repository: api",
        "---",
        "",
        "# Prepare the mobile launch",
        "",
        "Verify the mobile release.",
        "",
      ].join("\n"),
      "utf8",
    );
    expect((await jsonCli(fixture, ["validate"])).json.ok).toBe(true);
  });

  test("rejects an unknown command", async () => {
    const fixture = await setup();
    const result = await jsonCli(fixture, ["unknown"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.json).toMatchObject({
      ok: false,
      error: { code: "unknown_command" },
    });
  });

  test("reports free-form conventions as validation warnings", async () => {
    const fixture = await setup();
    await writeFile(
      path.join(fixture.areaRoot, "resources", "warning.md"),
      [
        "---",
        "state: dormant",
        "---",
        "",
        "No heading, with a [missing document](missing.md).",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await jsonCli(fixture, ["validate"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.json.ok).toBe(true);
    expect(result.json.data?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("unknown Resource state 'dormant'"),
        expect.stringContaining("unresolved document link 'missing.md'"),
      ]),
    );
    // A Resource is named by its file, so no warning asks it for a heading.
    expect(result.json.data?.warnings).toEqual(
      expect.not.arrayContaining([
        expect.stringContaining("warning.md has no H1 heading"),
      ]),
    );
  });
});
