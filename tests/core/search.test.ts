import { afterEach, describe, expect, test } from "bun:test";
import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DocumentArea } from "../../src/core/documents";
import {
  documentSearchType,
  type SearchReason,
  searchAreaDocuments,
  searchDocumentContent,
} from "../../src/core/search";
import {
  addTestArea,
  createTestWorkspace,
  dokitoCli,
  registerTestArea,
  type TestWorkspace,
} from "../helpers";

describe("Search excerpts", () => {
  test("reports where the match sits inside the snippet", () => {
    const [result] = searchDocumentContent(
      "# Note\n\nRotate the signing key.",
      "signing",
    );

    expect(result?.snippet).toBe("Rotate the signing key.");
    expect(result?.matchStart).toBe(11);
    expect(result?.matchLength).toBe(7);
    expect(
      result?.snippet.slice(
        result.matchStart,
        result.matchStart + result.matchLength,
      ),
    ).toBe("signing");
  });

  test("keeps a late match visible in a long line", () => {
    const line = `${"filler word ".repeat(60)}needle at the very end.`;
    const [result] = searchDocumentContent(`# Long\n\n${line}`, "needle");

    expect(result).toBeDefined();
    expect(result?.snippet.length).toBeLessThanOrEqual(242);
    expect(result?.snippet).toStartWith("…");
    expect(
      result?.snippet.slice(
        result.matchStart,
        result.matchStart + result.matchLength,
      ),
    ).toBe("needle");
  });

  test("matches across collapsed whitespace", () => {
    const [result] = searchDocumentContent(
      "# Spaced\n\nThe   privacy    notice is revised.",
      "privacy notice",
    );

    expect(result?.snippet).toBe("The privacy notice is revised.");
    expect(
      result?.snippet.slice(
        result.matchStart,
        result.matchStart + result.matchLength,
      ),
    ).toBe("privacy notice");
  });

  test("reads a snippet as prose, not as raw Markup", () => {
    const results = searchDocumentContent(
      "# Rotate the signing key\n\n- rotate the backup key too",
      "rotate",
    );

    expect(results.map((result) => result.snippet)).toEqual([
      "Rotate the signing key",
      "rotate the backup key too",
    ]);
    expect(results[0]?.matchStart).toBe(0);
  });

  test("returns every matching line by default", () => {
    const results = searchDocumentContent(
      "# Repeat\n\nkeyword once.\n\nkeyword twice.",
      "keyword",
    );

    expect(results.map((result) => result.line)).toEqual([3, 5]);
  });

  test("returns one result per document when asked", () => {
    const results = searchDocumentContent(
      "# Repeat\n\nkeyword once.\n\nkeyword twice.",
      "keyword",
      true,
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.line).toBe(3);
  });

  /** A hit in a heading is a different kind of hit, so it says so. */
  test("says whether the match sits in a heading", () => {
    const [heading] = searchDocumentContent(
      "# Note\n\n## Rotation\n\nThe body says nothing.",
      "rotation",
      true,
    );
    const [prose] = searchDocumentContent(
      "# Note\n\n## Rotation\n\nRotation is documented here.",
      "rotation",
      true,
    );

    expect(heading?.heading).toBeTrue();
    expect(prose?.heading).toBeUndefined();
    expect(prose?.line).toBe(5);
  });
});

/** The order the CLI reads a whole result in; the Web states its own. */
const CLI_ORDER: readonly SearchReason[] = [
  "filename",
  "title",
  "heading",
  "content",
];

