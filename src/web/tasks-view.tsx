import {
  taskLifecycleFilterLabel,
  taskPriorityLabel,
  taskStatusLabel,
  taskStatusMatches,
} from "../core/task-model";
import type { WebDocumentRef, WebTasksDashboardData } from "./data";
import { FilterMenu } from "./filters";
import { formatDue } from "./format";
import { CloseIcon } from "./icons";
import { listLabels } from "./kinds";
import { groupWorkItems, workItemGroup } from "./model";
import { routes } from "./routes";
import { cx, FILTER, SHELL } from "./ui";
import { tasksUrl } from "./urls";
import type { WebWorkItem } from "./work-items";

interface TasksViewProps {
  data: WebTasksDashboardData;
}

const detailTitleClass =
  "text-head leading-[1.35] font-semibold tracking-[-0.018em] text-pretty text-ink";
const detailTextClass = "mt-2.5 text-ui-md leading-[1.6] text-ink-soft";
const propertiesListClass = "mt-[22px] flex flex-col gap-[9px]";
const propertyRowClass = "flex items-start gap-3";
const propertyLabelClass = "w-[92px] flex-none text-ui-sm text-muted";
const propertyValueClass = "min-w-0 flex-1 text-ui-md text-ink";
const noCheckoutRepositoryClass = "font-mono text-ui-xs";

function TaskResources({
  areaId,
  documents,
}: {
  areaId: string;
  documents: WebDocumentRef[];
}) {
  const resources = documents.filter((linked) => linked.kind === "resource");
  if (resources.length === 0) {
    return null;
  }
  const labels = listLabels(resources);
  return (
    <>
      <p className="mt-[22px] mb-[7px] text-ui-xs font-semibold tracking-[0.01em] text-muted">
        Resources
      </p>
      {resources.map((resource) => (
        <a
          className="-ml-2 flex min-h-[30px] w-full items-center gap-2.5 rounded-control px-2 text-left hover:bg-surface-hover"
          href={routes.document(areaId, resource.relativePath)}
          key={resource.relativePath}
        >
          <span className="min-w-0 flex-1 truncate text-ui-md text-ink">
            {labels.get(resource.relativePath)}
          </span>
        </a>
      ))}
    </>
  );
}

/** In the detail the full identity is worth the space: it identifies the Task
 * file even when its descriptive filename suffix changes. */
function detailRef(item: WebWorkItem): string {
  return item.task.id;
}

/**
 * "8 open in Product" — how much work, of which kind, and where. Once the
 * Status filter lets completed work in, the word "open" would be a lie, so it
 * drops out with the filter that earned it.
 */
function countLabel(data: WebTasksDashboardData): string {
  const count = data.items.length;
  const lifecycle = data.status === "all" ? "" : `${data.status} `;
  const area = data.areaNavigation.find(
    (entry) => entry.id === data.selectedArea,
  );
  return area
    ? `${count} ${lifecycle}in ${area.name}`
    : `${count} ${lifecycle}${count === 1 ? "Task" : "Tasks"}`;
}

function Filters({ data }: TasksViewProps) {
  const projectTitles = new Map(
    data.projects.map((project) => [project.id, project.title]),
  );

  return (
    <div className={FILTER.bar} data-work-filters="">
      <FilterMenu
        label={taskLifecycleFilterLabel(data.status)}
        options={[
          {
            label: "Open",
            href: tasksUrl({
              area: data.selectedArea,
              status: "open",
              project: data.filter.project,
              repository: data.filter.repository,
            }),
            active: data.status === "open",
          },
          {
            label: "Closed",
            href: tasksUrl({
              area: data.selectedArea,
              status: "closed",
              project: data.filter.project,
              repository: data.filter.repository,
            }),
            active: data.status === "closed",
          },
          {
            label: "All statuses",
            href: tasksUrl({
              area: data.selectedArea,
              status: "all",
              project: data.filter.project,
              repository: data.filter.repository,
            }),
            active: data.status === "all",
          },
        ]}
        title="Status"
      />
      {data.projects.length > 0 ? (
        <FilterMenu
          label={
            data.filter.project
              ? (projectTitles.get(data.filter.project) ?? data.filter.project)
              : "Project"
          }
          options={[
            {
              label: "Any Project",
              href: tasksUrl({
                area: data.selectedArea,
                status: data.status,
                repository: data.filter.repository,
              }),
              active: data.filter.project === undefined,
            },
            ...data.projects.map((project) => ({
              label: project.title,
              count: project.count,
              href: tasksUrl({
                area: data.selectedArea,
                status: data.status,
                project: project.id,
                repository: data.filter.repository,
              }),
              active: data.filter.project === project.id,
            })),
          ]}
          title="Project"
        />
      ) : null}
    </div>
  );
}

