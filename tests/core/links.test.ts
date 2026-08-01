import { describe, expect, test } from "bun:test";
import {
  buildLinkGraph,
  createDocumentLookup,
  extractLinkTargets,
  linkCandidates,
  resolveLink,
  shortestLinkForm,
} from "../../src/core/links";
import { normalizeTargetPath, parseReference } from "../../src/core/references";

const documents = [
  { relativePath: "context.md", content: "" },
  {
    relativePath: "projects/launch.md",
    content: "",
  },
  { relativePath: "resources/security.md", content: "" },
  {
    relativePath: "tasks/01K1ABCXYZ0000000000000000-revise-notice.md",
    content: "",
  },
];

/** One `overview.md` per topic folder is the shape a bare filename must survive. */
const duplicates = [
  { relativePath: "context.md", content: "" },
  {
    relativePath: "resources/platform/overview.md",
    content: "",
  },
  {
    relativePath: "resources/platform/queues.md",
    content: "",
  },
  {
    relativePath: "resources/platform/storage/overview.md",
    content: "",
  },
  {
    relativePath: "resources/billing/overview.md",
    content: "",
  },
  {
    relativePath: "tasks/01K1ABCXYZ0000000000000000-migrate.md",
    content: "",
  },
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

  test("keeps reference prefixes that read as a URL scheme", () => {
    const content =
      "[[project:launch]] [spec](repo:web-app/docs/SPEC.md) [web](https://example.invalid)";

    expect(extractLinkTargets(content)).toEqual([
      "project:launch",
      "repo:web-app/docs/SPEC.md",
    ]);
  });

  /**
   * A capital would otherwise leave the target looking like a URL scheme, and
   * extraction drops those. The link would vanish instead of being reported.
   */
  test("keeps a reference prefix written with a capital", () => {
    expect(extractLinkTargets("[[Repo:web-app]] [[Project:launch]]")).toEqual([
      "Repo:web-app",
      "Project:launch",
    ]);
    expect(parseReference("Project:launch")).toEqual({
      kind: "project",
      id: "launch",
    });
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

  test("normalizes a target to an Area-relative path", () => {
    expect(normalizeTargetPath("./notes.md")).toBe("notes.md");
    expect(normalizeTargetPath("/resources/security.md")).toBe(
      "resources/security.md",
    );
    expect(normalizeTargetPath("resources\\security.md")).toBe(
      "resources/security.md",
    );
  });

  test("refuses every relative target", () => {
    expect(normalizeTargetPath("../context.md")).toBeUndefined();
    expect(normalizeTargetPath("../secrets.md")).toBeUndefined();
    expect(normalizeTargetPath("%2e%2e/secrets.md")).toBeUndefined();
    expect(normalizeTargetPath("%2e%2e%2f%2e%2e/secrets.md")).toBeUndefined();
  });

  test("decodes URI paths while keeping a literal percent safe", () => {
    expect(normalizeTargetPath("resources/my%20notes.md")).toBe(
      "resources/my notes.md",
    );
    expect(normalizeTargetPath("resources/100%.md")).toBe("resources/100%.md");
  });

  test("resolves by path and by filename, never by title", () => {
    expect(
      resolveLink("context.md", "projects/launch.md", documents)?.relativePath,
    ).toBe("projects/launch.md");
    expect(resolveLink("context.md", "security", documents)?.relativePath).toBe(
      "resources/security.md",
    );
    expect(
      resolveLink("projects/launch.md", "Security.md", documents)?.relativePath,
    ).toBe("resources/security.md");
    expect(resolveLink("context.md", "nothing", documents)).toBeUndefined();
    // A document's H1 is display text, so a phrase that is not a filename
    // reaches nothing however well it reads.
    expect(
      resolveLink("context.md", "Launch the product", documents),
    ).toBeUndefined();
  });

  test("no longer resolves a relative target", () => {
    expect(
      resolveLink("projects/launch.md", "../resources/security.md", documents),
    ).toBeUndefined();
    expect(
      resolveLink("projects/launch.md", "../context.md", documents),
    ).toBeUndefined();
  });

  test("resolves a project, a task and never a repository", () => {
    expect(
      resolveLink("context.md", "project:launch", documents)?.relativePath,
    ).toBe("projects/launch.md");
    expect(
      resolveLink("context.md", "task:01K1ABCXYZ0000000000000000", documents)
        ?.relativePath,
    ).toBe("tasks/01K1ABCXYZ0000000000000000-revise-notice.md");
    expect(resolveLink("context.md", "project:missing", documents)).toBe(
      undefined,
    );
    // A Repository is not a document, so the Area graph holds no edge for it.
    expect(resolveLink("context.md", "repo:web-app", documents)).toBe(
      undefined,
    );
  });

  test("reports rather than picks when two files share a ULID", () => {
    const id = "01K1ABCXYZ0000000000000000";
    const clashing = [
      { relativePath: `tasks/${id}-first.md`, content: "" },
      { relativePath: `tasks/${id}-second.md`, content: "" },
    ];

    expect(resolveLink("context.md", `task:${id}`, clashing)).toBeUndefined();
    expect(
      linkCandidates(
        "context.md",
        `task:${id}`,
        createDocumentLookup(clashing),
      ).map((document) => document.relativePath),
    ).toEqual([`tasks/${id}-first.md`, `tasks/${id}-second.md`]);
  });

  test("prefers the nearest document when a filename repeats", () => {
    expect(
      resolveLink("resources/platform/queues.md", "overview", duplicates)
        ?.relativePath,
    ).toBe("resources/platform/overview.md");
    expect(
      resolveLink(
        "resources/platform/storage/volumes.md",
        "overview",
        duplicates,
      )?.relativePath,
    ).toBe("resources/platform/storage/overview.md");
  });

  test("reports rather than picks when candidates are equally close", () => {
    const lookup = createDocumentLookup(duplicates);
    const from = "tasks/01K1ABCXYZ0000000000000000-migrate.md";

    expect(
      linkCandidates(from, "overview", lookup).map(
        (document) => document.relativePath,
      ),
    ).toEqual([
      "resources/platform/overview.md",
      "resources/billing/overview.md",
    ]);
    expect(resolveLink(from, "overview", duplicates, lookup)).toBeUndefined();
    // Enough of the path to be unique resolves from anywhere.
    expect(
      resolveLink(from, "billing/overview", duplicates, lookup)?.relativePath,
    ).toBe("resources/billing/overview.md");
  });

  test("names the shortest form that reaches a document", () => {
    const lookup = createDocumentLookup(duplicates);

    expect(shortestLinkForm(duplicates[2] as never, lookup)).toBe("queues");
    expect(shortestLinkForm(duplicates[1] as never, lookup)).toBe(
      "platform/overview",
    );
  });

  test("reads the reference prefixes", () => {
    expect(parseReference("repo:web-app/docs/SPEC.md")).toEqual({
      kind: "repository",
      repository: "web-app",
      path: "docs/SPEC.md",
    });
    expect(parseReference("repo:web-app")).toEqual({
      kind: "repository",
      repository: "web-app",
    });
    expect(parseReference("task:01k1abcxyz0000000000000000")).toEqual({
      kind: "task",
      id: "01K1ABCXYZ0000000000000000",
    });
    expect(parseReference("task:not-a-ulid")).toBeUndefined();
    expect(parseReference("project:a/b")).toBeUndefined();
    // A ULID carries no path, so a trailing one is reported, not dropped.
    expect(
      parseReference("task:01K1ABCXYZ0000000000000000/notes.md"),
    ).toBeUndefined();
  });

  test("builds outbound and inbound links across an Area", () => {
    const graph = buildLinkGraph([
      {
        relativePath: "context.md",
        content: "# Product\n\nSee [[Security]].",
      },
      {
        relativePath: "projects/launch.md",
        content: "# Launch\n\n[Rules](security) and [[context]].",
      },
      {
        relativePath: "resources/security.md",
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
        content: "# Product\n\n[[context]]",
      },
    ]);

    expect(graph.get("context.md")).toEqual({ outbound: [], inbound: [] });
  });

  test("connects raw-space and encoded links to the same document", () => {
    const graph = buildLinkGraph([
      {
        relativePath: "context.md",
        content:
          "# Product\n\n[Raw](resources/my notes.md) and [encoded](resources/my%20notes.md).",
      },
      {
        relativePath: "resources/my notes.md",
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
