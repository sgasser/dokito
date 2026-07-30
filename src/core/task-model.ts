const TASK_STATUS = {
  todo: {
    label: "To do",
    order: 1,
    lifecycle: "open",
  },
  in_progress: {
    label: "In progress",
    order: 0,
    lifecycle: "open",
  },
  waiting: {
    label: "Waiting",
    order: 2,
    lifecycle: "open",
  },
  someday: {
    label: "Someday",
    order: 3,
    lifecycle: "open",
  },
  done: {
    label: "Done",
    order: 4,
    lifecycle: "closed",
  },
  cancelled: {
    label: "Cancelled",
    order: 5,
    lifecycle: "closed",
  },
} as const satisfies Record<
  string,
  {
    label: string;
    order: number;
    lifecycle: "open" | "closed";
  }
>;

export type TaskStatus = keyof typeof TASK_STATUS;

const TASK_PRIORITY = {
  low: {
    label: "Low",
    order: 3,
  },
  normal: {
    label: "Normal",
    order: 2,
  },
  high: {
    label: "High",
    order: 1,
  },
  urgent: {
    label: "Urgent",
    order: 0,
  },
} as const satisfies Record<
  string,
  {
    label: string;
    order: number;
  }
>;

export type TaskPriority = keyof typeof TASK_PRIORITY;

const TASK_LIFECYCLE_FILTER = {
  open: {
    label: "Open",
  },
  closed: {
    label: "Closed",
  },
  all: {
    label: "All",
  },
} as const satisfies Record<
  string,
  {
    label: string;
  }
>;

export type TaskLifecycleFilter = keyof typeof TASK_LIFECYCLE_FILTER;
export type TaskListStatus = TaskLifecycleFilter | TaskStatus;

function keysOf<const T extends object>(
  value: T,
): readonly Extract<keyof T, string>[] {
  return Object.freeze(Object.keys(value) as Array<Extract<keyof T, string>>);
}

export const TASK_STATUS_VALUES = keysOf(TASK_STATUS);
export const TASK_PRIORITY_VALUES = keysOf(TASK_PRIORITY);
export const TASK_LIFECYCLE_FILTER_VALUES = keysOf(TASK_LIFECYCLE_FILTER);

export function isTaskStatus(value: string): value is TaskStatus {
  return Object.hasOwn(TASK_STATUS, value);
}

export function isTaskPriority(value: string): value is TaskPriority {
  return Object.hasOwn(TASK_PRIORITY, value);
}

export function isTaskLifecycleFilter(
  value: string,
): value is TaskLifecycleFilter {
  return Object.hasOwn(TASK_LIFECYCLE_FILTER, value);
}

export function isTaskListStatus(value: string): value is TaskListStatus {
  return isTaskStatus(value) || isTaskLifecycleFilter(value);
}

export function taskStatusLabel(status: TaskStatus): string {
  return TASK_STATUS[status].label;
}

export function taskPriorityLabel(priority: TaskPriority): string {
  return TASK_PRIORITY[priority].label;
}

export function taskLifecycleFilterLabel(status: TaskLifecycleFilter): string {
  return TASK_LIFECYCLE_FILTER[status].label;
}

export function taskStatusMatches(
  status: TaskStatus,
  filter: TaskListStatus,
): boolean {
  if (filter === "all") {
    return true;
  }
  if (isTaskLifecycleFilter(filter)) {
    return TASK_STATUS[status].lifecycle === filter;
  }
  return status === filter;
}

function taskStatusOrder(status: TaskStatus): number {
  return TASK_STATUS[status].order;
}

function taskPriorityOrder(priority: TaskPriority | undefined): number {
  return priority ? TASK_PRIORITY[priority].order : Number.MAX_SAFE_INTEGER;
}

export interface TaskOrderKey {
  id: string;
  status: TaskStatus;
  due?: string;
  priority?: TaskPriority;
}

export function compareTaskOrder(a: TaskOrderKey, b: TaskOrderKey): number {
  const status = taskStatusOrder(a.status) - taskStatusOrder(b.status);
  if (status !== 0) {
    return status;
  }

  const due = (a.due ?? "9999-99-99").localeCompare(b.due ?? "9999-99-99");
  if (due !== 0) {
    return due;
  }

  const priority =
    taskPriorityOrder(a.priority) - taskPriorityOrder(b.priority);
  return priority !== 0 ? priority : a.id.localeCompare(b.id);
}
