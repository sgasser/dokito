import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { webRuntimePaths } from "../../src/web/process";
import { webInstanceId } from "../../src/web/server";
import { dokitoCli } from "../helpers";

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const roots: string[] = [];

async function tempConfig(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "dokito-web-test-"));
  roots.push(root);
  return path.join(root, "config.yaml");
}

async function cli(configPath: string, args: string[]): Promise<CliResult> {
  const binary = process.env.DOKITO_TEST_BINARY;
  const command = binary
    ? [path.resolve(binary)]
    : [process.execPath, dokitoCli];
  const subprocess = Bun.spawn(
    [...command, "--json", "--config", configPath, "web", ...args],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

function data(result: CliResult): Record<string, unknown> {
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const parsed = JSON.parse(result.stdout) as {
    ok: boolean;
    data: Record<string, unknown>;
  };
  expect(parsed.ok).toBeTrue();
  return parsed.data;
}

function errorData(result: CliResult): Record<string, unknown> {
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe("");
  const parsed = JSON.parse(result.stdout) as {
    ok: boolean;
    error: Record<string, unknown>;
  };
  expect(parsed.ok).toBeFalse();
  return parsed.error;
}

function availablePort(): number {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("reserved"),
  });
  const port = server.port;
  server.stop(true);
  if (port === undefined) {
    throw new Error("Bun did not assign a test port.");
  }
  return port;
}

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") {
        return;
      }
      throw error;
    }
    await Bun.sleep(25);
  }
  throw new Error(`Process ${pid} did not exit.`);
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    const configPath = path.join(root, "config.yaml");
    await cli(configPath, ["stop"]).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

