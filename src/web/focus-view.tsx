import { Fragment } from "react";
import type { WebFocusDashboardData } from "./data";
import { FilterMenu } from "./filters";
import {
  FOCUS_WINDOW_DAYS,
  type FocusBandId,
  type FocusProject,
  type FocusTask,
} from "./focus";
import { dueLabel, dueTone } from "./format";
import { cx, SHELL } from "./ui";
import { focusUrl, projectUrl, tasksUrl } from "./urls";

interface FocusViewProps {
  data: WebFocusDashboardData;
}

/**
 * A band header carries the marker of the lane it names. Due soon has no
 * status of its own, so it borrows the quiet ring that means untouched work.
 */
const BAND_MARKERS: Record<FocusBandId, string> = {
  urgent: "urgent",
  in_progress: "in_progress",
  due_soon: "todo",
};

const groupHeaderClass =
  "sticky top-0 z-2 flex h-8 items-center gap-2 border-b border-line bg-canvas px-4";
const groupLabelClass = "text-ui-sm font-semibold tracking-[-0.005em] text-ink";
const groupCountClass = "font-mono text-meta text-muted tabular-nums";
const rowClass =
  "flex min-h-[44px] w-full items-center gap-[11px] border-b border-sidebar px-4 py-3 text-left focus-ring transition-colors hover:bg-surface-hover rail:min-h-10 rail:py-2";
const dueClass =
  "w-[46px] flex-none text-right text-ui-xs whitespace-nowrap tabular-nums";

/** "5 across 2 Areas" — how much work, and how far it is spread. */
function countLabel(data: WebFocusDashboardData): string {
  const areas = data.areasWithTasks === 1 ? "Area" : "Areas";
  return `${data.shownTasks} across ${data.areasWithTasks} ${areas}`;
}

/**
 * What the bands left out, as one sentence the Areas in it lead out of. One
 * link per Area rather than one for all of it: a Tasks list is Area-scoped and
 * this rest is not, so a single way in would have to pick an Area silently.
 * The wording follows the date rather than the status, because that is what
 * decided membership. Padding on an inline link enlarges the tap target
 * without adding a line, which is what a list of blocks cost here before.
 */
function RestTasks({ data }: FocusViewProps) {
  if (data.restTasks === 0) {
    return null;
  }
  const one = data.restTasks === 1;
  const last = data.restAreas.length - 1;

  return (
    <p>
      {data.restTasks} further open {one ? "Task is" : "Tasks are"} undated or
      due later:{" "}
      {data.restAreas.map((area, index) => (
        <Fragment key={area.id}>
          {index === 0 ? null : index === last ? " and " : ", "}
          <a
            className="py-1 text-accent-dark underline underline-offset-2 focus-ring"
            href={tasksUrl({ area: area.id })}
          >
            {area.tasks} in {area.name}
          </a>
        </Fragment>
      ))}
      .
    </p>
  );
}

function Filters({ data }: FocusViewProps) {
  return (
    <FilterMenu
      label={data.includePaused ? "With paused" : "Active Areas"}
      options={[
        {
          label: "Active Areas",
          count: data.scopeCounts.active,
          href: focusUrl(),
          active: !data.includePaused,
        },
        {
          label: "Include paused",
          count: data.scopeCounts.withPaused,
          href: focusUrl({ includePaused: true }),
          active: data.includePaused,
        },
      ]}
      title="Areas"
    />
  );
}

function TaskRow({ task }: { task: FocusTask }) {
  return (
    <a
      className={rowClass}
      /*
       * Opening a row switches the Area scope with the selection instead of
       * asking for it first, and carries no filter across: another Area's
       * Source or Project filter would open a Task that is not in the list
       * behind it.
       */
      href={tasksUrl({ area: task.areaId, task: task.id })}
    >
      <span
        aria-hidden="true"
        className="status-marker"
        data-state={task.status}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 roomy:flex-row roomy:items-center roomy:gap-2.5">
        {/* One line with an ellipsis once the row has width to lose; on a
            phone it wraps, because there is no second half to read later. */}
        <span className="text-doc tracking-[-0.006em] text-pretty text-ink roomy:truncate rail:text-ui">
          {task.title}
        </span>
        {/* A mixed-Area list names its Area on every row at every width: it is
            the one thing a reader cannot infer from the list around it. */}
        <span className="flex min-w-0 items-center gap-2 roomy:ml-auto roomy:flex-none">
          {task.project ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-1.5 flex-none rounded-[2px] bg-accent-line"
              />
              <span className="min-w-0 truncate text-ui-sm text-ink-soft">
                {task.project}
              </span>
            </span>
          ) : null}
          <span className="flex-none text-ui-sm whitespace-nowrap text-muted">
            {task.areaName}
          </span>
        </span>
      </span>
      {task.due ? (
        <span className={cx(dueClass, dueTone(task.dueDays))}>
          {dueLabel(task.due)}
        </span>
      ) : null}
    </a>
  );
}

