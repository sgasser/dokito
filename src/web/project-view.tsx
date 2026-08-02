import { createDocumentLookup, resolveLink } from "../core/links";
import { documentBody } from "../core/markdown";
import { PROJECT_STATUS } from "../core/project-model";
import { taskStatusMatches } from "../core/task-model";
import type { WebDocumentRef, WebProjectDashboardData } from "./data";
import { formatDue } from "./format";
import { BackIcon, ChevronIcon } from "./icons";
import { resourceExplorerLabel } from "./kinds";
import { MarkdownContent, markdownImageHref } from "./markdown";
import { workItemGroup } from "./model";
import { routes } from "./routes";
import { cx, SHELL } from "./ui";
import { projectsUrl, resourcesUrl } from "./urls";
import type { WebWorkItem } from "./work-items";

interface ProjectViewProps {
  data: WebProjectDashboardData;
}

const sectionLabelClass =
  "text-ui-xs font-semibold tracking-[0.01em] text-muted";
const mobilePropertyRowClass = "flex min-h-9 items-start gap-3.5 py-1.5";
const mobilePropertyLabelClass = "w-[104px] flex-none text-[13.5px] text-muted";
const mobilePropertyValueClass = "min-w-0 flex-1 text-[14px] text-ink";
const asideRowClass = "flex items-start gap-3";
const asideLabelClass = "w-24 flex-none pt-px text-ui-sm text-muted";
const asideValueClass = "min-w-0 flex-1 text-ui-md text-ink";

function TaskRow({
  hidden = false,
  item,
}: {
  hidden?: boolean;
  item: WebWorkItem;
}) {
  const closed = taskStatusMatches(item.status, "closed");
  const due = formatDue(item.task.due);

  return (
    <a
      className="flex min-h-11 w-full items-center gap-[11px] rounded-control text-left hover:bg-surface-hover rail:-ml-2 rail:h-[34px] rail:min-h-0 rail:gap-2.5 rail:px-2"
      data-project-task-completed={closed ? "" : undefined}
      hidden={hidden}
      href={routes.task(item.areaId, item.id)}
    >
      <span
        aria-hidden="true"
        className="status-marker"
        data-state={workItemGroup(item)}
      />
      <span
        className={
          closed
            ? "min-w-0 flex-1 truncate text-[14.5px] text-muted line-through rail:text-ui"
            : "min-w-0 flex-1 truncate text-[14.5px] text-ink rail:text-ui"
        }
      >
        {item.title}
      </span>
      <span
        className={cx(
          "flex-none text-[13px] text-muted tabular-nums rail:text-ui-xs",
          due.tone,
        )}
      >
        {due.label}
      </span>
    </a>
  );
}

function ProjectDetails({
  documents,
  project,
  tasks,
}: {
  documents: WebDocumentRef[];
  project: WebProjectDashboardData["project"];
  tasks: WebWorkItem[];
}) {
  const open = tasks.filter((item) => taskStatusMatches(item.status, "open"));
  const closed = tasks.filter((item) =>
    taskStatusMatches(item.status, "closed"),
  );
  const resources = documents.filter((linked) => linked.kind === "resource");
  if (tasks.length === 0 && resources.length === 0) {
    return null;
  }

  return (
    <>
      <div className="mt-4 rail:mt-[34px]" hidden={tasks.length === 0}>
        <div className="flex items-baseline justify-between gap-4">
          <p className={sectionLabelClass}>
            Open Tasks {open.length > 0 ? `(${open.length})` : ""}
          </p>
          {closed.length > 0 ? (
            <button
              aria-controls={`project-tasks-${project.id}`}
              aria-expanded="false"
              className="border-0 bg-transparent p-0 text-ui-xs text-accent-dark focus-ring"
              data-completed-label={`${closed.length} completed`}
              data-project-tasks-toggle=""
              hidden
              type="button"
            >
              {closed.length} completed
            </button>
          ) : null}
        </div>
        <div
          className="mt-1.5 flex flex-col gap-px"
          id={`project-tasks-${project.id}`}
        >
          {open.map((item) => (
            <TaskRow item={item} key={item.id} />
          ))}
          {closed.map((item) => (
            <TaskRow hidden item={item} key={item.id} />
          ))}
        </div>
      </div>

      <div className="mt-4 rail:mt-[30px]" hidden={resources.length === 0}>
        <p className={cx(sectionLabelClass, "mb-2")}>Resources</p>
        {resources.map((resource) => (
          <a
            className="flex min-h-11 w-full items-center gap-3 rounded-control text-left hover:bg-surface-hover rail:-ml-2 rail:min-h-8 rail:gap-2.5 rail:px-2"
            href={routes.document(project.areaId, resource.relativePath)}
            key={resource.relativePath}
          >
            <span className="min-w-0 flex-1 truncate text-[14.5px] text-ink rail:text-ui">
              {resourceExplorerLabel(resource.relativePath)}
            </span>
            <span className="hidden flex-none font-mono text-meta text-muted roomy:block">
              {resource.relativePath.replace(/\.md$/, "")}
            </span>
          </a>
        ))}
      </div>
    </>
  );
}

