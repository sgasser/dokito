const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;
const LEADING_H1 = /^#\s+[^\r\n]*(?:\r?\n|$)/;
const FENCED_BLOCK = /^(?:```|~~~)[^\r\n]*\r?\n[\s\S]*?^(?:```|~~~)[^\r\n]*$/gm;
const OUTCOME_PREFIX = /^outcome:\s*/i;
const BLOCK_MARKER = /^(?:#{1,6}\s|[-*+]\s|>\s|\d+[.)]\s|\||---\s*$)/;
/**
 * A block that opens a section, in either heading spelling. Unlike the markers
 * above it ends the lead-in rather than being skipped over.
 */
const SECTION_BREAK = /^(?:#{1,6}\s|[^\r\n]+\r?\n(?:=+|-+)[ \t]*$|---[ \t]*$)/;

export function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER, "");
}

/**
 * One scalar out of a document's frontmatter, read without judging the rest of
 * it. The manifest loaders parse and validate a whole Project or Task; a caller
 * that only wants to know how one field reads should not have to reject a file
 * over a key it never looks at.
 */
export function frontmatterField(
  content: string,
  key: string,
): string | undefined {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(
    content,
  )?.[1];
  if (frontmatter === undefined) {
    return undefined;
  }
  const field = new RegExp(
    `^${key}:[ \\t]*["']?([A-Za-z0-9_-]+)["']?[ \\t]*$`,
    "m",
  );
  return field.exec(frontmatter)?.[1];
}

export function stripFencedCode(content: string): string {
  return content.replace(FENCED_BLOCK, "");
}

/**
 * Reduce inline Markup to the words it wraps. Outcome, note and description
 * are read as plain sentences — in a table cell or a property row there is
 * nothing to render the syntax into.
 */
export function plainText(value: string): string {
  return value
    .replace(/\[\[([^\]\n]+)\]\]/g, (_match, inner: string) => {
      const [target, label] = inner.split("|", 2);
      return (label ?? target ?? "").trim();
    })
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
    .replace(/(?<![\w_])_([^_]+)_(?![\w_])/g, "$1")
    .trim();
}

/** The prose of a document: frontmatter and the leading H1 removed. */
/**
 * The heading `documentBody` removes, so validation can ask for exactly that
 * one. `headingTitle` answers a different question: it finds the first H1
 * anywhere, which for a Resource would report a section as a hidden title.
 */
export function leadingHeading(content: string): string | undefined {
  const body = stripFrontmatter(content).replace(/^\s*\r?\n/, "");
  const match = LEADING_H1.exec(body)?.[0];
  return (
    match
      ?.replace(/^#\s+/, "")
      // An ATX heading may close with its own run of hashes.
      .replace(/\s+#+\s*$/, "")
      .trim() || undefined
  );
}

export function documentBody(content: string): string {
  const withoutFrontmatter = stripFrontmatter(content).replace(/^\s*\r?\n/, "");
  return withoutFrontmatter.replace(LEADING_H1, "").trim();
}

/**
 * The leading prose paragraphs of a body, in order. Headings, lists, quotes,
 * tables and fenced code are skipped so that a Project's outcome is not
 * accidentally read from its "Definition of done" list.
 */
export function leadParagraphs(body: string, limit: number): string[] {
  const paragraphs: string[] = [];

  for (const block of body.replace(FENCED_BLOCK, "").split(/\r?\n\s*\r?\n/)) {
    const trimmed = block.trim();
    if (trimmed.length === 0 || BLOCK_MARKER.test(trimmed)) {
      continue;
    }
    paragraphs.push(
      plainText(
        trimmed
          .split(/\r?\n/)
          .map((line) => line.trim())
          .join(" "),
      ),
    );
    if (paragraphs.length === limit) {
      break;
    }
  }

  return paragraphs;
}

/**
 * The prose a body opens with, up to its first section. A Project detail renders
 * this summary above the body and removes exactly the paragraphs it rendered, so
 * reading one out of a later section emptied the section it came from.
 */
function leadIn(body: string): string {
  const blocks = body.replace(FENCED_BLOCK, "").split(/\r?\n\s*\r?\n/);
  const section = blocks.findIndex((block) => SECTION_BREAK.test(block.trim()));
  return (section === -1 ? blocks : blocks.slice(0, section)).join("\n\n");
}

/**
 * A Project states its outcome in the first paragraph after the heading. The
 * conventional "Outcome:" prefix is dropped so the value reads as a sentence.
 */
export function projectOutcome(body: string): string | undefined {
  const paragraph = leadParagraphs(leadIn(body), 1)[0];
  if (paragraph === undefined) {
    return undefined;
  }
  const outcome = paragraph.replace(OUTCOME_PREFIX, "").trim();
  return outcome.length > 0 ? outcome : undefined;
}

export function projectNote(body: string): string | undefined {
  return leadParagraphs(leadIn(body), 2)[1];
}

/**
 * A document's own title: its first H1. Both the manifest loaders and the Web
 * view ask here, because two spellings of this rule disagreed on `# X` and
 * listed the same file under two different names.
 */
export function headingTitle(body: string): string | undefined {
  // Fenced code goes first: a shell comment is not a heading, and reading one
  // as the title both renamed the document and hid that it had no heading.
  return /^# (.+)$/m.exec(stripFencedCode(body))?.[1]?.trim() || undefined;
}
