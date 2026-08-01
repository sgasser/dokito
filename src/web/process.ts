import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DokitoError } from "../core/error";
import { writeTextAtomic } from "../core/files";
import { readWebHealth, webInstanceId } from "./server";

const WEB_HOSTNAME = "127.0.0.1";
const START_TIMEOUT_MS = 5_000;
const STOP_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 50;
const LOCK_TIMEOUT_MS = 10_000;
const RUNTIME_ID_ENV = "DOKITO_INTERNAL_WEB_RUNTIME_ID";

interface WebRuntimeState {
  pid: number;
  port: number;
  instanceId: string;
  runtimeId: string;
  startedAt: string;
  logPath: string;
}

export function webRuntimePaths(configPath: string) {
  const resolved = path.resolve(configPath);
  return {
    statePath: `${resolved}.web.json`,
    lockPath: `${resolved}.web.lock`,
    logPath: `${resolved}.web.log`,
  };
}

function parseRuntimeState(
  value: unknown,
  configPath: string,
): WebRuntimeState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const state = value as Record<string, unknown>;
  if (
    typeof state.pid !== "number" ||
    !Number.isInteger(state.pid) ||
    state.pid <= 0 ||
    typeof state.port !== "number" ||
    !Number.isInteger(state.port) ||
    state.port < 1 ||
    state.port > 65_535 ||
    state.instanceId !== webInstanceId(configPath) ||
    typeof state.runtimeId !== "string" ||
    state.runtimeId.length === 0 ||
    typeof state.startedAt !== "string" ||
    Number.isNaN(Date.parse(state.startedAt)) ||
    state.logPath !== webRuntimePaths(configPath).logPath
  ) {
    return null;
  }
  return {
    pid: state.pid,
    port: state.port,
    instanceId: state.instanceId,
    runtimeId: state.runtimeId,
    startedAt: state.startedAt,
    logPath: state.logPath,
  };
}

async function readRuntimeState(
  configPath: string,
): Promise<WebRuntimeState | null> {
  const { statePath } = webRuntimePaths(configPath);
  let contents: string;
  try {
    contents = await readFile(statePath, "utf8");
  } catch (error) {
    const cause = (error as NodeJS.ErrnoException).code;
    if (cause === "ENOENT") {
      return null;
    }
    throw new DokitoError(
      "web_state_unavailable",
      `Could not read Dokito Web state at ${statePath}.`,
      { statePath, ...(cause ? { cause } : {}) },
    );
  }
  try {
    const value: unknown = JSON.parse(contents);
    const state = parseRuntimeState(value, configPath);
    if (state) {
      return state;
    }
  } catch {
    // Invalid runtime state is stale local metadata, never authoritative.
  }
  await removeRuntimeState(configPath);
  return null;
}

async function removeRuntimeState(configPath: string): Promise<void> {
  const { statePath } = webRuntimePaths(configPath);
  try {
    await rm(statePath, { force: true });
  } catch (error) {
    throw new DokitoError(
      "web_state_unavailable",
      `Could not remove Dokito Web state at ${statePath}.`,
      {
        statePath,
        cause: (error as NodeJS.ErrnoException).code ?? String(error),
      },
    );
  }
}

type WebHealthResult = Awaited<ReturnType<typeof readWebHealth>>;

function healthMatchesState(
  health: WebHealthResult,
  state: WebRuntimeState,
): boolean {
  return (
    health?.instanceId === state.instanceId &&
    health.runtimeId === state.runtimeId &&
    health.pid === state.pid
  );
}

function runningStatus(state: WebRuntimeState) {
  return {
    ...state,
    running: true as const,
    hostname: WEB_HOSTNAME,
    url: `http://${WEB_HOSTNAME}:${state.port}/`,
  };
}