function Row({
  data,
  item,
}: {
  data: TasksViewProps["data"];
  item: WebWorkItem;
}) {
  const group = workItemGroup(item);
  const due = formatDue(item.task.due);
  // A Task id is unique inside its Area, so identity is area plus id.
  const active =
    data.selected?.item.id === item.id &&
    data.selected.item.areaId === item.areaId;
  const repository = item.task.repository;
  const projectTitle = item.task.project
    ? (data.projects.find((project) => project.id === item.task.project)
        ?.title ?? item.task.project)
    : undefined;

  return (
    <a
      className={cx(
        "flex min-h-[44px] w-full items-center gap-[11px] border-b border-sidebar px-4 py-3 text-left focus-ring transition-colors hover:bg-surface-hover rail:min-h-10 rail:py-2",
        active ? "bg-accent-soft" : undefined,
      )}
      href={tasksUrl({
        area: item.areaId,
        task: active ? undefined : item.id,
        status: data.status,
        project: data.filter.project,
        repository: data.filter.repository,
      })}
      data-active={String(active)}
      data-work-item={`${item.areaId}:${item.id}`}
      data-work-row=""
      {...(active ? { "aria-current": "page" as const } : {})}
    >
      <span aria-hidden="true" className="status-marker" data-state={group} />
      <span
        className={
          taskStatusMatches(item.status, "closed")
            ? "min-w-0 flex-1 truncate text-doc tracking-[-0.006em] text-muted line-through rail:text-ui"
            : "min-w-0 flex-1 truncate text-doc tracking-[-0.006em] text-ink rail:text-ui"
        }
      >
        {item.title}
      </span>
      <span
        className={cx(
          "hidden min-w-0 flex-none items-center justify-end gap-2 split:flex",
          data.selected ? "split:hidden min-[1480px]:flex" : undefined,
        )}
      >
        {projectTitle ? (
          <span className="hidden max-w-[220px] flex-none items-center gap-1.5 full:flex">
            <span
              aria-hidden="true"
              className="size-1.5 flex-none rounded-[2px] bg-accent-line"
            />
            <span className="min-w-0 truncate text-ui-sm text-ink-soft">
              {projectTitle}
            </span>
          </span>
        ) : null}
        {data.selectedArea ? null : (
          <span className="flex-none text-ui-sm whitespace-nowrap text-ink-soft">
            {item.areaName}
          </span>
        )}
        {repository ? (
          <span className="max-w-[180px] flex-none truncate rounded-[4px] bg-sidebar px-1.5 py-0.5 font-mono text-ui-xs text-ink-soft">
            {repository}
          </span>
        ) : null}
      </span>
      {due.label ? (
        <span
          className={cx(
            "w-[46px] flex-none text-right text-ui-xs whitespace-nowrap tabular-nums",
            due.tone,
          )}
        >
          {due.label}
        </span>
      ) : null}
    </a>
  );
}

