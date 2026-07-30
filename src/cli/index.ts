#!/usr/bin/env bun

import { normalizeError } from "../core/error";
import { runCli } from "./commands";
import { type GlobalOptions, parseCli } from "./options";
import { printJson } from "./output";

const rawArguments = Bun.argv.slice(2);
let global: GlobalOptions | undefined;

try {
  global = parseCli(rawArguments);
  await runCli(global);
} catch (error) {
  const normalized = normalizeError(error);
  if (global?.json ?? rawArguments.includes("--json")) {
    printJson({
      ok: false,
      error: {
        code: normalized.code,
        message: normalized.message,
        ...(normalized.details ? { details: normalized.details } : {}),
      },
    });
  } else {
    process.stderr.write(`Error [${normalized.code}]: ${normalized.message}\n`);
  }
  process.exitCode = 1;
}
