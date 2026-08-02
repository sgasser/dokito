import { describe, expect, test } from "bun:test";
import { runCli } from "../../src/cli/commands";
import { parseCli } from "../../src/cli/options";

/**
 * `--cwd` resolves one Area, so only the commands that work on one accept it.
 * The registry listings and the Web view used to take the flag and ignore it,
 * which reads as support right up to the point a second Area is registered.
 *
 * `/` belongs to no Area, so a command that accepts the flag gets past option
 * validation and fails on scope resolution instead. Both outcomes throw before
 * anything is read or served.
 */
describe("The --cwd option", () => {
  const run = (command: string): Promise<void> =>
    runCli(parseCli(["--config", "/nonexistent.yaml", "--cwd", "/", command]));

  test.each(["areas", "projects", "tasks", "id", "web"])(
    "is refused by %s, which never resolves a single Area",
    async (command) => {
      await expect(run(command)).rejects.toThrow(
        "Option --cwd is not valid for this command.",
      );
    },
  );

  test.each(["context", "validate"])(
    "still moves %s to the named directory",
    async (command) => {
      await expect(run(command)).rejects.toThrow("No Area here: '/'");
    },
  );
});

/** Git is the second of two ways in, so its failure named the wrong subject. */
describe("Resolving no Area", () => {
  test("names Areas rather than Git, and where to look", async () => {
    await expect(
      runCli(
        parseCli(["--config", "/nonexistent.yaml", "--cwd", "/", "context"]),
      ),
    ).rejects.toMatchObject({ code: "area_not_resolved" });
  });
});

/** A missing named file used to answer with a plausible "no Areas registered". */
describe("A named configuration file", () => {
  test.each(["areas", "projects", "tasks"])(
    "must exist before %s reports an empty registry",
    async (command) => {
      await expect(
        runCli(parseCli(["--config", "/nonexistent.yaml", command])),
      ).rejects.toMatchObject({ code: "config_not_found" });
    },
  );

  test("is still created by register", async () => {
    // register writes the file, so a missing one is the normal first run.
    await expect(
      runCli(parseCli(["--config", "/nonexistent.yaml", "register", "/tmp"])),
    ).rejects.toMatchObject({ code: "area_manifest_not_found" });
  });
});

describe("Dokito Web subcommands", () => {
  test("status and stop reject the start-only port option", async () => {
    for (const command of ["status", "stop"]) {
      await expect(
        runCli(parseCli(["web", command, "--port", "4190"])),
      ).rejects.toThrow("Option --port is not valid for this command.");
    }
  });

  test("rejects unknown and extra web subcommands", async () => {
    await expect(runCli(parseCli(["web", "restart"]))).rejects.toThrow(
      "Unknown web command: restart",
    );
    await expect(runCli(parseCli(["web", "start", "again"]))).rejects.toThrow(
      "web start accepts no additional arguments.",
    );
  });
});