function Detail({ data }: TasksViewProps) {
  const selected = data.selected;
  if (!selected) {
    return <div className="contents" data-work-detail="" />;
  }

  const { item } = selected;
  const due = formatDue(item.task.due);
  const properties = [
    {
      label: "Status",
      value: taskStatusLabel(item.status),
      peek: true,
    },
    ...(item.task.priority
      ? [
          {
            label: "Priority",
            value: taskPriorityLabel(item.task.priority),
            peek: false,
          },
        ]
      : []),
    ...(item.task.project
      ? [
          {
            label: "Project",
            value:
              data.projects.find((project) => project.id === item.task.project)
                ?.title ?? item.task.project,
            peek: true,
            href: routes.project(item.areaId, item.task.project),
          },
        ]
      : []),
    { label: "Area", value: item.areaName, peek: false },
    ...(item.task.repository
      ? [{ label: "Repository", value: item.task.repository, peek: false }]
      : []),
    ...(due.label ? [{ label: "Due", value: due.label, peek: true }] : []),
  ];
  return (
    <div className="contents" data-work-detail="">
      <aside className="flex flex-none flex-col border-line bg-panel rail:w-[392px] rail:border-l">
        <div className="flex h-10 flex-none items-center justify-between gap-2 border-b border-line py-0 pr-2.5 pl-3.5">
          <span className="font-mono text-meta text-muted">
            {detailRef(item)}
          </span>
          <span className="flex items-center gap-0.5">
            <button
              aria-label="Enlarge Task"
              className="flex size-6 items-center justify-center rounded-[5px] text-muted hover:bg-surface-hover"
              data-peek-open=""
              hidden
              type="button"
            >
              <span aria-hidden="true">⤢</span>
            </button>
            <a
              aria-label="Close Task"
              className="flex size-6 items-center justify-center rounded-[5px] text-muted focus-ring hover:bg-surface-hover"
              href={tasksUrl({
                area: data.selectedArea,
                status: data.status,
                project: data.filter.project,
                repository: data.filter.repository,
              })}
            >
              <CloseIcon />
            </a>
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-5 pb-10">
          <a
            className={SHELL.backLink}
            href={tasksUrl({
              area: data.selectedArea,
              status: data.status,
              project: data.filter.project,
              repository: data.filter.repository,
            })}
          >
            <span aria-hidden="true">‹</span> All Tasks
          </a>
          <h2
            className={detailTitleClass}
            data-navigation-focus=""
            tabIndex={-1}
          >
            {item.title}
          </h2>
          {item.task.description ? (
            <p className={detailTextClass}>{item.task.description}</p>
          ) : null}

          <div className={propertiesListClass}>
            {properties.map((property) => (
              <div className={propertyRowClass} key={property.label}>
                <span className={propertyLabelClass}>{property.label}</span>
                {property.href ? (
                  <a
                    className="min-w-0 flex-1 text-ui-md text-accent-dark focus-ring"
                    href={property.href}
                  >
                    {property.value}
                  </a>
                ) : (
                  <span className={propertyValueClass}>{property.value}</span>
                )}
              </div>
            ))}
          </div>

          {selected.repositoryWithoutCheckout ? (
            <p className="mt-[22px] text-ui-sm/normal text-muted">
              No local checkout configured for{" "}
              <span className={noCheckoutRepositoryClass}>
                {selected.repositoryWithoutCheckout}
              </span>
              .
            </p>
          ) : null}

          {item.action?.kind === "conductor" ? (
            <a
              className="mt-[22px] inline-flex h-7 items-center gap-1.5 rounded-control border border-accent bg-accent px-2.5 text-ui-sm font-[550] whitespace-nowrap text-white focus-ring hover:border-accent-dark hover:bg-accent-dark"
              href={item.action.url}
            >
              {item.action.label} <span aria-hidden="true">↗</span>
            </a>
          ) : null}

          <TaskResources areaId={item.areaId} documents={selected.documents} />
        </div>
      </aside>
      <dialog
        aria-labelledby="dokito-task-dialog-title"
        className="dokito-task-dialog"
        data-peek-dialog=""
      >
        <div className="flex h-[42px] flex-none items-center justify-between border-b border-line pr-3 pl-4 text-ui-xs text-muted">
          <span>Task</span>
          <form method="dialog">
            <button
              className="flex h-7 items-center rounded-control border border-line bg-panel px-2.5 text-ui-sm text-ink focus-ring hover:border-line-strong hover:bg-surface-hover"
              type="submit"
            >
              Close
            </button>
          </form>
        </div>
        <div className="min-h-0 overflow-y-auto px-[26px] pt-6 pb-[30px]">
          <h2 className={detailTitleClass} id="dokito-task-dialog-title">
            {item.title}
          </h2>
          {item.task.description ? (
            <p className={detailTextClass}>{item.task.description}</p>
          ) : null}
          <div className={propertiesListClass}>
            {properties
              .filter((property) => property.peek)
              .map((property) => (
                <div className={propertyRowClass} key={property.label}>
                  <span className={propertyLabelClass}>{property.label}</span>
                  <span className={propertyValueClass}>{property.value}</span>
                </div>
              ))}
          </div>
        </div>
      </dialog>
    </div>
  );
}

export function TasksView({ data }: TasksViewProps) {
  const groups = groupWorkItems(data.items);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-navigation-key={tasksUrl({
        area: data.selectedArea,
        status: data.status,
        project: data.filter.project,
        repository: data.filter.repository,
      })}
      data-tasks-view=""
    >
      <header className={SHELL.viewHeader}>
        <div className={SHELL.viewHeaderMain}>
          <h1 className={SHELL.viewTitle}>Tasks</h1>
          <Filters data={data} />
        </div>
        <div className={SHELL.viewHeaderSide}>
          <span
            className={cx(SHELL.viewCount, "text-muted")}
            data-work-count=""
          >
            {countLabel(data)}
          </span>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col rail:flex-row">
        <div
          className={cx(
            "min-h-0 flex-1 overflow-y-auto bg-panel",
            data.selected ? "hidden rail:block" : undefined,
          )}
          data-work-list=""
        >
          {groups.map((group) => (
            <div key={group.group}>
              <div className="sticky top-0 z-2 flex h-8 items-center gap-2 border-b border-line bg-canvas px-4">
                <span
                  aria-hidden="true"
                  className="status-marker"
                  data-state={group.group}
                />
                <span className="text-ui-sm font-semibold tracking-[-0.005em] text-ink">
                  {group.label}
                </span>
                <span className="font-mono text-meta text-muted tabular-nums">
                  {group.items.length}
                </span>
              </div>
              {group.items.map((item) => (
                <Row
                  data={data}
                  item={item}
                  key={`${item.areaId}:${item.id}`}
                />
              ))}
            </div>
          ))}
          {data.items.length === 0 ? (
            <p className="mx-4 my-3.5 rounded-control border border-dashed border-line-strong px-3.5 py-3 text-ui-md text-muted">
              No Task matches these filters.{" "}
              <a
                className="text-accent-dark underline"
                href={tasksUrl({
                  area: data.selectedArea,
                  status: "open",
                })}
              >
                Reset filters
              </a>
            </p>
          ) : null}
        </div>
        <Detail data={data} />
      </div>
    </div>
  );
}
