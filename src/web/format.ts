import { plainText, stripFencedCode } from "../core/markdown";

const DAY = 86_400_000;
const LOCAL_TIME_ZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const DUE_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const CALENDAR_DATE_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/** An approximate size, so that "too large" says how large. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * Recent edits read better as an age than as a date; anything older than a
 * fortnight reads better as the date it actually happened.
 */
export function formatAge(isoDate: string, now: Date = new Date()): string {
  const then = new Date(isoDate);
  if (Number.isNaN(then.valueOf())) {
    return "unknown";
  }

  const days = Math.floor((startOfDay(now) - startOfDay(then)) / DAY);
  if (days <= 0) {
    return "today";
  }
  if (days === 1) {
    return "yesterday";
  }
  if (days < 14) {
    return `${days} days ago`;
  }
  return then.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function startOfDay(value: Date): number {
  return Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  );
}

export interface DueLabel {
  label: string;
  tone: string;
}

interface DateOnly {
  date: Date;
  timestamp: number;
}

function parseDateOnly(value: string): DateOnly | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) {
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(`${value}T00:00:00Z`);
  const timestamp = date.valueOf();

  return !Number.isNaN(timestamp) &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? { date, timestamp }
    : undefined;
}

function calendarPart(
  parts: Intl.DateTimeFormatPart[],
  type: "day" | "month" | "year",
): number {
  const part = parts.find((candidate) => candidate.type === type);
  if (!part) {
    throw new Error(`Date formatter did not return a ${type} part.`);
  }
  return Number(part.value);
}

function calendarDayTimestamp(value: Date, timeZone: string): number {
  let formatter = CALENDAR_DATE_FORMATTERS.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "numeric",
      year: "numeric",
      timeZone,
    });
    CALENDAR_DATE_FORMATTERS.set(timeZone, formatter);
  }

  const parts = formatter.formatToParts(value);
  return Date.UTC(
    calendarPart(parts, "year"),
    calendarPart(parts, "month") - 1,
    calendarPart(parts, "day"),
  );
}

/**
 * Whole calendar days from the reader's today to a due date: negative when the
 * work is overdue, `undefined` when there is no due date or it cannot be read
 * as one. Focus bounds its window with this, and it is the one place that
 * decides what "today" means.
 */
export function dueInDays(
  due: string | undefined,
  now: Date = new Date(),
  timeZone: string = LOCAL_TIME_ZONE,
): number | undefined {
  const target = due ? parseDateOnly(due) : undefined;
  return target
    ? Math.round((target.timestamp - calendarDayTimestamp(now, timeZone)) / DAY)
    : undefined;
}

/** The date as it is written, which never shifts with the timezone. */
export function dueLabel(due: string | undefined): string {
  if (!due) {
    return "";
  }
  const target = parseDateOnly(due);
  return target ? DUE_LABEL_FORMATTER.format(target.date) : due;
}

/** Overdue and imminent work is coloured; the colour is part of the reading. */
export function dueTone(days: number | undefined): string {
  if (days === undefined) {
    return "text-muted";
  }
  if (days < 0) {
    return "text-danger";
  }
  return days <= 3 ? "text-warning" : "text-ink-soft";
}

/**
 * A due date reads as a date, but an overdue or imminent one has to read as a
 * warning — the colour is part of the information, not decoration. Due dates
 * are calendar dates rather than instants: their label never shifts with the
 * timezone, while urgency is measured against the reader's local calendar day.
 */
export function formatDue(
  due: string | undefined,
  now: Date = new Date(),
  timeZone: string = LOCAL_TIME_ZONE,
): DueLabel {
  return {
    label: dueLabel(due),
    tone: dueTone(dueInDays(due, now, timeZone)),
  };
}

type PreviewBlockKind = "heading" | "subheading" | "item" | "text";

export interface PreviewBlock {
  kind: PreviewBlockKind;
  text: string;
  /** True for the block the search matched, so it can be marked in place. */
  matched: boolean;
}

/**
 * A reading preview of a document: the prose split into blocks, with the one
 * carrying the match flagged. Deliberately coarse — this is a glance at the
 * document, not a second renderer.
 */
export function previewBlocks(
  body: string,
  needle: string,
  limit = 14,
): PreviewBlock[] {
  const wanted = needle.trim().toLocaleLowerCase();
  const blocks: PreviewBlock[] = [];
  let paragraph: string[] = [];

  const push = (kind: PreviewBlockKind, raw: string): void => {
    const text = plainText(raw);
    if (text.length > 0) {
      blocks.push({
        kind,
        text,
        matched: wanted.length > 0 && text.toLocaleLowerCase().includes(wanted),
      });
    }
  };

  // A hard-wrapped paragraph is one block; headings and list items are not.
  const flush = (): void => {
    if (paragraph.length > 0) {
      push("text", paragraph.join(" "));
      paragraph = [];
    }
  };

  for (const line of stripFencedCode(body).split(/\r?\n/)) {
    const text = line.trim();
    if (blocks.length >= limit) {
      break;
    }
    if (text.length === 0 || text.startsWith("|")) {
      flush();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(text);
    if (heading) {
      flush();
      push(
        (heading[1]?.length ?? 1) <= 2 ? "heading" : "subheading",
        heading[2] ?? "",
      );
      continue;
    }
    const item = /^(?:[-*+]\s+|\d+[.)]\s+|>\s+)(.*)$/.exec(text);
    if (item) {
      flush();
      push("item", item[1] ?? "");
      continue;
    }
    paragraph.push(text);
  }

  if (blocks.length < limit) {
    flush();
  }
  return blocks.slice(0, limit);
}

export interface SnippetParts {
  before: string;
  match: string;
  after: string;
}

/** Split a snippet at the reported match so the hit can be marked up. */
export function splitSnippet(
  snippet: string,
  matchStart: number,
  matchLength: number,
): SnippetParts {
  if (matchStart < 0 || matchLength <= 0 || matchStart > snippet.length) {
    return { before: snippet, match: "", after: "" };
  }
  return {
    before: snippet.slice(0, matchStart),
    match: snippet.slice(matchStart, matchStart + matchLength),
    after: snippet.slice(matchStart + matchLength),
  };
}