async function verifiedStatus(configPath: string) {
  const state = await readRuntimeState(configPath);
  if (!state) {
    return null;
  }
  const health = await readWebHealth(WEB_HOSTNAME, state.port);
  if (!healthMatchesState(health, state)) {
    if (processIsRunning(state.pid)) {
      const { statePath } = webRuntimePaths(configPath);
      throw new DokitoError(
        "web_runtime_unverified",
        `Could not verify Dokito Web while process ${state.pid} is still running.`,
        {
          pid: state.pid,
          port: state.port,
          statePath,
          logPath: state.logPath,
        },
      );
    }
    await removeRuntimeState(configPath);
    return null;
  }
  return runningStatus(state);
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function withRuntimeLock<T>(
  configPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const { lockPath } = webRuntimePaths(configPath);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  const owner = `${process.pid}:${randomUUID()}`;
  await mkdir(path.dirname(lockPath), { recursive: true });
  while (true) {
    try {
      await writeFile(lockPath, owner, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        let current: string;
        try {
          current = await readFile(lockPath, "utf8");
        } catch (readError) {
          const cause = (readError as NodeJS.ErrnoException).code;
          if (cause === "ENOENT") {
            continue;
          }
          throw new DokitoError(
            "web_state_unavailable",
            `Could not read Dokito Web lock at ${lockPath}.`,
            { lockPath, ...(cause ? { cause } : {}) },
          );
        }
        const ownerPid = Number.parseInt(current.split(":", 1)[0] ?? "", 10);
        if (!Number.isInteger(ownerPid) || !processIsRunning(ownerPid)) {
          await delay(POLL_INTERVAL_MS);
          if (
            (await readFile(lockPath, "utf8").catch(() => null)) === current
          ) {
            throw new DokitoError(
              "web_state_locked",
              `Dokito Web state is locked by a process that is no longer running. Remove ${lockPath} and retry.`,
              { lockPath, ...(Number.isInteger(ownerPid) ? { ownerPid } : {}) },
            );
          }
          continue;
        }
        if (Date.now() < deadline) {
          await delay(POLL_INTERVAL_MS);
          continue;
        }
        throw new DokitoError(
          "web_state_locked",
          `Timed out waiting for Dokito Web state at ${lockPath}.`,
          { lockPath, ownerPid },
        );
      }
      throw new DokitoError(
        "web_state_unavailable",
        `Could not lock Dokito Web state at ${lockPath}.`,
        {
          lockPath,
          cause: (error as NodeJS.ErrnoException).code ?? String(error),
        },
      );
    }
  }
  try {
    return await operation();
  } finally {
    if ((await readFile(lockPath, "utf8").catch(() => null)) === owner) {
      await rm(lockPath, { force: true });
    }
  }
}

async function runtimeParentExists(configPath: string): Promise<boolean> {
  const parent = path.dirname(webRuntimePaths(configPath).lockPath);
  try {
    await lstat(parent);
    return true;
  } catch (error) {
    const cause = (error as NodeJS.ErrnoException).code;
    if (cause === "ENOENT") {
      return false;
    }
    throw new DokitoError(
      "web_state_unavailable",
      `Could not access Dokito Web state directory at ${parent}.`,
      { path: parent, ...(cause ? { cause } : {}) },
    );
  }
}

function currentDokitoCommand(): string[] {
  return Bun.main.startsWith("/$bunfs/")
    ? [process.execPath]
    : [process.execPath, Bun.main];
}

async function prepareLog(
  logPath: string,
): Promise<Awaited<ReturnType<typeof open>>> {
  await mkdir(path.dirname(logPath), { recursive: true });
  try {
    return await open(
      logPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_TRUNC |
        constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new DokitoError(
        "symlink_not_allowed",
        `Cannot write through a symlink: ${logPath}`,
        { path: logPath },
      );
    }
    throw error;
  }
}

export function childWebRuntime(): string | null {
  return process.env[RUNTIME_ID_ENV] ?? null;
}

export async function writeChildWebRuntimeState(
  configPath: string,
  port: number,
  runtimeId: string,
): Promise<void> {
  const state: WebRuntimeState = {
    pid: process.pid,
    port,
    instanceId: webInstanceId(configPath),
    runtimeId,
    startedAt: new Date().toISOString(),
    logPath: webRuntimePaths(configPath).logPath,
  };
  await writeTextAtomic(
    webRuntimePaths(configPath).statePath,
    `${JSON.stringify(state, null, 2)}\n`,
  );
}

export async function webStatus(configPath: string) {
  const stopped = stoppedWebStatus(configPath);
  if (!(await runtimeParentExists(configPath))) {
    return stopped;
  }
  return withRuntimeLock(configPath, async () => {
    return (await verifiedStatus(configPath)) ?? stopped;
  });
}

function stoppedWebStatus(configPath: string) {
  return {
    running: false as const,
    logPath: webRuntimePaths(configPath).logPath,
  };
}

async function stopSpawnedChild(child: Bun.Subprocess): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([child.exited, delay(1_000)]);
}

export async function startWebBackground(configPath: string, port?: number) {
  return withRuntimeLock(configPath, async () => {
    const existing = await verifiedStatus(configPath);
    if (existing) {
      return { ...existing, reused: true };
    }

    const { logPath } = webRuntimePaths(configPath);
    const log = await prepareLog(logPath);
    const runtimeId = randomUUID();
    const command = [
      ...currentDokitoCommand(),
      "--config",
      path.resolve(configPath),
      "web",
      ...(port === undefined ? [] : ["--port", String(port)]),
    ];
    let child: Bun.Subprocess;
    try {
      child = Bun.spawn(command, {
        detached: true,
        env: {
          ...process.env,
          [RUNTIME_ID_ENV]: runtimeId,
        },
        stdin: "ignore",
        stdout: log.fd,
        stderr: log.fd,
      });
      child.unref();
    } finally {
      await log.close();
    }

    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const state = await readRuntimeState(configPath);
      if (state?.pid === child.pid && state.runtimeId === runtimeId) {
        if (
          healthMatchesState(
            await readWebHealth(WEB_HOSTNAME, state.port),
            state,
          )
        ) {
          return { ...runningStatus(state), reused: false };
        }
      }
      if (child.exitCode !== null) {
        break;
      }
      await delay(POLL_INTERVAL_MS);
    }

    await stopSpawnedChild(child);
    await removeRuntimeState(configPath);
    throw new DokitoError(
      "web_start_failed",
      `Could not start Dokito Web. See the log at ${logPath}.`,
      { logPath, ...(port === undefined ? {} : { port }) },
    );
  });
}

export async function stopWebBackground(configPath: string) {
  const stopped = {
    ...stoppedWebStatus(configPath),
    stopped: false as const,
  };
  if (!(await runtimeParentExists(configPath))) {
    return stopped;
  }
  return withRuntimeLock(configPath, async () => {
    const running = await verifiedStatus(configPath);
    if (!running) {
      return stopped;
    }
    const { logPath } = running;

    try {
      process.kill(running.pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        throw error;
      }
      await removeRuntimeState(configPath);
      return { running: false, stopped: true, logPath };
    }
    const deadline = Date.now() + STOP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!processIsRunning(running.pid)) {
        await removeRuntimeState(configPath);
        return { running: false, stopped: true, logPath };
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new DokitoError(
      "web_stop_failed",
      `Dokito Web did not stop within ${STOP_TIMEOUT_MS / 1_000} seconds.`,
      { pid: running.pid, logPath },
    );
  });
}
