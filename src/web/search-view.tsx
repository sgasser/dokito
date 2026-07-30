import { documentBody } from "../core/markdown";
import { documentStateLabel } from "../core/state-model";
import type {
  WebSearchDashboardData,
  WebSearchHit,
  WebSearchType,
} from "./data";
import { FilterMenu } from "./filters";
import { previewBlocks, splitSnippet } from "./format";
import { SearchIcon } from "./icons";
import { KIND_LABELS } from "./kinds";
import { routes } from "./routes";
import { cx, FILTER, SHELL } from "./ui";
import { resourcesUrl, searchUrl } from "./urls";

interface SearchViewProps {
  data: WebSearchDashboardData;
}

const TYPE_ORDER: readonly WebSearchType[] = ["tasks", "projects", "resources"];

const TYPE_LABELS: Record<WebSearchType, string> = {
  tasks: "Tasks",
  projects: "Projects",
  resources: "Resources",
};

const previewClass = "min-h-0 min-w-0 flex-1 overflow-y-auto bg-panel";
const previewBodyClass = "max-w-[660px] px-5 pt-[34px] pb-20 roomy:px-9";
const previewKindClass = "text-ui-xs text-muted";
const previewTextClass =
  "mb-3 rounded-[4px] text-[14.5px] leading-[1.6] text-prose";
const previewMatchedClass = "bg-accent-soft";
const blankClass = "px-3.5 py-4 text-ui-md/normal text-muted";

function Mark({ hit }: { hit: WebSearchHit }) {
  const parts = splitSnippet(hit.snippet, hit.matchStart, hit.matchLength);
  return (
    <span className="mt-1 line-clamp-2 text-ui-md/normal text-ink-soft">
      {parts.before}
      {parts.match ? (
        <mark className="rounded-[3px] bg-accent-soft text-accent-dark">
          {parts.match}
        </mark>
      ) : null}
      {parts.after}
    </span>
  );
}

function SearchPreview({ data }: SearchViewProps) {
  const preview = data.preview;
  if (!preview) {
    return (
      <div
        className={previewClass}
        data-preview-requested={String(data.previewRequested)}
        data-search-preview=""
      >
        <div className={previewBodyClass}>
          <p className={previewKindClass}>
            {data.query.length > 0
              ? "Select a result to preview it."
              : "Type to search Resources, Projects and Tasks."}
          </p>
        </div>
      </div>
    );
  }

  const { document, hit } = preview;
  const blocks = previewBlocks(documentBody(document.content), data.query);
  const previewLabel = [
    document.kind === "resource" ? "" : KIND_LABELS[document.kind],
    document.state === "active" ? "" : documentStateLabel(document.state),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={cx(
        previewClass,
        data.previewRequested ? undefined : "hidden rail:block",
      )}
      data-preview-requested={String(data.previewRequested)}
      data-search-preview=""
    >
      <div className={previewBodyClass}>
        <a
          className={SHELL.backLink}
          href={searchUrl({
            area: data.selectedArea,
            query: data.query,
            type: data.typeFilter,
            sort: data.sort,
          })}
        >
          <span aria-hidden="true">‹</span> All results
        </a>
        {/* Named only where kind or state distinguishes this result. */}
        {previewLabel ? (
          <p className={previewKindClass}>{previewLabel}</p>
        ) : null}
        <h2
          className="mt-[7px] text-[22px] leading-tight font-[620] tracking-[-0.022em] text-ink"
          data-navigation-focus=""
          tabIndex={-1}
        >
          {document.title}
        </h2>
        <p className="mt-2 font-mono text-ui-xs text-muted">
          {document.areaName} · {document.relativePath}
        </p>
        <div className="mt-6">
          {blocks.map((block, index) => {
            const key = `${index}:${block.text.slice(0, 24)}`;
            if (block.kind === "heading" || block.kind === "subheading") {
              return (
                <h3
                  className="mt-[26px] mb-2 text-[15px] font-[620] tracking-[-0.014em] text-ink"
                  key={key}
                >
                  {block.text}
                </h3>
              );
            }
            if (block.kind === "item") {
              return (
                <div className="mb-[7px] flex gap-2.5" key={key}>
                  <span
                    aria-hidden="true"
                    className="mt-[9px] size-1 flex-none rounded-full bg-muted"
                  />
                  <span
                    className={cx(
                      previewTextClass,
                      "mb-0",
                      block.matched ? previewMatchedClass : undefined,
                    )}
                  >
                    {block.text}
                  </span>
                </div>
              );
            }
            return (
              <p
                className={cx(
                  previewTextClass,
                  block.matched ? previewMatchedClass : undefined,
                )}
                key={key}
              >
                {block.text}
              </p>
            );
          })}
        </div>
        <a
          className="mt-[22px] inline-flex h-[30px] items-center rounded-control border border-line bg-panel px-[11px] text-ui-md whitespace-nowrap text-ink focus-ring hover:border-line-strong hover:bg-surface-hover"
          href={resourcesUrl({
            area: hit.areaId,
            document: hit.path,
            includeArchived: document.state === "archived",
          })}
        >
          Open document
        </a>
      </div>
    </div>
  );
}

