import { describe, expect, test } from "bun:test";
import { formatDue, previewBlocks, splitSnippet } from "../../src/web/format";

describe("Formatting", () => {
  test("warns about a due date that has passed or is close", () => {
    const now = new Date("2026-07-27T00:00:00Z");

    expect(formatDue("2026-07-20", now)).toEqual({
      label: "Jul 20",
      tone: "text-danger",
    });
    expect(formatDue("2026-07-29", now).tone).toBe("text-warning");
    expect(formatDue("2026-09-01", now).tone).toBe("text-ink-soft");
    expect(formatDue(undefined, now).label).toBe("");
  });

  test("treats due dates as calendar dates across time zones", () => {
    const now = new Date("2026-08-01T00:30:00Z");

    expect(formatDue("2026-08-05", now, "America/Los_Angeles")).toEqual({
      label: "Aug 5",
      tone: "text-ink-soft",
    });
    expect(formatDue("2026-07-31", now, "America/Los_Angeles")).toEqual({
      label: "Jul 31",
      tone: "text-warning",
    });
  });

  test("splits a snippet at the reported match", () => {
    expect(splitSnippet("Rotate the signing key", 11, 7)).toEqual({
      before: "Rotate the ",
      match: "signing",
      after: " key",
    });
    expect(splitSnippet("no match here", -1, 0).before).toBe("no match here");
  });
});

describe("Search preview", () => {
  const body = [
    "Outcome: the release is verified.",
    "",
    "Customer documentation must match the",
    "implemented behaviour before launch.",
    "",
    "## Data handling",
    "",
    "- Secrets belong in the keychain.",
    "- Fixtures use [[Security|synthetic identities]].",
  ].join("\n");

  test("keeps a hard-wrapped paragraph in one block", () => {
    const blocks = previewBlocks(body, "launch");

    expect(blocks[1]).toEqual({
      kind: "text",
      text: "Customer documentation must match the implemented behaviour before launch.",
      matched: true,
    });
  });

  test("separates headings and list items", () => {
    const blocks = previewBlocks(body, "");

    expect(blocks.map((block) => block.kind)).toEqual([
      "text",
      "text",
      "heading",
      "item",
      "item",
    ]);
  });

  test("reads blocks as prose, not as raw Markup", () => {
    const blocks = previewBlocks(body, "");

    expect(blocks.at(-1)?.text).toBe("Fixtures use synthetic identities.");
  });

  test("marks only the block carrying the match", () => {
    const blocks = previewBlocks(body, "keychain");

    expect(blocks.filter((block) => block.matched)).toHaveLength(1);
    expect(blocks.find((block) => block.matched)?.text).toBe(
      "Secrets belong in the keychain.",
    );
  });

  test("ignores fenced code", () => {
    const blocks = previewBlocks("```\nnot prose\n```\n\nreal prose", "");

    expect(blocks.map((block) => block.text)).toEqual(["real prose"]);
  });
});