describe("Searching Area documents", () => {
  let workspace: TestWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
  });

  async function setup(): Promise<{
    fixture: TestWorkspace;
    product: DocumentArea;
    writing: DocumentArea;
  }> {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    const writingRoot = await addTestArea(workspace);
    return {
      fixture: workspace,
      product: { id: "product", name: "Product", root: workspace.areaRoot },
      writing: { id: "writing", name: "Writing", root: writingRoot },
    };
  }

  const search = (areas: DocumentArea[], query: string, type?: "tasks") =>
    searchAreaDocuments({
      areas,
      query,
      ...(type ? { type } : {}),
      reasonOrder: CLI_ORDER,
    });

  /**
   * The core has no default scope. An Area the caller did not name is not
   * read at all, which is what lets one command answer for one Area and
   * another for the whole registry.
   */
  test("reads exactly the Areas the caller names", async () => {
    const { product, writing } = await setup();

    const inProduct = await search([product], "essay");
    const inWriting = await search([writing], "essay");
    const inBoth = await search([product, writing], "essay");

    expect(inProduct.hits).toEqual([]);
    expect(inWriting.hits.length).toBeGreaterThan(0);
    expect(inBoth.hits).toEqual(inWriting.hits);
  });

  test("ranks by the order the surface passes, not by one of its own", async () => {
    const { product } = await setup();

    const forAgents = await search([product], "launch");
    const reversed = await searchAreaDocuments({
      areas: [product],
      query: "launch",
      reasonOrder: [...CLI_ORDER].reverse(),
    });

    expect(forAgents.hits.map((hit) => hit.relativePath)).toEqual([
      "projects/launch.md",
      "tasks/01K1ABCXYZ0000000000000000-coordinate-launch.md",
      "context.md",
    ]);
    expect(forAgents.hits.map((hit) => hit.reason)).toEqual([
      "filename",
      "filename",
      "content",
    ]);
    expect(reversed.hits[0]?.relativePath).toBe("context.md");
  });

  /**
   * The reasons carry no status, so a Task that happens to be running cannot
   * outrank the document the query actually names. Within one reason it does.
   */
  test("breaks a tie on the work that is under way", async () => {
    const { fixture, product } = await setup();
    const tasks = path.join(fixture.areaRoot, "tasks");
    await writeFile(
      path.join(tasks, "01K1ZA00000000000000000000-alpha-beta.md"),
      "---\nstatus: todo\n---\n\n# Alpha\n\nWaiting.\n",
      "utf8",
    );
    await writeFile(
      path.join(tasks, "01K1ZB00000000000000000000-zulu-beta.md"),
      "---\nstatus: in_progress\n---\n\n# Zulu\n\nUnder way.\n",
      "utf8",
    );

    const result = await search([product], "beta");

    expect(result.hits.map((hit) => hit.title)).toEqual(["Zulu", "Alpha"]);
    expect(result.hits.map((hit) => hit.reason)).toEqual([
      "filename",
      "filename",
    ]);
    expect(result.hits[0]?.status).toBe("in_progress");
  });

  /**
   * A Task is filed under a ULID and a slug, so its name is often the only
   * place the words appear. Repeating the title as the snippet would spend the
   * line on words the caller has just read.
   */
  test("answers a name match with what the document opens with", async () => {
    const { product } = await setup();

    const result = await search([product], "privacy");

    expect(result.hits).toEqual([
      {
        area: "product",
        kind: "task",
        title: "Revise the privacy notice",
        relativePath:
          "tasks/01K1ABDXYZ0000000000000000-revise-privacy-notice.md",
        status: "todo",
        line: 0,
        snippet: "Explain which customer data the Web app sends to the API.",
        reason: "filename",
      },
    ]);
  });

  test("keeps one hit per document and narrows to one type", async () => {
    const { product, writing } = await setup();

    const everything = await search([product, writing], "the");
    const tasksOnly = await search([product, writing], "the", "tasks");
    const identities = everything.hits.map(
      (hit) => `${hit.area}/${hit.relativePath}`,
    );

    expect(new Set(identities).size).toBe(identities.length);
    expect(tasksOnly.hits.length).toBeGreaterThan(0);
    expect(
      tasksOnly.hits.every((hit) => documentSearchType(hit.kind) === "tasks"),
    ).toBeTrue();
    expect(tasksOnly.hits.length).toBeLessThan(everything.hits.length);
  });

  /**
   * The same promise every other command makes: one file Dokito cannot read is
   * that file's problem, and the Area stays searchable around it.
   */
  test("names a document it could not read and keeps the rest", async () => {
    const { fixture, product } = await setup();
    const refused = path.join(fixture.areaRoot, "resources", "product.md");
    await chmod(refused, 0o000);
    const result = await search([product], "product");
    await chmod(refused, 0o644);

    expect(
      result.hits.some((hit) => hit.relativePath === "resources/product.md"),
    ).toBeFalse();
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.warnings).toEqual([
      "Skipped resources/product.md in Area 'product': the file is unreadable.",
    ]);
  });

  /**
   * `areaCount` means the same thing here as on every listing: the Areas that
   * were read. Counting the scope instead would report a number the answer
   * does not stand on.
   */
  test("leaves an Area it could not read out of the count", async () => {
    const { fixture, product, writing } = await setup();
    const closed = path.join(fixture.areaRoot, "resources");
    await chmod(closed, 0o000);
    const result = await search([product, writing], "essay");
    await chmod(closed, 0o755);

    expect(result.areaCount).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toStartWith("Skipped Area 'product':");
    // The Area that was readable still answers.
    expect(result.hits.every((hit) => hit.area === "writing")).toBeTrue();

    await expect(search([product, writing], "essay")).resolves.toMatchObject({
      areaCount: 2,
      warnings: [],
    });
  });

  test("refuses a query that names nothing before it reads a file", async () => {
    const { product } = await setup();

    await expect(search([product], "   ")).rejects.toMatchObject({
      code: "query_empty",
    });
  });
});

