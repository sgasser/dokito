import { describe, expect, test } from "bun:test";
import {
  buildLinkGraph,
  createDocumentLookup,
  documentLinks,
  extractLinkTargets,
  linkCandidates,
  outboundLinks,
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

/**
 * One `overview.md` per topic folder is the shape a bare filename must survive.
 * The bodies matter: a bare `overview` is where resolution is hardest, so an
 * empty corpus would agree with anything.
 */
const duplicates = [
  { relativePath: "context.md", content: "See [[overview]] and [[queues]]." },
  {
    relativePath: "resources/platform/overview.md",
    content: "# Platform\n\nNext to [[queues]], one level from [[context]].",
  },
  {
    relativePath: "resources/platform/queues.md",
    content: "# Queues\n\nSee [[overview]] and [[storage/overview]].",
  },
  {
    relativePath: "resources/platform/storage/overview.md",
    content: "# Storage\n\nBack to [[queues]].",
  },
  {
    relativePath: "resources/billing/overview.md",
    content: "# Billing\n\nSee [[task:01K1ABCXYZ0000000000000000]].",
  },
  {
    relativePath: "tasks/01K1ABCXYZ0000000000000000-migrate.md",
    content: "# Migrate\n\nSee [[billing/overview]].",
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

/**
 * Regression: every screen reads one document's links, but the Web view built
 * the whole Area graph to get them — an mdast parse of every body on every
 * request, which cost seconds on a large Area and blocked the one thread the
 * server answers from. `documentLinks` parses the open body and only the
 * bodies that literally name it, so it has to agree with the graph everywhere.
 */
describe("One document's links", () => {
  /** One document per spelling the resolver accepts for the same target. */
  const area = {
    context: {
      relativePath: "context.md",
      content: [
        "# Product",
        "",
        "See [[Security]] and [notes](resources/my%20notes.md).",
        "Then [[task:01K1ABCXYZ0000000000000000]] and [[project:launch]].",
      ].join("\n"),
    },
    launch: {
      relativePath: "projects/launch.md",
      content: "# Launch\n\n[Rules](security) and [[context]].",
    },
    security: {
      relativePath: "resources/security.md",
      content:
        "# Security\n\n| Who | Why |\n| --- | --- |\n| [[Interview - Karan Shah\\|Interview]] | Escaped pipe |",
    },
    interview: {
      relativePath: "resources/Interview - Karan Shah.md",
      content: "# Interview\n\nWritten up in [notes](resources\\my notes.md).",
    },
    notes: {
      relativePath: "resources/my notes.md",
      content: "# My notes\n\nNothing links out of here.",
    },
    task: {
      relativePath: "tasks/01K1ABCXYZ0000000000000000-revise-notice.md",
      content: "# Revise notice\n\nSee [[my notes]].",
    },
  };
  const spellings = Object.values(area);

  test.each([
    ["spellings", spellings],
    ["ambiguous filenames", duplicates],
    ["plain documents", documents],
  ])("agrees with the Area graph across %s", (_name, corpus) => {
    const graph = buildLinkGraph(corpus);
    for (const document of corpus) {
      const expected = graph.get(document.relativePath) ?? {
        outbound: [],
        inbound: [],
      };
      expect(documentLinks(corpus, document)).toEqual(expected);
      expect(outboundLinks(corpus, document)).toEqual(expected.outbound);
    }
  });

  test("finds inbound links written in an encoded, escaped or bare form", () => {
    expect(documentLinks(spellings, area.notes).inbound).toEqual([
      // Percent-encoded destination.
      "context.md",
      // Backslash read as a separator.
      "resources/Interview - Karan Shah.md",
      // The filename alone.
      "tasks/01K1ABCXYZ0000000000000000-revise-notice.md",
    ]);
  });

  /**
   * The prefilter has to be a superset: a body that resolves here but holds no
   * token of it loses its inbound link silently. Only Markdown decoding inside
   * a destination does that, so every other form the resolver accepts is
   * pinned against the graph it has to agree with.
   */
  const notes = { relativePath: "resources/my notes.md", content: "" };
  test.each([
    ["a dot segment", "[x](resources/./my notes.md)"],
    ["a fragment", "[x](resources/my notes.md#part)"],
    ["angle brackets", "[x](<resources/my notes.md>)"],
    ["a backslash separator", "[x](resources\\my notes.md)"],
    ["a percent escape", "[x](resources/my%20notes.md)"],
    ["the filename alone", "See [[my notes]]."],
  ])("sees an inbound link written with %s", (_name, content) => {
    const corpus = [{ relativePath: "context.md", content }, notes];

    expect(documentLinks(corpus, notes)).toEqual(
      buildLinkGraph(corpus).get(notes.relativePath) ?? {
        outbound: [],
        inbound: [],
      },
    );
    expect(documentLinks(corpus, notes).inbound).toEqual(["context.md"]);
  });

  /**
   * The prescan only narrows; resolution decides. Without these, answering
   * every candidate with "yes" passes the suite, and the Related list fills
   * with documents that merely say the name out loud.
   */
  test("does not read a prose mention or a fenced path as a link", () => {
    const corpus = [
      {
        relativePath: "context.md",
        content: [
          "# Product",
          "",
          "The file resources/my notes.md holds the rest.",
          "",
          "```",
          "[not a link](resources/my notes.md)",
          "```",
        ].join("\n"),
      },
      notes,
    ];

    expect(documentLinks(corpus, notes)).toEqual({ outbound: [], inbound: [] });
  });

  test("does not read an ambiguous bare filename as a link", () => {
    const overview = {
      relativePath: "resources/platform/overview.md",
      content: "",
    };
    const corpus = [
      { relativePath: "context.md", content: "See [[overview]]." },
      overview,
      { relativePath: "resources/billing/overview.md", content: "" },
    ];

    expect(documentLinks(corpus, overview)).toEqual(
      buildLinkGraph(corpus).get(overview.relativePath) ?? {
        outbound: [],
        inbound: [],
      },
    );
    expect(documentLinks(corpus, overview).inbound).toEqual([]);
  });

  /**
   * Regression: the prescan guessed one encoding, `encodeURIComponent`, but a
   * destination may escape any character. Nine Area documents are named like
   * `KW13 (23.-29. Mar).md`, and a link to those has to escape the parentheses
   * or the `)` ends the destination — which is exactly what the guess left
   * alone. The last row pins the order: the body has to be decoded before it is
   * lowercased, or an escape of `Ü` decodes back to `Ü` and misses `übersicht`.
   */
  test.each([
    [
      "an escaped punctuation character",
      "[x](resources/my%2Dnotes.md)",
      "resources/my-notes.md",
    ],
    [
      "an escaped letter",
      "[x](resources/%6Dy-notes.md)",
      "resources/my-notes.md",
    ],
    [
      "escaped parentheses",
      "[x](resources/KW13 %2823.-29. Mar%29.md)",
      "resources/KW13 (23.-29. Mar).md",
    ],
    [
      "a fully escaped path",
      "[x](resources/KW13%20%2823.-29.%20Mar%29.md)",
      "resources/KW13 (23.-29. Mar).md",
    ],
    [
      "a literal ampersand beside an escape",
      "[x](resources/Q&A%20session.md)",
      "resources/Q&A session.md",
    ],
    [
      "an escaped non-ASCII letter",
      "[x](resources/%C3%BCbersicht.md)",
      "resources/übersicht.md",
    ],
    [
      "an escape that has to be decoded before it is folded",
      "[x](resources/%C3%9Cbersicht.md)",
      "resources/übersicht.md",
    ],
  ])("sees an inbound link through %s", (_name, content, target) => {
    const document = { relativePath: target, content: "" };
    const corpus = [{ relativePath: "context.md", content }, document];

    expect(documentLinks(corpus, document)).toEqual(
      buildLinkGraph(corpus).get(target) ?? { outbound: [], inbound: [] },
    );
    expect(documentLinks(corpus, document).inbound).toEqual(["context.md"]);
  });

  /**
   * A document that links to itself must appear in neither of its own lists,
   * and both lists are path-sorted so the Related panel does not reshuffle
   * between renders. Reading the corpus in order would satisfy the second by
   * accident, so the documents here are deliberately out of order.
   */
  test("excludes a self-link and sorts both directions", () => {
    const self = {
      relativePath: "resources/hub.md",
      content: "# Hub\n\nSee [[hub]], [[alpha]] and [[zulu]].",
    };
    const corpus = [
      { relativePath: "resources/zulu.md", content: "Up to [[hub]]." },
      self,
      { relativePath: "resources/alpha.md", content: "Up to [[hub]]." },
    ];

    expect(documentLinks(corpus, self)).toEqual({
      outbound: ["resources/alpha.md", "resources/zulu.md"],
      inbound: ["resources/alpha.md", "resources/zulu.md"],
    });
    expect(outboundLinks(corpus, self)).toEqual([
      "resources/alpha.md",
      "resources/zulu.md",
    ]);
  });

  test("finds a Task named by its ULID and a Project by its id", () => {
    expect(documentLinks(spellings, area.task).inbound).toEqual(["context.md"]);
    expect(documentLinks(spellings, area.launch).inbound).toEqual([
      "context.md",
    ]);
  });

  test("reads a wiki target whose pipe is escaped inside a table", () => {
    expect(documentLinks(spellings, area.interview).inbound).toEqual([
      "resources/security.md",
    ]);
  });

  /**
   * The cost this replaced. The budget sits far above one scan of the Area and
   * far below a parse of it, so it fails on a return to whole-Area parsing
   * without turning into a benchmark of the machine it runs on.
   */
  test("answers for one document without parsing the Area", () => {
    const filler = Array.from({ length: 200 }, (_, index) => ({
      relativePath: `resources/filler-${index}.md`,
      content: `# Filler ${index}\n\n${"Prose that names nothing. ".repeat(100)}`,
    }));
    const corpus = [...spellings, ...filler];

    const singleStarted = performance.now();
    const links = documentLinks(corpus, area.context);
    const single = performance.now() - singleStarted;

    const graphStarted = performance.now();
    const graph = buildLinkGraph(corpus);
    const whole = performance.now() - graphStarted;

    // The empty fallback would fail against the links this document has, so a
    // graph that lost the entry is a failure rather than a pass.
    expect(links).toEqual(
      graph.get("context.md") ?? { outbound: [], inbound: [] },
    );
    expect(single).toBeLessThan(whole / 3);
  }, 60_000);
});
