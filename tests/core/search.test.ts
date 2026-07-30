import { describe, expect, test } from "bun:test";
import { searchDocumentContent } from "../../src/core/search";

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
});
