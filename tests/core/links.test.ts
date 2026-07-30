import { describe, expect, test } from "bun:test";
import {
  buildLinkGraph,
  extractLinkTargets,
  normalizeLinkTarget,
  resolveLink,
} from "../../src/core/links";

const documents = [
  { relativePath: "context.md", title: "Product", content: "" },
  {
    relativePath: "projects/launch.md",
    title: "Launch the product",
    content: "",
  },
  { relativePath: "resources/security.md", title: "Security", content: "" },
];

describe("Document links", () => {
  test("extracts wiki links and relative Markdown links", () => {
    const content = [
      "---",
      "status: active",
      "---",
      "",
      "# Launch",
      "",
      "See [[Security|the rules]] and [the area](../context.md).",
      "Also [the spec](https://example.invalid/spec) and ![shot](shot.png).",
    ].join("\n");

    expect(extractLinkTargets(content)).toEqual(["Security", "../context.md"]);
  });

  test("ignores links inside fenced code", () => {
    const content = "```\n[[Security]]\n```\n\n[[Product]]";

    expect(extractLinkTargets(content)).toEqual(["Product"]);
  });

  test("understands encoded, spaced, angled, and reference destinations", () => {
    const content = [
      "[Encoded](resources/encoded%20notes.md)",
      "[Raw space](resources/raw notes.md)",
      "[Angled](<resources/angled notes.md>)",
      "[Reference][notes]",
      "",
      "[notes]: resources/reference.md",
      "",
      "`[Code](resources/ignored.md)`",
    ].join("\n\n");

    expect(extractLinkTargets(content)).toEqual([
      "resources/encoded%20notes.md",
      "resources/raw notes.md",
      "resources/angled notes.md",
      "resources/reference.md",
    ]);
  });

  test("deduplicates repeated targets and drops fragments", () => {
    const content =
      "[[Security]] [[Security#Data]] [again](resources/security.md)";

    expect(extractLinkTargets(content)).toEqual([
      "Security",
      "resources/security.md",
    ]);
  });

  test("normalizes targets against the linking document", () => {
    expect(normalizeLinkTarget("projects/launch.md", "../context.md")).toBe(
      "context.md",
    );
    expect(normalizeLinkTarget("projects/launch.md", "./notes.md")).toBe(
      "projects/notes.md",
    );
    expect(normalizeLinkTarget("context.md", "/resources/security.md")).toBe(
      "resources/security.md",
    );
  });

  test("refuses to escape the Area", () => {
    expect(normalizeLinkTarget("context.md", "../secrets.md")).toBeUndefined();
    expect(
      normalizeLinkTarget("context.md", "%2e%2e/secrets.md"),
    ).toBeUndefined();
    expect(
      normalizeLinkTarget("projects/launch.md", "%2e%2e%2f%2e%2e/secrets.md"),
    ).toBeUndefined();
  });

  test("decodes URI paths while keeping a literal percent safe", () => {
    expect(normalizeLinkTarget("context.md", "resources/my%20notes.md")).toBe(
      "resources/my notes.md",
    );
    expect(normalizeLinkTarget("context.md", "resources/100%.md")).toBe(
      "resources/100%.md",
    );
  });

  test("resolves by path, by title and by filename", () => {
    expect(
      resolveLink("context.md", "projects/launch.md", documents)?.title,
    ).toBe("Launch the product");
    expect(resolveLink("context.md", "Security", documents)?.relativePath).toBe(
      "resources/security.md",
    );
    expect(
      resolveLink("projects/launch.md", "security", documents)?.title,
    ).toBe("Security");
    expect(resolveLink("context.md", "nothing", documents)).toBeUndefined();
  });

  test("builds outbound and inbound links across an Area", () => {
    const graph = buildLinkGraph([
      {
        relativePath: "context.md",
        title: "Product",
        content: "# Product\n\nSee [[Security]].",
      },
      {
        relativePath: "projects/launch.md",
        title: "Launch the product",
        content:
          "# Launch\n\n[Rules](../resources/security.md) and [[Product]].",
      },
      {
        relativePath: "resources/security.md",
        title: "Security",
        content: "# Security\n\nNo links here.",
      },
    ]);

    expect(graph.get("context.md")).toEqual({
      outbound: ["resources/security.md"],
      inbound: ["projects/launch.md"],
    });
    expect(graph.get("resources/security.md")).toEqual({
      outbound: [],
      inbound: ["context.md", "projects/launch.md"],
    });
  });

  test("never links a document to itself", () => {
    const graph = buildLinkGraph([
      {
        relativePath: "context.md",
        title: "Product",
        content: "# Product\n\n[[Product]]",
      },
    ]);

    expect(graph.get("context.md")).toEqual({ outbound: [], inbound: [] });
  });

  test("connects raw-space and encoded links to the same document", () => {
    const graph = buildLinkGraph([
      {
        relativePath: "context.md",
        title: "Product",
        content:
          "# Product\n\n[Raw](resources/my notes.md) and [encoded](resources/my%20notes.md).",
      },
      {
        relativePath: "resources/my notes.md",
        title: "My notes",
        content: "# My notes",
      },
    ]);

    expect(graph.get("context.md")?.outbound).toEqual([
      "resources/my notes.md",
    ]);
    expect(graph.get("resources/my notes.md")?.inbound).toEqual(["context.md"]);
  });

  test("reads a wiki target that follows a stray bracket", () => {
    expect(extractLinkTargets("[[[Security]]")).toEqual(["Security"]);
  });

  /**
   * Regression: the bracket scan and the wiki-link pattern each re-walked the
   * rest of the body once per opening bracket. A single document of unclosed
   * `[` therefore cost minutes of blocking CPU per request, and the Web view
   * serves every page from the same thread. The budget sits well above the
   * linear cost and well below the quadratic one.
   */
  test("reads a body of unclosed brackets in linear time", () => {
    const noise = "[".repeat(200_000);
    const started = performance.now();

    expect(extractLinkTargets(noise)).toEqual([]);
    expect(extractLinkTargets(`${noise}]`)).toEqual([]);
    expect(extractLinkTargets("[](".repeat(60_000))).toEqual([]);
    // A backslash run before the one `]` every bracket settles on: re-checking
    // whether it is escaped is its own quadratic path.
    expect(extractLinkTargets(`${noise}${"\\".repeat(200_000)}]x`)).toEqual([]);
    expect(extractLinkTargets(`${"\\".repeat(200_000)}[a](notes.md)`)).toEqual([
      "notes.md",
    ]);

    expect(performance.now() - started).toBeLessThan(10_000);
  }, 60_000);
});
