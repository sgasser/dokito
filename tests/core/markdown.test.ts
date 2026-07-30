import { describe, expect, test } from "bun:test";
import {
  documentBody,
  headingTitle,
  leadParagraphs,
  plainText,
  projectNote,
  projectOutcome,
  stripFencedCode,
  stripFrontmatter,
} from "../../src/core/markdown";

describe("Markdown prose", () => {
  test("removes frontmatter and the leading heading", () => {
    const content = [
      "---",
      "status: active",
      "---",
      "",
      "# Launch the product",
      "",
      "Outcome: The Web app is available.",
    ].join("\n");

    expect(stripFrontmatter(content)).not.toContain("status: active");
    expect(documentBody(content)).toBe("Outcome: The Web app is available.");
  });

  test("does not read a title out of fenced code", () => {
    const fenced = ["```bash", "# install the deps", "bun install", "```"].join(
      "\n",
    );

    expect(headingTitle(fenced)).toBeUndefined();
    expect(headingTitle(`# Real title\n\n${fenced}`)).toBe("Real title");
    expect(headingTitle(`${fenced}\n\n# After the block`)).toBe(
      "After the block",
    );
  });

  test("keeps headings that are not the title", () => {
    const body = documentBody("# Title\n\nLead.\n\n## Rules\n\nDetail.");

    expect(body).toBe("Lead.\n\n## Rules\n\nDetail.");
  });

  test("reads paragraphs in order and skips other blocks", () => {
    const body = [
      "First paragraph",
      "wrapped across lines.",
      "",
      "## Definition of done",
      "",
      "- A list item",
      "> A quote",
      "",
      "Second paragraph.",
      "",
      "Third paragraph.",
    ].join("\n");

    expect(leadParagraphs(body, 2)).toEqual([
      "First paragraph wrapped across lines.",
      "Second paragraph.",
    ]);
  });

  test("does not read prose out of fenced code", () => {
    const body = [
      "```text",
      "Not a paragraph.",
      "",
      "Still not a paragraph.",
      "```",
      "",
      "The real paragraph.",
    ].join("\n");

    expect(stripFencedCode(body).trim()).toBe("The real paragraph.");
    expect(leadParagraphs(body, 1)).toEqual(["The real paragraph."]);
  });

  test("reduces inline Markup to the words it wraps", () => {
    expect(
      plainText("See [[Security|the rules]], [checklist](x.md) and **now**."),
    ).toBe("See the rules, checklist and now.");
    expect(plainText("Use `dokito context` for _this_.")).toBe(
      "Use dokito context for this.",
    );
  });

  test("leaves identifiers with underscores alone", () => {
    expect(plainText("The field is snake_case_name here.")).toBe(
      "The field is snake_case_name here.",
    );
  });

  test("reads paragraphs as plain sentences", () => {
    expect(leadParagraphs("Outcome: ship [[Launch|the release]].", 1)).toEqual([
      "Outcome: ship the release.",
    ]);
  });

  test("drops the conventional Outcome prefix", () => {
    const body =
      "Outcome: The release is verified.\n\nDocumentation must match.";

    expect(projectOutcome(body)).toBe("The release is verified.");
    expect(projectNote(body)).toBe("Documentation must match.");
  });

  test("reports no outcome for a Project without prose", () => {
    expect(projectOutcome("## Open questions\n\n- Anything?")).toBeUndefined();
    expect(projectNote("Only one paragraph.")).toBeUndefined();
  });

  /**
   * The Project detail renders the summary above the body and removes exactly
   * as many leading paragraphs as it rendered. Reading a summary paragraph out
   * of a later section therefore emptied that section in the body.
   */
  test("reads a Project summary only from the lead-in", () => {
    const body = documentBody(
      [
        "# Launch the product",
        "",
        "Outcome: Ship the Web app.",
        "",
        "## Plan",
        "",
        "Step one is the release build.",
      ].join("\n"),
    );

    expect(projectOutcome(body)).toBe("Ship the Web app.");
    expect(projectNote(body)).toBeUndefined();
  });

  test("does not read a setext heading as the outcome", () => {
    const body = documentBody(
      [
        "# Launch the product",
        "",
        "Definition of done",
        "==================",
        "",
        "Ship it.",
      ].join("\n"),
    );

    expect(projectOutcome(body)).toBeUndefined();
  });
});