function hasProjectBody(content: string, summaryParagraphs: number): boolean {
  let skipped = 0;
  const structural = /^(?:#{2,6}\s|[-*+]\s|>\s|\d+[.)]\s|\||```|~~~|---\s*$)/;

  for (const block of content.split(/\r?\n\s*\r?\n/)) {
    const value = block.trim();
    if (!value) {
      continue;
    }
    if (structural.test(value)) {
      return true;
    }
    if (skipped < summaryParagraphs) {
      skipped += 1;
      continue;
    }
    return true;
  }
  return false;
}

export function ProjectView({ data }: ProjectViewProps) {
  const { project } = data;
  const content = documentBody(project.content);
  const documentLookup = createDocumentLookup(data.documents);
  const summaryParagraphs =
    Number(project.outcome !== undefined) + Number(project.note !== undefined);
  const showsBody = hasProjectBody(content, summaryParagraphs);
  const due = formatDue(project.due);
  /* The rail contains only properties not already stated by the Task list. */
  const properties = [
    { label: "Status", value: PROJECT_STATUS[project.status].label },
    { label: "Area", value: project.areaName },
    { label: "Target date", value: due.label || "—" },
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header
        className={cx(
          SHELL.viewHeader,
          "h-14 min-h-14 bg-canvas pr-3 pl-0 rail:h-auto rail:min-h-12 rail:bg-panel rail:px-4",
        )}
      >
        <div className="flex min-w-0 items-center gap-0.5 rail:gap-2.5">
          <a
            aria-label="Back to Projects"
            className="flex size-11 flex-none items-center justify-center rounded-[8px] text-ink-soft hover:bg-rail rail:size-6 rail:rounded-[5px]"
            href={projectsUrl({ area: data.selectedArea })}
          >
            <BackIcon />
          </a>
          <span className="text-doc font-[560] tracking-[-0.01em] text-ink rail:text-ui-md rail:font-normal rail:tracking-normal rail:text-muted">
            Projects
          </span>
          <span
            aria-hidden="true"
            className="hidden text-line-strong rail:inline"
          >
            /
          </span>
          <h1 className={cx(SHELL.viewTitle, "hidden truncate rail:block")}>
            {project.title}
          </h1>
        </div>
        <div className={SHELL.viewHeaderSide}>
          <span
            className={cx(
              "font-mono text-ui-sm whitespace-nowrap tabular-nums text-muted rail:hidden",
              due.tone,
            )}
          >
            {due.label}
          </span>
          <span
            className={cx(
              "hidden flex-none text-ui-sm whitespace-nowrap tabular-nums rail:block",
              due.tone ?? "text-muted",
            )}
          >
            {PROJECT_STATUS[project.status].label}
            {due.label ? ` · ${due.label}` : ""}
          </span>
        </div>
      </header>

      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto split:flex-row"
        data-project-detail=""
      >
        <div className="min-w-0 flex-1 bg-panel px-4 pt-5 pb-10 rail:px-8 rail:pt-[30px] rail:pb-[60px]">
          <div className="max-w-[640px]">
            <h1 className="text-[21px]/[1.25] font-[630] tracking-[-0.02em] text-pretty text-ink rail:hidden">
              {project.title}
            </h1>
            <div>
              <p className={cx(sectionLabelClass, "hidden rail:block")}>
                Outcome
              </p>
              <p className="mt-2.5 text-[16px]/[1.55] text-pretty text-prose rail:mt-2 rail:text-head/normal rail:font-medium rail:tracking-[-0.014em] rail:text-ink">
                {project.outcome ?? "No outcome written yet."}
              </p>
              {project.note ? (
                <p className="mt-3.5 text-[15px]/[1.55] text-ink-soft rail:text-ui-lg rail:leading-[1.6]">
                  {project.note}
                </p>
              ) : null}
            </div>

            <div
              className="mt-4 border-t border-line split:hidden"
              data-project-mobile-properties=""
            >
              {properties.map((property) => (
                <div className={mobilePropertyRowClass} key={property.label}>
                  <span className={mobilePropertyLabelClass}>
                    {property.label}
                  </span>
                  <span className={mobilePropertyValueClass}>
                    {property.value}
                  </span>
                </div>
              ))}
              <div className={mobilePropertyRowClass}>
                <span className={mobilePropertyLabelClass}>Repositories</span>
                <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                  {project.repositories.length > 0 ? (
                    project.repositories.map((repository) => (
                      <span
                        className="rounded-[4px] bg-rail px-1.5 py-0.5 font-mono text-meta text-ink-soft"
                        key={repository}
                      >
                        {repository}
                      </span>
                    ))
                  ) : (
                    <span className={mobilePropertyValueClass}>None</span>
                  )}
                </span>
              </div>
            </div>

            <ProjectDetails
              documents={data.documents}
              project={project}
              tasks={data.tasks}
            />

            {showsBody ? (
              <div
                className="mt-[22px] border-t border-line pt-[18px] rail:mt-[34px] rail:pt-5"
                data-project-body=""
              >
                <div className="flex items-baseline justify-between gap-4">
                  <p className="font-mono text-[12px] text-muted rail:text-ui-xs">
                    {project.path}
                  </p>
                  <button
                    aria-controls={`project-body-${project.id}`}
                    aria-expanded="false"
                    className="hidden border-0 bg-transparent p-0 text-ui-xs text-accent-dark focus-ring rail:block"
                    data-project-body-toggle=""
                    hidden
                    type="button"
                  >
                    Show all
                  </button>
                </div>
                <div
                  className="relative mt-3.5 data-[collapsed=true]:max-h-[310px] data-[collapsed=true]:overflow-hidden rail:data-[collapsed=true]:max-h-[190px]"
                  data-project-body-viewport=""
                  id={`project-body-${project.id}`}
                >
                  <MarkdownContent
                    className="project-body-prose max-w-none"
                    content={content}
                    resolveDocumentHref={(target) => {
                      const linked = resolveLink(
                        project.path,
                        target,
                        data.documents,
                        documentLookup,
                      );
                      return linked
                        ? resourcesUrl({
                            area: project.areaId,
                            document: linked.relativePath,
                          })
                        : undefined;
                    }}
                    resolveImageSrc={(target) =>
                      markdownImageHref(project.areaId, project.path, target)
                    }
                    skipParagraphs={summaryParagraphs}
                  />
                  <div
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-b from-transparent to-panel"
                    data-project-body-fade=""
                    hidden
                  />
                </div>
                <button
                  aria-controls={`project-body-${project.id}`}
                  aria-expanded="false"
                  className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[8px] border border-line bg-panel px-2.5 text-[14.5px] text-ink focus-ring hover:bg-surface-hover rail:mt-1 rail:h-7 rail:min-h-0 rail:w-auto rail:justify-start rail:rounded-control rail:text-ui-sm"
                  data-project-body-more=""
                  hidden
                  type="button"
                >
                  <ChevronIcon />
                  Read the rest of the file
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <aside className="hidden flex-none border-line bg-canvas px-5 pt-6 pb-14 split:block split:w-[344px] split:border-l">
          <div className="flex flex-col gap-[11px]">
            {properties.map((property) => (
              <div className={asideRowClass} key={property.label}>
                <span className={asideLabelClass}>{property.label}</span>
                <span className={asideValueClass}>{property.value}</span>
              </div>
            ))}
            <div className={asideRowClass}>
              <span className={asideLabelClass}>Repositories</span>
              <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                {project.repositories.length > 0 ? (
                  project.repositories.map((repository) => (
                    <span
                      className="rounded-[4px] bg-rail px-1.5 py-0.5 font-mono text-meta text-ink-soft"
                      key={repository}
                    >
                      {repository}
                    </span>
                  ))
                ) : (
                  <span className={asideValueClass}>None</span>
                )}
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
