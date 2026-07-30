export const PROJECT_STATUS = {
  planned: {
    label: "Planned",
    lifecycle: "open",
  },
  active: {
    label: "Active",
    lifecycle: "open",
  },
  done: {
    label: "Done",
    lifecycle: "closed",
  },
  cancelled: {
    label: "Cancelled",
    lifecycle: "closed",
  },
} as const satisfies Record<
  string,
  {
    label: string;
    lifecycle: "open" | "closed";
  }
>;

export type ProjectStatus = keyof typeof PROJECT_STATUS;

export const PROJECT_STATUS_VALUES = Object.freeze(
  Object.keys(PROJECT_STATUS) as ProjectStatus[],
);

export function isProjectStatus(value: string): value is ProjectStatus {
  return Object.hasOwn(PROJECT_STATUS, value);
}

export function projectStatusLabel(status: ProjectStatus): string {
  return PROJECT_STATUS[status].label;
}
