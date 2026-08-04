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

describe("The listing options", () => {
  test("are refused by areas, which reads no collection", async () => {
    for (const option of [
      ["--summary"],
      ["--area", "product"],
      ["--status", "done"],
    ]) {
      await expect(
        runCli(parseCli(["--config", "/nonexistent.yaml", ...option, "areas"])),
      ).rejects.toThrow(`Option ${option[0]} is not valid for this command.`);
    }
  });

  test.each(["projects", "tasks"])(
    "reach the registry through %s",
    async (command) => {
      await expect(
        runCli(
          parseCli([
            "--config",
            "/nonexistent.yaml",
            "--summary",
            "--area",
            "product",
            command,
          ]),
        ),
      ).rejects.toMatchObject({ code: "config_not_found" });
    },
  );

  test("rejects a status the model does not define, before reading", async () => {
    await expect(
      runCli(
        parseCli([
          "--config",
          "/nonexistent.yaml",
          "--status",
          "urgent",
          "tasks",
        ]),
      ),
    ).rejects.toThrow(
      "Unknown Task status 'urgent'. Use one of: todo, in_progress, waiting, someday, done, cancelled.",
    );
    await expect(
      runCli(
        parseCli([
          "--config",
          "/nonexistent.yaml",
          "--status",
          "todo",
          "projects",
        ]),
      ),
    ).rejects.toThrow(
      "Unknown Project status 'todo'. Use one of: planned, active, done, cancelled.",
    );
  });
});

describe("The search options", () => {
  const search = (args: string[]): Promise<void> =>
    runCli(parseCli(["--config", "/nonexistent.yaml", ...args]));

  test("are refused by the commands that never search", async () => {
    for (const option of [["--all"], ["--type", "tasks"], ["--limit", "5"]]) {
      await expect(search([...option, "projects"])).rejects.toThrow(
        `Option ${option[0]} is not valid for this command.`,
      );
    }
  });

  test("do not include the listing filters", async () => {
    for (const option of [
      ["--summary"],
      ["--area", "product"],
      ["--status", "todo"],
    ]) {
      await expect(search([...option, "search", "term"])).rejects.toThrow(
        `Option ${option[0]} is not valid for this command.`,
      );
    }
  });

  test("need exactly one query that names something", async () => {
    await expect(search(["search"])).rejects.toThrow(
      "Expected one search query.",
    );
    await expect(search(["search", "a", "b"])).rejects.toThrow(
      "Expected one search query.",
    );
    await expect(search(["search", "   "])).rejects.toMatchObject({
      code: "query_empty",
    });
  });

  test("reject a type and a limit the command does not define", async () => {
    await expect(
      search(["search", "term", "--type", "resource"]),
    ).rejects.toThrow(
      "Unknown search type 'resource'. Use one of: projects, tasks, resources.",
    );
    for (const limit of [
      ["--limit", "0"],
      ["--limit=-1"],
      ["--limit", "1.5"],
      ["--limit", "many"],
    ]) {
      await expect(search(["search", "term", ...limit])).rejects.toThrow(
        "Search limit must be a whole number of at least 1.",
      );
    }
  });

  test("keep --all and --cwd apart", async () => {
    await expect(
      search(["--cwd", "/", "search", "term", "--all"]),
    ).rejects.toThrow("Options --all and --cwd cannot be combined.");
    await expect(
      search(["--cwd", "/", "search", "term"]),
    ).rejects.toMatchObject({ code: "area_not_resolved" });
  });

  test("read the named configuration file when asked for every Area", async () => {
    await expect(search(["search", "term", "--all"])).rejects.toMatchObject({
      code: "config_not_found",
    });
  });
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

  // The path resolver reads an empty value as unset, so the guard must too.
  // `DOKITO_CONFIG_PATH` is the other way to name one, and a machine that has
  // it set would otherwise fail this.
  test("counts as unnamed when the value is empty", () => {
    const named = process.env.DOKITO_CONFIG_PATH;
    delete process.env.DOKITO_CONFIG_PATH;
    try {
      expect(parseCli(["--config", "", "areas"]).configNamed).toBe(false);
      expect(parseCli(["--config", "/x.yaml", "areas"]).configNamed).toBe(true);
    } finally {
      if (named !== undefined) {
        process.env.DOKITO_CONFIG_PATH = named;
      }
    }
  });

  test("is checked after the arguments the command needs", async () => {
    await expect(
      runCli(parseCli(["--config", "/nonexistent.yaml", "resolve"])),
    ).rejects.toThrow("Expected one reference.");
    await expect(
      runCli(parseCli(["--config", "/nonexistent.yaml", "areas", "extra"])),
    ).rejects.toThrow("areas accepts no arguments.");
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
