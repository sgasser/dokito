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
      await expect(run(command)).rejects.toThrow(
        "The current directory is not inside a Git worktree.",
      );
    },
  );
});
