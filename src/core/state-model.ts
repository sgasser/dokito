import { frontmatterField } from "./markdown";

/**
 * Projects and Tasks carry a `status` because they run to an end. An Area and a
 * Resource have no end, so what they need to say is whether they are still in
 * use. That is their state, and they declare it in their own frontmatter.
 */
const DOCUMENT_STATE = {
  active: { label: "Active", order: 0 },
  paused: { label: "Paused", order: 1 },
  archived: { label: "Archived", order: 2 },
} as const satisfies Record<string, { label: string; order: number }>;

export type DocumentState = keyof typeof DOCUMENT_STATE;

/** An Area can be set down and picked up again. */
export const AREA_STATE_VALUES = Object.freeze([
  "active",
  "paused",
  "archived",
] as const satisfies readonly DocumentState[]);

/** Reference material is in use or it is not; nothing pauses a Resource. */
export const RESOURCE_STATE_VALUES = Object.freeze([
  "active",
  "archived",
] as const satisfies readonly DocumentState[]);

export function documentStateLabel(state: DocumentState): string {
  return DOCUMENT_STATE[state].label;
}

export function documentStateOrder(state: DocumentState): number {
  return DOCUMENT_STATE[state].order;
}

/*
 * A document that says nothing is active. An unknown value is also read as
 * active: a Resource is free-form Markdown, and refusing to render one over a
 * `state:` key that means something else in that file would be worse than
 * ignoring it. Validation reports the unknown value.
 */
function declaredState(
  content: string,
  allowed: readonly DocumentState[],
): DocumentState {
  const value = frontmatterField(content, "state");
  return allowed.find((state) => state === value) ?? "active";
}

export function areaState(content: string): DocumentState {
  return declaredState(content, AREA_STATE_VALUES);
}

export function resourceState(content: string): DocumentState {
  return declaredState(content, RESOURCE_STATE_VALUES);
}
