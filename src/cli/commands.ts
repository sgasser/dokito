import packageJson from "../../package.json";
import { listAreas, registerExistingArea } from "../core/areas";
import { context } from "../core/context";
import { DokitoError } from "../core/error";
import { pathExists } from "../core/files";
import {
  type InventorySummary,
  listRegisteredProjects,
  listRegisteredTasks,
  summarizeRegisteredProjects,
  summarizeRegisteredTasks,
} from "../core/inventory";
import { isProjectStatus, PROJECT_STATUS_VALUES } from "../core/project-model";
import { resolveReference } from "../core/resolve";
import { isTaskStatus, TASK_STATUS_VALUES } from "../core/task-model";
import { createUlid } from "../core/ulid";
import { validateArea } from "../core/validate";
import {
  childWebRuntime,
  startWebBackground,
  stopWebBackground,
  webStatus,
  writeChildWebRuntimeState,
} from "../web/process";
import { startWebServer } from "../web/server";
import { assertOptions, type GlobalOptions, onePositional } from "./options";
import { printJson, success } from "./output";

const VERSION = packageJson.version;

function usage(): string {
  return `Dokito ${VERSION}

Usage:
  dokito [--json] [--config <path>] <command>

Commands:
  register <area-path> [--cwd <path>]
  areas
  projects [--area <id>] [--status <status>] [--summary]
  tasks [--area <id>] [--status <status>] [--summary]
  context [--raw] [--cwd <path>]
  resolve <reference> [--cwd <path>]
  validate [--links] [--cwd <path>]
  id
  web [--port <port>]
  web start [--port <port>]
  web status
  web stop

Global options:
  --json           Print structured JSON
  --config <path>  Use another local config file
  --version        Print the version
  --help           Print help

Command options:
  --cwd <path>     Resolve the Area and Repository from another directory
  --links          Resolve every link and Repository checkout
  --summary        Return counts by status and Area instead of every item
  --area <id>      Restrict a listing to one readable Area
  --status <s>     Restrict a listing to one Project or Task status

A <reference> is a filename, 'project:<id>', 'task:<ULID>' or 'repo:<id>[/path]'.
Pass the target inside the Wikilink, without '[[...]]' or '|display text'.
`;
}

function resolveHuman(
  result: Awaited<ReturnType<typeof resolveReference>>,
): string {
  return [
    `Matches: ${result.matches.length}`,
    ...result.matches.map((match) =>
      [
        `- ${match.area}`,
        match.relativePath ?? `repo:${match.repository}`,
        match.path,
        match.exists ? undefined : "(missing)",
      ]
        .filter((part) => part !== undefined)
        .join("  "),
    ),
  ].join("\n");
}

function areasHuman(result: Awaited<ReturnType<typeof listAreas>>): string {
  const areas =
    result.areas.length === 0
      ? [
          "No Areas registered.",
          "Link the bundled skill and ask your agent to create an Area, then run 'dokito register <area-path>'.",
        ]
      : [
          `Registered Areas: ${result.areas.length}`,
          ...result.areas.map((area) =>
            area.available
              ? `- ${area.id}: ${area.name}  ${area.path}  (${counted(area.repositoryCount, "Repository", "Repositories")})`
              : `- ${area.id}: unavailable  ${area.path}  [${area.error.code}] ${area.error.message}`,
          ),
        ];
  return [...areas, `Config: ${result.configPath}`].join("\n");
}

/**
 * A named file that is missing is a typed path, not an empty registry. Called
 * per command after its own options, so a usage error still comes first.
 */
async function requireNamedConfig(global: GlobalOptions): Promise<void> {
  if (global.configNamed && !(await pathExists(global.configPath))) {
    throw new DokitoError(
      "config_not_found",
      `Configuration file not found: ${global.configPath}`,
      { path: global.configPath },
    );
  }
}