describe("managed Dokito Web processes", () => {
  test("start remains alive, is idempotent, reports status, and stops", async () => {
    const configPath = await tempConfig();
    const port = availablePort();

    const started = data(
      await cli(configPath, ["start", "--port", String(port)]),
    );
    expect(started).toMatchObject({
      running: true,
      reused: false,
      port,
      hostname: "127.0.0.1",
      url: `http://127.0.0.1:${port}/`,
    });
    expect(typeof started.pid).toBe("number");
    expect(typeof started.runtimeId).toBe("string");
    expect(typeof started.startedAt).toBe("string");
    expect(typeof started.logPath).toBe("string");

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(await health.json()).toMatchObject({
      service: "dokito-web",
      instanceId: webInstanceId(configPath),
      runtimeId: started.runtimeId,
      pid: started.pid,
    });

    const status = data(await cli(configPath, ["status"]));
    expect(status).toMatchObject({
      running: true,
      pid: started.pid,
      port,
      logPath: started.logPath,
    });

    const paths = webRuntimePaths(configPath);
    const state = JSON.parse(await readFile(paths.statePath, "utf8")) as Record<
      string,
      unknown
    >;
    await writeFile(
      paths.statePath,
      JSON.stringify({ ...state, futureField: "ignored" }),
      "utf8",
    );
    const forwardCompatible = data(await cli(configPath, ["status"]));
    expect(forwardCompatible).toMatchObject({
      running: true,
      pid: started.pid,
    });
    expect(forwardCompatible.futureField).toBeUndefined();

    const repeated = data(
      await cli(configPath, ["start", "--port", String(availablePort())]),
    );
    expect(repeated).toMatchObject({
      running: true,
      reused: true,
      pid: started.pid,
      port,
    });

    expect(data(await cli(configPath, ["stop"]))).toMatchObject({
      running: false,
      stopped: true,
      logPath: started.logPath,
    });
    expect(data(await cli(configPath, ["status"]))).toMatchObject({
      running: false,
      logPath: started.logPath,
    });
    expect(data(await cli(configPath, ["stop"]))).toMatchObject({
      running: false,
      stopped: false,
    });
  });

  test("serializes concurrent starts into one managed process", async () => {
    const configPath = await tempConfig();
    const port = availablePort();

    const results = await Promise.all([
      cli(configPath, ["start", "--port", String(port)]),
      cli(configPath, ["start", "--port", String(port)]),
    ]);
    const starts = results.map(data);

    expect(new Set(starts.map((start) => start.pid)).size).toBe(1);
    expect(starts.filter((start) => start.reused === false)).toHaveLength(1);
    expect(starts.filter((start) => start.reused === true)).toHaveLength(1);
  });

  test("cleans a crashed process and starts a fresh runtime", async () => {
    const configPath = await tempConfig();
    const port = availablePort();
    const started = data(
      await cli(configPath, ["start", "--port", String(port)]),
    );

    process.kill(started.pid as number, "SIGKILL");
    await waitForProcessExit(started.pid as number);

    expect(data(await cli(configPath, ["status"]))).toMatchObject({
      running: false,
    });
    const restarted = data(
      await cli(configPath, ["start", "--port", String(port)]),
    );
    expect(restarted).toMatchObject({ running: true, reused: false, port });
    expect(restarted.pid).not.toBe(started.pid);
    expect(restarted.runtimeId).not.toBe(started.runtimeId);
  });

  test("status and stop do not create a missing config directory", async () => {
    const baseConfig = await tempConfig();
    const configPath = path.join(
      path.dirname(baseConfig),
      "missing",
      "config.yaml",
    );
    const parent = path.dirname(configPath);

    await expect(lstat(parent)).rejects.toThrow();
    for (const command of ["status", "stop"] as const) {
      expect(data(await cli(configPath, [command]))).toMatchObject({
        running: false,
        ...(command === "stop" ? { stopped: false } : {}),
      });
      await expect(lstat(parent)).rejects.toThrow();
    }
  });

  test("preserves live runtime state when health is temporarily unavailable", async () => {
    const configPath = await tempConfig();
    const started = data(
      await cli(configPath, ["start", "--port", String(availablePort())]),
    );
    const pid = started.pid as number;
    const statePath = webRuntimePaths(configPath).statePath;

    process.kill(pid, "SIGSTOP");
    try {
      for (const command of ["status", "start", "stop"]) {
        expect(errorData(await cli(configPath, [command]))).toMatchObject({
          code: "web_runtime_unverified",
          details: { pid, statePath },
        });
        expect(JSON.parse(await readFile(statePath, "utf8"))).toMatchObject({
          pid,
          runtimeId: started.runtimeId,
        });
      }
    } finally {
      process.kill(pid, "SIGCONT");
    }

    expect(data(await cli(configPath, ["status"]))).toMatchObject({
      running: true,
      pid,
      runtimeId: started.runtimeId,
    });
  });

  test("reports an unreadable state file instead of deleting it", async () => {
    const configPath = await tempConfig();
    const paths = webRuntimePaths(configPath);
    await writeFile(paths.statePath, "{}", "utf8");
    await chmod(paths.statePath, 0o000);
    try {
      expect(errorData(await cli(configPath, ["status"]))).toMatchObject({
        code: "web_state_unavailable",
      });
      expect(await lstat(paths.statePath)).toBeDefined();
    } finally {
      await chmod(paths.statePath, 0o600);
    }
  });

  test("reports an unreadable lock instead of waiting indefinitely", async () => {
    const configPath = await tempConfig();
    const { lockPath } = webRuntimePaths(configPath);
    await writeFile(lockPath, "99999999:stale", "utf8");
    await chmod(lockPath, 0o000);
    try {
      expect(errorData(await cli(configPath, ["status"]))).toMatchObject({
        code: "web_state_unavailable",
        details: { lockPath, cause: "EACCES" },
      });
    } finally {
      await chmod(lockPath, 0o600);
    }
  });

  test("keeps separate config instances independent", async () => {
    const firstConfig = await tempConfig();
    const secondConfig = await tempConfig();
    const firstPort = availablePort();
    let secondPort = availablePort();
    while (secondPort === firstPort) {
      secondPort = availablePort();
    }

    const first = data(
      await cli(firstConfig, ["start", "--port", String(firstPort)]),
    );
    const second = data(
      await cli(secondConfig, ["start", "--port", String(secondPort)]),
    );

    expect(first).toMatchObject({ running: true, port: firstPort });
    expect(second).toMatchObject({ running: true, port: secondPort });
    expect(first.instanceId).not.toBe(second.instanceId);
    expect(first.pid).not.toBe(second.pid);

    data(await cli(firstConfig, ["stop"]));
    expect(data(await cli(firstConfig, ["status"]))).toMatchObject({
      running: false,
    });
    expect(data(await cli(secondConfig, ["status"]))).toMatchObject({
      running: true,
      port: secondPort,
    });
  });

  test("reports an occupied port and preserves the diagnostic log", async () => {
    const configPath = await tempConfig();
    const occupied = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("another service"),
    });
    try {
      const result = await cli(configPath, [
        "start",
        "--port",
        String(occupied.port),
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      const parsed = JSON.parse(result.stdout) as {
        ok: false;
        error: {
          code: string;
          details: { logPath: string; port: number };
        };
      };
      expect(parsed).toMatchObject({
        ok: false,
        error: {
          code: "web_start_failed",
          details: { port: occupied.port },
        },
      });
      expect(await readFile(parsed.error.details.logPath, "utf8")).toContain(
        "web_start_failed",
      );
    } finally {
      occupied.stop(true);
    }
  });

  test("cleans corrupt state without signaling an unverified live process", async () => {
    const configPath = await tempConfig();
    const paths = webRuntimePaths(configPath);
    await writeFile(paths.statePath, "not json", "utf8");

    expect(data(await cli(configPath, ["status"]))).toMatchObject({
      running: false,
    });
    await expect(readFile(paths.statePath, "utf8")).rejects.toThrow();

    await writeFile(paths.lockPath, "99999999:stale", "utf8");
    expect(errorData(await cli(configPath, ["status"]))).toMatchObject({
      code: "web_state_locked",
      details: { lockPath: paths.lockPath, ownerPid: 99_999_999 },
    });
    expect(await readFile(paths.lockPath, "utf8")).toBe("99999999:stale");
    await rm(paths.lockPath);

    const foreign = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("foreign"),
    });
    try {
      await writeFile(
        paths.statePath,
        JSON.stringify({
          pid: process.pid,
          port: foreign.port,
          instanceId: webInstanceId(configPath),
          runtimeId: "stale-runtime",
          startedAt: new Date().toISOString(),
          logPath: paths.logPath,
        }),
        "utf8",
      );
      expect(errorData(await cli(configPath, ["stop"]))).toMatchObject({
        code: "web_runtime_unverified",
        details: { pid: process.pid, statePath: paths.statePath },
      });
      expect(await lstat(paths.statePath)).toBeDefined();
      expect(
        await (await fetch(`http://127.0.0.1:${foreign.port}/`)).text(),
      ).toBe("foreign");
    } finally {
      foreign.stop(true);
    }
  });
});
