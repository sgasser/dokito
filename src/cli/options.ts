import path from "node:path";
import { type ParseArgsOptionsConfig, parseArgs } from "node:util";
import { defaultConfigPath } from "../core/config";
import { DokitoError } from "../core/error";

export interface GlobalOptions {
  json: boolean;
  help: boolean;
  version: boolean;
  cwd: string;
  configPath: string;
  positionals: string[];
  values: Map<string, string>;
  booleans: Set<string>;
  commandOptions: Set<string>;
}

/** `--cwd` is absent so `assertOptions` rejects it where it does nothing. */
const GLOBAL_OPTIONS = new Set(["json", "help", "version", "config"]);
const CLI_OPTIONS = {
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  cwd: { type: "string" },
  config: { type: "string" },
  port: { type: "string" },
  raw: { type: "boolean" },
  links: { type: "boolean" },
} as const satisfies ParseArgsOptionsConfig;

export function parseCli(argv: string[]): GlobalOptions {
  try {
    const {
      positionals,
      tokens,
      values: parsed,
    } = parseArgs({
      args: argv,
      options: CLI_OPTIONS,
      allowPositionals: true,
      strict: true,
      tokens: true,
    });
    const values = new Map<string, string>();
    const booleans = new Set<string>();
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        values.set(name, value);
      } else if (value) {
        booleans.add(name);
      }
    }
    const commandOptions = new Set(
      tokens.flatMap((token) =>
        token.kind === "option" && !GLOBAL_OPTIONS.has(token.name)
          ? [token.name]
          : [],
      ),
    );
    return {
      json: booleans.has("json"),
      help: booleans.has("help"),
      version: booleans.has("version"),
      cwd: path.resolve(values.get("cwd") ?? process.cwd()),
      configPath: defaultConfigPath(values.get("config")),
      positionals,
      values,
      booleans,
      commandOptions,
    };
  } catch (error) {
    throw new DokitoError(
      "invalid_usage",
      error instanceof Error ? error.message : "Invalid command options.",
    );
  }
}

export function assertOptions(
  options: GlobalOptions,
  allowed: readonly string[],
): void {
  const allowedOptions = new Set(allowed);
  const unexpected = [...options.commandOptions].find(
    (name) => !allowedOptions.has(name),
  );
  if (unexpected) {
    throw new DokitoError(
      "invalid_usage",
      `Option --${unexpected} is not valid for this command.`,
    );
  }
}

export function onePositional(positionals: string[], label: string): string {
  if (positionals.length !== 1 || positionals[0] === undefined) {
    throw new DokitoError("invalid_usage", `Expected one ${label}.`);
  }
  return positionals[0];
}