describe("The search command", () => {
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
    await addTestArea(workspace);
    return workspace;
  }

  async function runCommand(
    fixture: TestWorkspace,
    cwd: string,
    args: string[],
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const child = Bun.spawn(
      ["bun", "run", dokitoCli, "--config", fixture.configPath, ...args],
      { cwd, stdout: "pipe", stderr: "pipe" },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { exitCode, stdout, stderr };
  }

  test("defaults to the Area the caller is standing in", async () => {
    const fixture = await setup();

    const scoped = await runCommand(fixture, fixture.areaRoot, [
      "search",
      "essay",
    ]);
    const everywhere = await runCommand(fixture, fixture.areaRoot, [
      "search",
      "essay",
      "--all",
    ]);
    const unscoped = await runCommand(fixture, fixture.root, [
      "search",
      "essay",
    ]);

    expect(scoped.exitCode).toBe(0);
    expect(scoped.stdout.trim()).toBe("Matches: 0");
    expect(everywhere.exitCode).toBe(0);
    expect(everywhere.stdout).toContain("writing/");
    // Without an Area and without --all there is nothing to search.
    expect(unscoped.exitCode).toBe(1);
    expect(unscoped.stderr).toContain("area_not_resolved");
  });

  /**
   * The bracket carries the reason here rather than the status the listings
   * put there, so a hit that reached a Task through search would otherwise
   * say nothing about whether that work is still open.
   */
  test("names the lifecycle of a Task it found", async () => {
    const fixture = await setup();

    const found = await runCommand(fixture, fixture.root, [
      "search",
      "privacy",
      "--all",
    ]);

    expect(found.exitCode).toBe(0);
    expect(found.stdout).toContain(
      "- [filename] product/tasks/01K1ABDXYZ0000000000000000-revise-privacy-notice.md: Revise the privacy notice  status todo  Explain which customer data",
    );
  });

  test("states how much it left out when the limit bounds the answer", async () => {
    const fixture = await setup();

    const human = await runCommand(fixture, fixture.root, [
      "search",
      "the",
      "--all",
      "--limit",
      "2",
    ]);
    const structured = await runCommand(fixture, fixture.root, [
      "--json",
      "search",
      "the",
      "--all",
      "--limit",
      "2",
    ]);
    const { data } = JSON.parse(structured.stdout);

    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain(`Matches: ${data.total} (showing 2)`);
    expect(data).toMatchObject({
      query: "the",
      areaCount: 2,
      limit: 2,
      warnings: [],
    });
    expect(data.total).toBeGreaterThan(2);
    expect(data.hits).toHaveLength(2);
  });
});
