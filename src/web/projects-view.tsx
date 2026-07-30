import { PROJECT_STATUS, type ProjectStatus } from "../core/project-model";
import type { WebProjectSummary, WebProjectsDashboardData } from "./data";
import { FilterMenu } from "./filters";
import { formatDue } from "./format";
import { cx, FILTER, SHELL } from "./ui";
import { projectsUrl, projectUrl } from "./urls";

interface ProjectsViewProps {
  data: WebProjectsDashboardData;
}

const STATUS_ORDER: readonly ProjectStatus[] = [
  "active",
  "planned",
  "done",
  "cancelled",
];

const STATUS_DOTS: Record<ProjectStatus, string> = {
  active: "bg-accent",
  planned: "bg-line-strong",
  done: "bg-success",
  cancelled: "bg-line-strong",
};

function Filters({ data }: ProjectsViewProps) {
  return (
    <div className={FILTER.bar}>
      <FilterMenu
        label={data.includeClosed ? "All statuses" : "Open"}
        options={[
          {
            label: "Active and Planned",
            href: projectsUrl({
              area: data.selectedArea,
              repository: data.repositoryFilter,
            }),
            active: !data.includeClosed,
          },
          {
            label: "Include Done and Cancelled",
            href: projectsUrl({
              area: data.selectedArea,
              repository: data.repositoryFilter,
              includeClosed: true,
            }),
            active: data.includeClosed,
          },
        ]}
        title="Status"
      />
      {data.repositories.length > 0 ? (
        <FilterMenu
          label={data.repositoryFilter ?? "Repository"}
          options={[
            {
              label: "Any Repository",
              href: projectsUrl({
                area: data.selectedArea,
                includeClosed: data.includeClosed,
              }),
              active: data.repositoryFilter === undefined,
            },
            ...data.repositories.map((repository) => ({
              label: repository.label,
              count: repository.count,
              href: projectsUrl({
                area: data.selectedArea,
                repository: repository.value,
                includeClosed: data.includeClosed,
              }),
              active: data.repositoryFilter === repository.value,
            })),
          ]}
          title="Repository"
        />
      ) : null}
    </div>
  );
}

function Row({ project }: { project: WebProjectSummary }) {
  const due = formatDue(project.due);
  return (
    <a
      className="flex w-full items-center gap-[18px] border-b border-sidebar px-4 py-3 text-left hover:bg-surface-hover rail:py-[9px]"
      href={projectUrl({
        area: project.areaId,
        project: project.id,
      })}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-doc font-[550] tracking-[-0.008em] text-ink rail:text-ui">
          {project.title}
        </span>
        <span className="truncate text-ui-sm leading-[1.4] text-muted">
          {project.outcome ?? "No outcome written yet."}
        </span>
      </span>
      <span className="hidden w-[210px] flex-none justify-end gap-1 overflow-hidden full:flex">
        {project.repositories.map((repository) => (
          <span
            className="rounded-[4px] bg-sidebar px-1.5 py-0.5 font-mono text-meta whitespace-nowrap text-ink-soft"
            key={repository}
          >
            {repository}
          </span>
        ))}
      </span>
      <span className="hidden w-[220px] flex-none truncate text-right text-ui-sm text-ink-soft split:block">
        {project.nextTask ? `Next: ${project.nextTask.title}` : "—"}
      </span>
      <span className="w-[66px] flex-none text-right text-ui-sm text-ink-soft tabular-nums">
        {project.openTasks} open
      </span>
      <span
        className={cx(
          "w-[62px] flex-none text-right text-ui-sm tabular-nums",
          due.tone,
        )}
      >
        {due.label || "—"}
      </span>
    </a>
  );
}

export function ProjectsView({ data }: ProjectsViewProps) {
  const groups = STATUS_ORDER.flatMap((status) => {
    const projects = data.projects.filter(
      (project) => project.status === status,
    );
    return projects.length > 0 ? [{ status, projects }] : [];
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className={SHELL.viewHeader}>
        <div className={SHELL.viewHeaderMain}>
          <h1 className={SHELL.viewTitle}>Projects</h1>
          <Filters data={data} />
        </div>
        <div className={SHELL.viewHeaderSide}>
          <span className={cx(SHELL.viewCount, "text-muted")}>
            {groups
              .map(
                ({ status, projects }) =>
                  `${projects.length} ${PROJECT_STATUS[status].label.toLocaleLowerCase()}`,
              )
              .join(" · ") || "No Projects"}
          </span>
        </div>
      </header>
      <div
        className="min-h-0 flex-1 overflow-y-auto bg-panel"
        data-work-list=""
      >
        {groups.map(({ status, projects }) => (
          <div key={status}>
            <div className="sticky top-0 z-2 flex h-8 items-center gap-2 border-b border-line bg-canvas px-4">
              <span
                aria-hidden="true"
                className={cx(
                  "size-[7px] flex-none rounded-full",
                  STATUS_DOTS[status],
                )}
              />
              <span className="text-ui-sm font-semibold tracking-[-0.005em] text-ink">
                {PROJECT_STATUS[status].label}
              </span>
              <span className="font-mono text-meta text-muted tabular-nums">
                {projects.length}
              </span>
            </div>
            {projects.map((project) => (
              <Row key={`${project.areaId}:${project.id}`} project={project} />
            ))}
          </div>
        ))}
        {data.projects.length === 0 ? (
          <p className="mx-4 my-3.5 rounded-control border border-dashed border-line-strong px-3.5 py-3 text-ui-md text-muted">
            No Project matches these filters.{" "}
            <a
              className="text-accent-dark underline"
              href={projectsUrl({
                area: data.selectedArea,
                includeClosed: true,
              })}
            >
              Reset filters
            </a>
          </p>
        ) : null}
      </div>
    </div>
  );
}