/** `1 Repositories` reads as a bug in the data rather than in the sentence. */
function counted(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function details(values: Array<string | undefined>): string {
  const present = values.filter(
    (value): value is string => value !== undefined,
  );
  return present.length > 0 ? `  ${present.join("  ")}` : "";
}

function inventoryHeader(
  collection: "Projects" | "Tasks",
  count: number,
  areaCount: number,
): string {
  return `${collection}: ${count} across ${counted(areaCount, "Area", "Areas")}`;
}

function projectsHuman(
  result: Awaited<ReturnType<typeof listRegisteredProjects>>,
): string {
  return [
    inventoryHeader("Projects", result.projects.length, result.areaCount),
    ...result.projects.map(
      (project) =>
        `- [${project.status}] ${project.area}/${project.id}: ${
          project.title
        }${details([
          project.due ? `due ${project.due}` : undefined,
          project.repositories.length > 0
            ? `repositories ${project.repositories.join(", ")}`
            : undefined,
        ])}`,
    ),
  ].join("\n");
}

function tasksHuman(
  result: Awaited<ReturnType<typeof listRegisteredTasks>>,
): string {
  return [
    inventoryHeader("Tasks", result.tasks.length, result.areaCount),
    ...result.tasks.map(
      (task) =>
        `- [${task.status}] ${task.area}/${task.id}: ${task.title}${details([
          task.assignee ? `assignee ${task.assignee}` : undefined,
          task.priority ? `priority ${task.priority}` : undefined,
          task.due ? `due ${task.due}` : undefined,
          task.project ? `project ${task.project}` : undefined,
          task.repository ? `repository ${task.repository}` : undefined,
        ])}`,
    ),
  ].join("\n");
}

/** Typed at the boundary, so an unknown value never reaches a comparison. */
function listingQuery<Status extends string>(
  global: GlobalOptions,
  collection: "Project" | "Task",
  isStatus: (value: string) => value is Status,
  allowed: readonly Status[],
): { configPath: string; area?: string; status?: Status } {
  const status = global.values.get("status");
  if (status !== undefined && !isStatus(status)) {
    throw new DokitoError(
      "invalid_usage",
      `Unknown ${collection} status '${status}'. Use one of: ${allowed.join(", ")}.`,
    );
  }
  const area = global.values.get("area");
  return {
    configPath: global.configPath,
    ...(area !== undefined ? { area } : {}),
    ...(status !== undefined ? { status } : {}),
  };
}

function counts(values: Record<string, number>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key} ${value}`)
    .join(", ");
}

function summaryHuman(
  collection: "Projects" | "Tasks",
  result: InventorySummary<string>,
): string {
  const areas = counts(result.byArea);
  return [
    inventoryHeader(collection, result.total, result.areaCount),
    `Status: ${counts(result.byStatus)}`,
    ...(areas === "" ? [] : [`Areas: ${areas}`]),
  ].join("\n");
}

function contextHuman(result: Awaited<ReturnType<typeof context>>): string {
  return [
    `Area: ${result.area}  ${result.areaRoot}`,
    ...(result.repository ? [`Repository: ${result.repository}`] : []),
    `Projects: ${result.projects.count}  ${result.projects.path}`,
    `Resources: ${result.resources.count}  ${result.resources.path}`,
    `Tasks: ${result.tasks.count}  ${result.tasks.path}`,
    "",
    result.context,
  ].join("\n");
}

function writeWarnings(json: boolean, warnings: readonly string[]): void {
  if (!json) {
    for (const warning of warnings) {
      process.stderr.write(`Warning: ${warning}\n`);
    }
  }
}

function webPort(global: GlobalOptions): number | undefined {
  const portValue = global.values.get("port");
  const port = portValue === undefined ? undefined : Number(portValue);
  if (
    port !== undefined &&
    (!Number.isInteger(port) || port < 1 || port > 65_535)
  ) {
    throw new DokitoError(
      "port_invalid",
      "Web port must be an integer between 1 and 65535.",
    );
  }
  return port;
}

export async function runCli(global: GlobalOptions): Promise<void> {
  if (global.version) {
    success(global.json, { version: VERSION }, VERSION);
    return;
  }
  if (global.help) {
    process.stdout.write(usage());
    return;
  }
  if (global.positionals.length === 0) {
    process.stdout.write(usage());
    return;
  }

  const [command, ...args] = global.positionals;
  if (!command) {
    throw new DokitoError("invalid_usage", "Missing command.");
  }

  if (command === "register") {
    assertOptions(global, ["cwd"]);
    const target = onePositional(args, "Area path");
    const result = await registerExistingArea({
      cwd: global.cwd,
      target,
      configPath: global.configPath,
    });
    success(
      global.json,
      result,
      result.changed
        ? `Registered Area ${result.area} at ${result.path}`
        : `Area ${result.area} is already registered at ${result.path}`,
    );
    return;
  }

  if (command === "areas") {
    assertOptions(global, []);
    if (args.length > 0) {
      throw new DokitoError("invalid_usage", "areas accepts no arguments.");
    }
    await requireNamedConfig(global);
    const result = await listAreas({ configPath: global.configPath });
    success(global.json, result, areasHuman(result));
    writeWarnings(global.json, result.warnings);
    return;
  }

  if (command === "projects") {
    assertOptions(global, ["summary", "area", "status"]);
    if (args.length > 0) {
      throw new DokitoError("invalid_usage", "projects accepts no arguments.");
    }
    const query = listingQuery(
      global,
      "Project",
      isProjectStatus,
      PROJECT_STATUS_VALUES,
    );
    await requireNamedConfig(global);
    if (global.booleans.has("summary")) {
      const summary = await summarizeRegisteredProjects(query);
      success(global.json, summary, summaryHuman("Projects", summary));
      writeWarnings(global.json, summary.warnings);
      return;
    }
    const result = await listRegisteredProjects(query);
    success(global.json, result, projectsHuman(result));
    writeWarnings(global.json, result.warnings);
    return;
  }

  if (command === "tasks") {
    assertOptions(global, ["summary", "area", "status"]);
    if (args.length > 0) {
      throw new DokitoError("invalid_usage", "tasks accepts no arguments.");
    }
    const query = listingQuery(
      global,
      "Task",
      isTaskStatus,
      TASK_STATUS_VALUES,
    );
    await requireNamedConfig(global);
    if (global.booleans.has("summary")) {
      const summary = await summarizeRegisteredTasks(query);
      success(global.json, summary, summaryHuman("Tasks", summary));
      writeWarnings(global.json, summary.warnings);
      return;
    }
    const result = await listRegisteredTasks(query);
    success(global.json, result, tasksHuman(result));
    writeWarnings(global.json, result.warnings);
    return;
  }

  if (command === "context") {
    assertOptions(global, ["raw", "cwd"]);
    if (args.length > 0) {
      throw new DokitoError("invalid_usage", "context accepts no arguments.");
    }
    const raw = global.booleans.has("raw");
    if (raw && global.json) {
      throw new DokitoError(
        "invalid_usage",
        "Options --raw and --json cannot be combined.",
      );
    }
    const result = await context({
      cwd: global.cwd,
      configPath: global.configPath,
    });
    if (global.json) {
      printJson({ ok: true, data: result });
    } else {
      process.stdout.write(raw ? result.context : contextHuman(result));
      writeWarnings(false, result.warnings);
    }
    return;
  }

  if (command === "resolve") {
    assertOptions(global, ["cwd"]);
    const reference = onePositional(args, "reference");
    await requireNamedConfig(global);
    const result = await resolveReference({
      cwd: global.cwd,
      configPath: global.configPath,
      reference,
    });
    success(global.json, result, resolveHuman(result));
    writeWarnings(global.json, result.warnings);
    return;
  }

  if (command === "validate") {
    assertOptions(global, ["cwd", "links"]);
    if (args.length > 0) {
      throw new DokitoError("invalid_usage", "validate accepts no arguments.");
    }
    const result = await validateArea({
      cwd: global.cwd,
      configPath: global.configPath,
      links: global.booleans.has("links"),
    });
    success(
      global.json,
      result,
      [
        `Validated Area ${result.area}`,
        `  Context: ${result.context.bytes} bytes, ${result.context.state}`,
        `  Projects: ${result.projects.count}`,
        `  Resources: ${result.resources.count}`,
        `  Tasks: ${result.tasks.count}`,
      ].join("\n"),
    );
    writeWarnings(global.json, result.warnings);
    return;
  }

  if (command === "id") {
    assertOptions(global, []);
    if (args.length > 0) {
      throw new DokitoError("invalid_usage", "id accepts no arguments.");
    }
    const id = createUlid();
    success(global.json, { id }, id);
    return;
  }

  if (command === "web") {
    const subcommand = args[0];
    if (subcommand === "start") {
      assertOptions(global, ["port"]);
      if (args.length !== 1) {
        throw new DokitoError(
          "invalid_usage",
          "web start accepts no additional arguments.",
        );
      }
      const result = await startWebBackground(
        global.configPath,
        webPort(global),
      );
      success(
        global.json,
        result,
        result.reused
          ? `Dokito Web is already running at ${result.url}`
          : `Dokito Web started at ${result.url}`,
      );
      return;
    }
    if (subcommand === "status") {
      assertOptions(global, []);
      if (args.length !== 1) {
        throw new DokitoError(
          "invalid_usage",
          "web status accepts no additional arguments.",
        );
      }
      const result = await webStatus(global.configPath);
      success(
        global.json,
        result,
        result.running
          ? `Dokito Web is running at ${result.url}`
          : "Dokito Web is stopped.",
      );
      return;
    }
    if (subcommand === "stop") {
      assertOptions(global, []);
      if (args.length !== 1) {
        throw new DokitoError(
          "invalid_usage",
          "web stop accepts no additional arguments.",
        );
      }
      const result = await stopWebBackground(global.configPath);
      success(global.json, result, "Dokito Web is stopped.");
      return;
    }
    assertOptions(global, ["port"]);
    if (args.length > 0) {
      throw new DokitoError(
        "invalid_usage",
        `Unknown web command: ${subcommand}`,
      );
    }
    const port = webPort(global);
    const childRuntime = childWebRuntime();
    const server = await startWebServer({
      configPath: global.configPath,
      ...(port !== undefined ? { port } : {}),
      ...(childRuntime ? { runtimeId: childRuntime } : {}),
    });
    if (childRuntime) {
      try {
        await writeChildWebRuntimeState(
          global.configPath,
          server.port,
          childRuntime,
        );
      } catch (error) {
        server.server?.stop(true);
        throw error;
      }
    }
    const result = {
      hostname: server.hostname,
      port: server.port,
      url: server.url.toString(),
      reused: server.reused,
    };
    success(
      global.json,
      result,
      result.reused
        ? `Dokito Web is already running at ${result.url}`
        : `Dokito Web: ${result.url}`,
    );
    return;
  }

  throw new DokitoError("unknown_command", `Unknown command: ${command}`);
}
