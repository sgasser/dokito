import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { listRegisteredTasks } from "../../src/core/inventory";
import { validateArea } from "../../src/core/validate";
import { createWebRequestHandler } from "../../src/web/server";
import {
  createTestWorkspace,
  registerTestArea,
  type TestWorkspace,
} from "../helpers";

/**
 * The promise this suite exists to hold, stated in docs/SPEC.md: one malformed
 * file never hides the work around it. A document Dokito cannot read is the
 * problem of that file, and every other document in the Area stays readable.
 *
 * These read through the commands people actually run rather than the loader
 * signature, so they keep their meaning if the internals move again.
 */
describe("One unreadable document", () => {
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

  async function rewrite(
    fixture: TestWorkspace,
    relativePath: string,
    from: string,
    to: string,
  ): Promise<void> {
    const target = path.join(fixture.areaRoot, relativePath);
    await writeFile(
      target,
      (await readFile(target, "utf8")).replace(from, to),
      "utf8",
    );
  }

  const titles = (result: { tasks: { title: string }[] }) =>
    result.tasks.map((task) => task.title).sort();

  test("keeps the other Tasks when one Task file is malformed", async () => {
    const fixture = await setup();
    const broken = "tasks/01K1ABDXYZ0000000000000000-revise-privacy-notice.md";
    await rewrite(fixture, broken, "status: todo", "status: todoo");

    const result = await listRegisteredTasks({
      configPath: fixture.configPath,
    });

    expect(titles(result)).toEqual(["Coordinate the product launch"]);
    expect(result.warnings.join("\n")).toContain(broken);
  });

  test("keeps every Task when their Project file is malformed", async () => {
    const fixture = await setup();
    await rewrite(
      fixture,
      "projects/launch.md",
      "status: active",
      "status: activ",
    );

    const result = await listRegisteredTasks({
      configPath: fixture.configPath,
    });

    // A Task is never dropped for a relation. Its own file is readable, and
    // the Project is what failed.
    expect(titles(result)).toEqual([
      "Coordinate the product launch",
      "Revise the privacy notice",
    ]);
    // One broken file, one report, naming the file that is actually broken.
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("projects/launch.md");
    expect(result.warnings.join("\n")).not.toContain("does not exist");
  });

  test("keeps a Task whose Project is genuinely absent, and says so", async () => {
    const fixture = await setup();
    await rewrite(
      fixture,
      "tasks/01K1ABCXYZ0000000000000000-coordinate-launch.md",
      "project: launch",
      "project: ghost",
    );

    const result = await listRegisteredTasks({
      configPath: fixture.configPath,
    });

    expect(titles(result)).toContain("Coordinate the product launch");
    expect(result.warnings.join("\n")).toContain("projects/ghost.md");
  });

  test("a directory beside a healthy Project does not drop that Project's Tasks", async () => {
    const fixture = await setup();
    await mkdir(path.join(fixture.areaRoot, "projects", "launch"));

    const result = await listRegisteredTasks({
      configPath: fixture.configPath,
    });

    // The directory is rejected by name. `launch` itself loaded fine, so
    // nothing that points at it may disappear.
    expect(titles(result)).toEqual([
      "Coordinate the product launch",
      "Revise the privacy notice",
    ]);
  });

  test("a Task without an H1 cannot take the ID of a valid twin", async () => {
    const fixture = await setup();
    const id = "01K1ABEXYZ0000000000000000";
    const body = await readFile(
      path.join(
        fixture.areaRoot,
        "tasks",
        "01K1ABCXYZ0000000000000000-coordinate-launch.md",
      ),
      "utf8",
    );
    // Sorts first, so it reaches the ID before the valid one, and fails on a
    // check that runs late: the heading rather than the frontmatter.
    await writeFile(
      path.join(fixture.areaRoot, "tasks", `${id}-aaa-no-heading.md`),
      body.replace(/^# .*$/m, "No heading here."),
      "utf8",
    );
    await writeFile(
      path.join(fixture.areaRoot, "tasks", `${id}-zzz-valid.md`),
      body,
      "utf8",
    );

    const result = await listRegisteredTasks({
      configPath: fixture.configPath,
    });

    expect(
      result.tasks.filter((task) => task.id === id).map((t) => t.relativePath),
    ).toEqual([`tasks/${id}-zzz-valid.md`]);
    expect(result.warnings.join("\n")).toContain(`${id}-aaa-no-heading.md`);
  });

  test("keeps the other Tasks when the disk refuses one file", async () => {
    const fixture = await setup();
    const broken = "tasks/01K1ABDXYZ0000000000000000-revise-privacy-notice.md";
    const target = path.join(fixture.areaRoot, broken);
    await chmod(target, 0o000);

    const result = await listRegisteredTasks({
      configPath: fixture.configPath,
    });
    await chmod(target, 0o644);

    // A file the operating system refuses is a fact about that file. Treating
    // it as a failure of the whole Area would hide the readable work behind
    // one permission bit.
    expect(titles(result)).toEqual(["Coordinate the product launch"]);
    expect(result.warnings.join("\n")).toContain(broken);
  });

  test("a Task kept with an unusable reference is not called skipped", async () => {
    const fixture = await setup();
    await rewrite(
      fixture,
      "tasks/01K1ABCXYZ0000000000000000-coordinate-launch.md",
      "project: launch",
      "project: ghost",
    );

    const result = await listRegisteredTasks({
      configPath: fixture.configPath,
    });

    // The Task is on screen, so a warning calling it skipped would contradict
    // the list beside it.
    expect(titles(result)).toContain("Coordinate the product launch");
    expect(result.warnings.join("\n")).toContain("Unresolved reference in");
    expect(result.warnings.join("\n")).not.toContain(
      "Skipped tasks/01K1ABCXYZ",
    );
  });

  test("a directory named like a Project does not double-report its Tasks", async () => {
    const fixture = await setup();
    await mkdir(path.join(fixture.areaRoot, "projects", "ghost.md"));
    await rewrite(
      fixture,
      "tasks/01K1ABCXYZ0000000000000000-coordinate-launch.md",
      "project: launch",
      "project: ghost",
    );

    const result = await listRegisteredTasks({
      configPath: fixture.configPath,
    });

    // The directory already carries the report. Repeating it against the Task
    // would claim projects/ghost.md does not exist while it sits right there.
    expect(result.warnings.join("\n")).not.toContain("does not exist");
  });

  test("validate still rejects a malformed document", async () => {
    const fixture = await setup();
    await rewrite(
      fixture,
      "projects/launch.md",
      "status: active",
      "status: activ",
    );

    await expect(
      validateArea({
        cwd: fixture.areaRoot,
        configPath: fixture.configPath,
      }),
    ).rejects.toMatchObject({ code: "project_invalid" });
  });

  test("every Web screen names the skipped document", async () => {
    const fixture = await setup();
    const broken = "tasks/01K1ABDXYZ0000000000000000-revise-privacy-notice.md";
    await rewrite(fixture, broken, "status: todo", "status: todoo");

    const handler = createWebRequestHandler({
      configPath: fixture.configPath,
    });
    for (const address of ["/focus", "/area/product/tasks"]) {
      const html = await (
        await handler(new Request(`http://127.0.0.1${address}`))
      ).text();

      expect(html).toContain("revise-privacy-notice.md");
      expect(html).toContain("Coordinate the product launch");
    }
  });
});