function ProjectRow({ project }: { project: FocusProject }) {
  return (
    <a
      className={cx(rowClass, "rail:min-h-[46px]")}
      href={projectUrl({ area: project.areaId, project: project.id })}
    >
      <span
        aria-hidden="true"
        className="size-3.5 flex-none rounded-[4px] border-[1.5px] border-accent-line"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-doc tracking-[-0.006em] text-pretty text-ink roomy:truncate rail:text-ui">
          {project.title}
        </span>
        <span className="min-w-0 text-ui-sm text-pretty text-muted roomy:truncate">
          Next: {project.nextTask}
        </span>
      </span>
      <span className="flex flex-none items-center gap-2">
        <span className="flex-none text-ui-sm whitespace-nowrap text-ink-soft">
          {project.openTasks} open
        </span>
        <span className="flex-none text-ui-sm whitespace-nowrap text-muted">
          {project.areaName}
        </span>
      </span>
      {project.due ? (
        <span className={cx(dueClass, dueTone(project.dueDays))}>
          {dueLabel(project.due)}
        </span>
      ) : null}
    </a>
  );
}

export function FocusView({ data }: FocusViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-focus-view="">
      <header className={SHELL.viewHeader}>
        <div className={SHELL.viewHeaderMain}>
          <h1 className={SHELL.viewTitle}>Focus</h1>
          <Filters data={data} />
        </div>
        <div className={SHELL.viewHeaderSide}>
          <span className={cx(SHELL.viewCount, "text-muted")}>
            {countLabel(data)}
          </span>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto bg-panel">
        {data.bands.map((band) => (
          <div key={band.id}>
            <div className={groupHeaderClass}>
              <span
                aria-hidden="true"
                className="status-marker"
                data-state={BAND_MARKERS[band.id]}
              />
              <span className={groupLabelClass}>{band.label}</span>
              <span className={groupCountClass}>{band.tasks.length}</span>
              {band.note ? (
                <span className="text-ui-sm text-muted">{band.note}</span>
              ) : null}
            </div>
            {band.tasks.map((task) => (
              <TaskRow key={`${task.areaId}:${task.id}`} task={task} />
            ))}
          </div>
        ))}

        {data.shownTasks === 0 ? (
          <p className="px-4 py-[18px] text-ui-md text-muted">
            Nothing urgent, nothing in progress, nothing due within{" "}
            {FOCUS_WINDOW_DAYS} days.
          </p>
        ) : null}

        {/* An overview of Tasks and Projects cannot put the Projects in a
            sidebar, so they are a band in the same column — and they follow
            the same rule as the bands above: no Projects, no heading. A "0"
            over nothing would only restate the emptiness below it. */}
        {data.projects.length > 0 ? (
          <>
            <div className={cx(groupHeaderClass, "border-t border-line")}>
              <span
                aria-hidden="true"
                className="size-3 flex-none rounded-[3px] border-[1.5px] border-accent-line"
              />
              <span className={groupLabelClass}>Active Projects</span>
              <span className={groupCountClass}>{data.projects.length}</span>
            </div>
            {data.projects.map((project) => (
              <ProjectRow
                key={`${project.areaId}:${project.id}`}
                project={project}
              />
            ))}
          </>
        ) : null}

        {/* What the view left out, in the order of the sections above it. */}
        {data.restTasks > 0 || data.projectsOutOfFocus > 0 ? (
          <div className="flex flex-col gap-1.5 px-4 pt-[15px] pb-6 text-ui-sm/normal text-pretty text-muted">
            <RestTasks data={data} />
            {data.projectsOutOfFocus > 0 ? (
              <p>
                {data.projectsOutOfFocus}{" "}
                {data.projectsOutOfFocus === 1
                  ? "active Project has"
                  : "active Projects have"}{" "}
                nothing in Focus.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