export function SearchView({ data }: SearchViewProps) {
  const groups = TYPE_ORDER.flatMap((type) => {
    const hits = data.hits.filter((hit) => hit.type === type);
    return hits.length > 0 ? [{ type, hits }] : [];
  });
  const total =
    data.facets.find((facet) => facet.type === (data.typeFilter ?? "all"))
      ?.count ?? data.hits.length;
  const resultCount =
    total > data.hits.length
      ? `${data.hits.length} of ${total} results`
      : `${total} ${total === 1 ? "result" : "results"}`;

  return (
    <div
      className="contents"
      data-navigation-key={searchUrl({
        area: data.selectedArea,
        query: data.query,
        type: data.typeFilter,
        sort: data.sort,
      })}
      data-search-view=""
    >
      <header className="flex-none border-b border-line px-3.5">
        <div className="flex min-h-12 items-center gap-3">
          <form
            action={routes.search(data.selectedArea)}
            className="flex h-[30px] max-w-[460px] min-w-0 flex-1 items-center gap-2 rounded-control border border-line bg-panel px-2.5 focus-within:border-accent"
            method="get"
          >
            <span aria-hidden="true" className="flex-none text-muted">
              <SearchIcon size={13} />
            </span>
            <label className="sr-only" htmlFor="dokito-search">
              Search all Areas
            </label>
            <input
              autoComplete="off"
              className="min-w-0 flex-1 border-0 bg-transparent text-ui text-ink outline-none placeholder:text-muted"
              defaultValue={data.query}
              id="dokito-search"
              name="q"
              placeholder="Search Resources, Projects and Tasks"
              type="search"
            />
          </form>
          {data.query.length > 0 ? (
            <div className={cx(FILTER.bar, "ml-auto")}>
              <FilterMenu
                align="right"
                label={
                  data.sort === "updated" ? "Recently updated" : "Relevance"
                }
                options={[
                  {
                    label: "Relevance",
                    href: searchUrl({
                      area: data.selectedArea,
                      query: data.query,
                      type: data.typeFilter,
                    }),
                    active: data.sort === "relevance",
                  },
                  {
                    label: "Recently updated",
                    href: searchUrl({
                      area: data.selectedArea,
                      query: data.query,
                      type: data.typeFilter,
                      sort: "updated",
                    }),
                    active: data.sort === "updated",
                  },
                ]}
                title="Sort"
              />
            </div>
          ) : null}
          <span
            className={cx(
              "flex-none text-ui-sm whitespace-nowrap text-muted",
              data.query.length > 0 ? undefined : "ml-auto",
            )}
          >
            {data.query.length > 0 ? resultCount : ""}
          </span>
        </div>
        {data.query.length > 0 ? (
          <div className="flex h-9 items-center gap-[5px] overflow-x-auto">
            {data.facets.map((facet) => {
              const active =
                facet.type === "all"
                  ? data.typeFilter === undefined
                  : data.typeFilter === facet.type;
              return (
                <a
                  className={cx(
                    "flex h-6 flex-none items-center rounded-[5px] px-2 text-ui-sm font-medium whitespace-nowrap focus-ring",
                    active ? "bg-nav text-ink" : "text-ink-soft hover:bg-rail",
                  )}
                  href={searchUrl({
                    area: data.selectedArea,
                    query: data.query,
                    type: facet.type === "all" ? undefined : facet.type,
                    sort: data.sort,
                  })}
                  key={facet.type}
                >
                  {facet.label}
                  <span className="ml-1.5 text-meta text-muted">
                    {facet.count}
                  </span>
                </a>
              );
            })}
          </div>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1 flex-col rail:flex-row">
        <div
          className={cx(
            "min-h-0 overflow-y-auto border-line bg-panel rail:w-[520px] rail:flex-none rail:border-r",
            data.previewRequested ? "hidden rail:block" : undefined,
          )}
          data-search-hits=""
        >
          {groups.map((group) => (
            <div key={group.type}>
              <div className="flex h-[30px] items-center gap-2 border-b border-line bg-canvas px-3.5">
                <span className="text-[11.5px] font-semibold text-ink">
                  {TYPE_LABELS[group.type]}
                </span>
                <span className="font-mono text-meta text-muted tabular-nums">
                  {group.hits.length}
                </span>
              </div>
              {group.hits.map((hit) => {
                const active =
                  data.preview?.hit.path === hit.path &&
                  data.preview.hit.areaId === hit.areaId;
                return (
                  <a
                    data-search-hit-link=""
                    key={`${hit.areaId}:${hit.path}`}
                    {...(active ? { "aria-current": "page" as const } : {})}
                    className={cx(
                      "block w-full border-b border-sidebar px-4 pt-3 pb-3.5 text-left hover:bg-surface-hover rail:px-3.5 rail:pt-[9px] rail:pb-2.5",
                      active ? "bg-accent-soft" : undefined,
                    )}
                    href={searchUrl({
                      area: data.selectedArea,
                      query: data.query,
                      type: data.typeFilter,
                      sort: data.sort,
                      document: hit.path,
                      documentArea: hit.areaId,
                    })}
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 truncate text-doc font-[550] tracking-[-0.008em] text-ink rail:text-ui">
                        {hit.title}
                      </span>
                      {hit.meta ? (
                        <span className="flex-none text-meta text-muted">
                          {hit.meta}
                        </span>
                      ) : null}
                    </span>
                    <Mark hit={hit} />
                    <span className="mt-[5px] flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-micro text-muted">
                        {/* Every document is Markdown, so the extension
                            repeated on every row without distinguishing. */}
                        {hit.areaName} · {hit.path.replace(/\.md$/, "")} · line{" "}
                        {hit.line}
                      </span>
                      <span className="flex-none text-meta text-muted italic">
                        {hit.reason}
                      </span>
                    </span>
                  </a>
                );
              })}
            </div>
          ))}
          {data.query.length > 0 && data.hits.length === 0 ? (
            <p className={blankClass}>
              Nothing matches “{data.query}” in any Area. Try a shorter word.
            </p>
          ) : null}
          {data.query.length === 0 ? (
            <p className={blankClass}>
              Search reads every Markdown file in every Area.
            </p>
          ) : null}
        </div>
        <SearchPreview data={data} />
      </div>
    </div>
  );
}
