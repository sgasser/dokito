import {
  createDocumentLookup,
  type DocumentLookup,
  resolveLink,
} from "../core/links";
import { documentBody } from "../core/markdown";
import { documentStateLabel } from "../core/state-model";
import type {
  WebDocument,
  WebDocumentsArea,
  WebRelatedDocument,
  WebResourcesDashboardData,
} from "./data";
import { FilterMenu } from "./filters";
import { formatAge, formatBytes } from "./format";
import { ChevronIcon } from "./icons";
import {
  documentLabel,
  EXPLORER_GROUPS,
  explorerTree,
  KIND_DOTS,
  KIND_LABELS,
  listLabels,
  type ResourceExplorerNode,
  resourceExplorerTree,
} from "./kinds";
import { MarkdownContent, markdownImageHref } from "./markdown";
import { routes, withQuery } from "./routes";
import { cx, FILTER, SHELL } from "./ui";
import { resourcesUrl } from "./urls";

interface ResourcesViewProps {
  data: WebResourcesDashboardData;
}

const groupHeadingClass =
  "px-2 pb-1 text-ui-xs font-semibold tracking-[0.01em] text-muted";
const readerClass = "flex min-w-0 flex-1 bg-panel";

function findLinkedDocument(
  data: WebResourcesDashboardData,
  current: WebDocument,
  target: string,
  lookup?: DocumentLookup<WebDocument>,
): WebDocument | undefined {
  const area = data.areas.find((candidate) => candidate.id === current.areaId);
  return area
    ? resolveLink(current.relativePath, target, area.documents, lookup)
    : undefined;
}

function documentHref(
  document: Pick<WebDocument, "areaId" | "relativePath" | "state">,
  includeArchived = false,
): string {
  return resourcesUrl({
    area: document.areaId,
    document: document.relativePath,
    includeArchived: includeArchived || document.state === "archived",
  });
}

/** Every document is Markdown, so the extension distinguished nothing. */
function displayPath(relativePath: string): string {
  return relativePath.replace(/\.md$/, "");
}

function StateFilter({ data }: ResourcesViewProps) {
  return (
    <FilterMenu
      label={data.includeArchived ? "All states" : "Current"}
      options={[
        {
          label: "Current",
          count: data.currentCount,
          href: resourcesUrl({ area: data.selectedArea }),
          active: !data.includeArchived,
        },
        {
          label: "Include archived",
          count: data.archivedCount,
          href: resourcesUrl({
            area: data.selectedArea,
            includeArchived: true,
          }),
          active: data.includeArchived,
        },
      ]}
      title="State"
    />
  );
}

function ExplorerDocumentEntry({
  data,
  document,
  tree = false,
}: {
  data: WebResourcesDashboardData;
  document: WebDocument;
  tree?: boolean;
}) {
  const active =
    data.selectedDocument?.relativePath === document.relativePath &&
    data.selectedDocument.areaId === document.areaId;

  return (
    <a
      className={cx(
        "flex min-h-[52px] w-full min-w-0 items-center gap-2 rounded-control px-3 text-ink hover:bg-sidebar data-[active=true]:bg-accent-soft data-[active=true]:text-accent-dark data-[active=true]:hover:bg-accent-soft rail:min-h-[30px] rail:px-2",
        tree ? "pl-[34px] rail:pl-[26px]" : undefined,
      )}
      data-active={active ? "true" : undefined}
      data-document-link=""
      href={documentHref(document, data.includeArchived)}
      {...(active ? { "aria-current": "page" as const } : {})}
    >
      <span className="min-w-0 flex-1 truncate text-left text-doc tracking-[-0.008em] rail:text-ui">
        {documentLabel(document)}
      </span>
      {document.state !== "active" ? (
        <span className="flex-none text-meta text-muted">
          {documentStateLabel(document.state)}
        </span>
      ) : null}
    </a>
  );
}

function ResourceTree({
  areaId,
  data,
  nodes,
}: {
  areaId: string;
  data: WebResourcesDashboardData;
  nodes: ResourceExplorerNode<WebDocument>[];
}) {
  /*
   * Native disclosures keep folder interaction out of the client bundle. The
   * browser preserves what the reader opened or closed while the page remains
   * in place.
   */
  return (
    <>
      {nodes.map((node) =>
        node.type === "directory" ? (
          <details
            className="[&[open]>summary>[data-directory-chevron]]:rotate-0 [&[open]>summary>[data-directory-count]]:hidden"
            data-resource-directory={node.relativePath}
            key={node.relativePath}
            open={
              data.selectedDocument?.areaId === areaId &&
              data.selectedDocument.relativePath.startsWith(
                `${node.relativePath}/`,
              )
            }
          >
            <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-1.5 rounded-control pr-2 pl-4 text-ink-soft focus-ring hover:bg-sidebar rail:min-h-7 rail:pl-2">
              <span
                className="flex w-3 flex-none -rotate-90 items-center justify-center text-muted transition-transform duration-120"
                data-directory-chevron=""
              >
                <ChevronIcon />
              </span>
              <span className="min-w-0 flex-1 truncate text-left text-doc font-[540] tracking-[-0.008em] rail:text-ui">
                {node.name}
              </span>
              <span
                className="flex-none font-mono text-micro text-muted tabular-nums"
                data-directory-count=""
              >
                {node.documentCount}
              </span>
            </summary>
            <div className="ml-4">
              <ResourceTree areaId={areaId} data={data} nodes={node.children} />
            </div>
          </details>
        ) : (
          <ExplorerDocumentEntry
            data={data}
            document={node.document}
            key={node.document.relativePath}
            tree
          />
        ),
      )}
    </>
  );
}

function AreaGroup({
  area,
  data,
}: {
  area: WebDocumentsArea;
  data: WebResourcesDashboardData;
}) {
  const listed = explorerTree(area.documents, data.includeArchived);

  return (
    <>
      {data.areas.length > 1 ? (
        <p className={cx(groupHeadingClass, "pt-3")}>{area.name}</p>
      ) : null}
      {EXPLORER_GROUPS.map(({ kind, label }) => {
        const documents = listed.filter((document) => document.kind === kind);
        if (documents.length === 0) {
          return null;
        }
        return (
          <div className="pt-2 pb-0.5" key={`${area.id}:${kind}`}>
            {label ? <p className={groupHeadingClass}>{label}</p> : null}
            {kind === "resource" ? (
              <ResourceTree
                areaId={area.id}
                data={data}
                nodes={resourceExplorerTree(documents)}
              />
            ) : (
              documents.map((document) => (
                <ExplorerDocumentEntry
                  data={data}
                  document={document}
                  key={document.relativePath}
                />
              ))
            )}
          </div>
        );
      })}
    </>
  );
}

function Properties({
  data,
  document,
}: {
  data: WebResourcesDashboardData;
  document: WebDocument;
}) {
  /*
   * No Type row: nearly everything listed here is a Resource, so saying so
   * stopped carrying information. State appears only when it is not active,
   * because "Active" on every row says the same thing.
   */
  const properties = [
    { label: "Area", value: document.areaName, mono: false },
    ...(document.state === "active"
      ? []
      : [
          {
            label: "State",
            value: documentStateLabel(document.state),
            mono: false,
          },
        ]),
    { label: "Path", value: document.relativePath, mono: true },
    { label: "Updated", value: formatAge(document.modifiedAt), mono: false },
  ];

  return (
    <aside className="hidden flex-none border-line bg-canvas px-[18px] pt-6 pb-10 full:block full:w-[296px] full:border-l">
      <div className="flex flex-col gap-2.5">
        {properties.map((property) => (
          <div className="flex items-start gap-3" key={property.label}>
            <span className="w-16 flex-none text-ui-sm text-muted">
              {property.label}
            </span>
            <span
              className={cx(
                "min-w-0 flex-1 text-ui-md leading-[1.45] wrap-anywhere text-ink",
                property.mono ? "font-mono" : undefined,
              )}
            >
              {property.value}
            </span>
          </div>
        ))}
      </div>

      {data.related && data.related.length > 0 ? (
        <ResourceRelated
          document={document}
          includeArchived={data.includeArchived}
          related={data.related}
        />
      ) : null}
    </aside>
  );
}

function RelatedRows({
  areaId,
  includeArchived,
  related,
}: {
  areaId: string;
  includeArchived: boolean;
  related: WebRelatedDocument[];
}) {
  const labels = listLabels(related);
  return (
    <div className="-mx-2 flex flex-col gap-px" data-related-rows="">
      {related.map((entry) => (
        <a
          className="flex w-full items-start gap-[9px] rounded-control px-2 py-1.5 text-left hover:bg-rail"
          data-document-link=""
          href={withQuery(routes.document(areaId, entry.relativePath), {
            archived:
              includeArchived || entry.state === "archived" ? "1" : undefined,
          })}
          key={`${entry.direction}:${entry.relativePath}`}
        >
          <span
            aria-hidden="true"
            className={cx(
              "mt-1.5 size-1.5 flex-none rounded-full",
              KIND_DOTS[entry.kind],
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-ui-md leading-[1.4] text-ink">
                {entry.kind === "resource"
                  ? labels.get(entry.relativePath)
                  : documentLabel(entry)}
              </span>
              {entry.state !== "active" ? (
                <span className="flex-none rounded-[4px] bg-rail px-1.5 py-px text-meta leading-none text-muted">
                  {documentStateLabel(entry.state)}
                </span>
              ) : null}
            </span>
            <span className="mt-px block text-ui-xs text-muted">
              {KIND_LABELS[entry.kind]}
              {entry.status ? ` · ${entry.status}` : ""}
            </span>
          </span>
        </a>
      ))}
    </div>
  );
}

function ResourceRelated({
  document,
  includeArchived,
  related,
}: {
  document: Pick<WebDocument, "areaId">;
  includeArchived: boolean;
  related: WebRelatedDocument[];
}) {
  return (
    <div className="mt-[26px] border-t border-line pt-[18px]">
      <p className="mb-2 text-ui-xs font-semibold tracking-[0.01em] text-muted">
        Related
      </p>
      <RelatedRows
        areaId={document.areaId}
        includeArchived={includeArchived}
        related={related}
      />
    </div>
  );
}

/**
 * Both entries put something on the clipboard, so this is hidden until the
 * island can wire it up. A reader without JavaScript keeps the address bar.
 */
function ReaderMenu({
  document,
  includeArchived,
}: {
  document: WebDocument;
  includeArchived: boolean;
}) {
  const items = [
    {
      label: "Copy link",
      hint: "L",
      value: documentHref(document, includeArchived),
    },
    { label: "Copy path", hint: "P", value: document.relativePath },
  ];

  return (
    <span className="relative ml-auto" data-reader-menu="" hidden>
      <button
        aria-label="Document actions"
        className="flex size-6 items-center justify-center rounded-[5px] text-muted hover:bg-surface-hover"
        popoverTarget="document-actions"
        type="button"
      >
        <span aria-hidden="true">···</span>
      </button>
      <span
        className="fixed z-20 m-0 w-[216px] rounded-panel border border-line bg-panel p-1 shadow-[0_1px_2px_rgb(29_32_37/0.05),0_12px_32px_rgb(29_32_37/0.14)]"
        data-reader-panel=""
        id="document-actions"
        popover="auto"
      >
        {items.map((item) => (
          <button
            className="flex h-[30px] w-full items-center justify-between rounded-[5px] px-2 text-left text-ui-md text-ink hover:bg-surface-hover"
            data-copy-label={item.label.replace("Copy ", "")}
            data-copy-value={item.value}
            key={item.label}
            type="button"
          >
            <span>{item.label}</span>
            <span className="font-mono text-meta text-muted">⌘{item.hint}</span>
          </button>
        ))}
      </span>
    </span>
  );
}

function BackToList({ data }: ResourcesViewProps) {
  return (
    <a
      className={SHELL.backLink}
      data-document-list-link=""
      href={resourcesUrl({
        area: data.selectedArea,
        includeArchived: data.includeArchived,
      })}
    >
      <span aria-hidden="true">‹</span> All resources
    </a>
  );
}

function DocumentReader({ data }: ResourcesViewProps) {
  const document = data.selectedDocument;

  if (!document) {
    return (
      <div
        className={cx(readerClass, SHELL.onlyWide)}
        data-document-detail=""
        data-document-requested={String(data.documentRequested)}
        data-document-url=""
      >
        <div className="flex flex-1 items-center justify-center px-6 py-14 text-center">
          <div className="max-w-[42ch]">
            <p className="text-ui-lg font-[560] text-ink">
              No document selected
            </p>
            <p className="mt-1.5 text-ui leading-[1.55] text-pretty text-muted">
              Choose a resource on the left, or search across all Areas.
            </p>
          </div>
        </div>
      </div>
    );
  }
  const area = data.areas.find((candidate) => candidate.id === document.areaId);
  const lookup = area ? createDocumentLookup(area.documents) : undefined;

  return (
    <div
      className={cx(
        readerClass,
        data.documentRequested ? undefined : SHELL.onlyWide,
      )}
      data-document-detail=""
      data-document-requested={String(data.documentRequested)}
      data-document-url={documentHref(document, data.includeArchived)}
    >
      <article className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[700px] px-5 pt-8 pb-24 roomy:px-9 roomy:pt-11">
          <BackToList data={data} />
          <h1
            className="text-title font-[640] tracking-[-0.026em] text-pretty text-ink"
            data-document-title=""
            tabIndex={-1}
          >
            {documentLabel(document)}
          </h1>
          <p className="mt-[9px] flex flex-wrap items-center gap-2 text-ui-sm text-muted">
            {/* The kind is named only where it distinguishes: on the Area file
                it does, on a Resource among Resources it does not. */}
            {document.kind === "resource" ? null : (
              <>
                <span>{KIND_LABELS[document.kind]}</span>
                <span aria-hidden="true" className="text-line-strong">
                  ·
                </span>
              </>
            )}
            <span>Updated {formatAge(document.modifiedAt)}</span>
            <ReaderMenu
              document={document}
              includeArchived={data.includeArchived}
            />
          </p>
          <div className="mt-[30px]">
            {document.unreadable || document.oversized ? (
              <div className="rounded-control border border-dashed border-line-strong p-3.5">
                <p className="text-ui-md text-ink">
                  {document.oversized
                    ? `This document is too large to display (${formatBytes(document.bytes)})`
                    : "This document could not be read"}
                </p>
                <p className="mt-1 font-mono text-ui-xs text-muted">
                  {displayPath(document.relativePath)}
                </p>
              </div>
            ) : (
              <MarkdownContent
                content={documentBody(document.content)}
                resolveDocumentHref={(target) => {
                  const linked = findLinkedDocument(
                    data,
                    document,
                    target,
                    lookup,
                  );
                  return linked
                    ? documentHref(linked, data.includeArchived)
                    : undefined;
                }}
                resolveImageSrc={(target) =>
                  markdownImageHref(
                    document.areaId,
                    document.relativePath,
                    target,
                  )
                }
              />
            )}
          </div>
        </div>
      </article>
      <Properties data={data} document={document} />
    </div>
  );
}

export function ResourcesView({ data }: ResourcesViewProps) {
  const count = data.areas.reduce(
    (total, area) =>
      total + explorerTree(area.documents, data.includeArchived).length,
    0,
  );

  return (
    <>
      <header className={SHELL.viewHeader}>
        <div className={SHELL.viewHeaderMain}>
          <h1 className={SHELL.viewTitle}>Resources</h1>
          <div className={FILTER.bar}>
            <StateFilter data={data} />
          </div>
        </div>
        <span className={cx(SHELL.viewCount, "text-muted")}>
          {data.selectedArea
            ? `${count} in ${data.areas[0]?.name ?? data.selectedArea}`
            : `${count} Resources`}
        </span>
      </header>
      <div
        className="flex min-h-0 flex-1 flex-col rail:flex-row"
        data-navigation-key={resourcesUrl({
          area: data.selectedArea,
          includeArchived: data.includeArchived,
        })}
        data-resources-base={routes.resources(data.selectedArea)}
        data-resources-view=""
      >
        <div
          className={cx(
            "flex min-h-0 min-w-0 flex-col border-line bg-canvas rail:w-[304px] rail:flex-none rail:border-r",
            data.documentRequested ? SHELL.onlyWide : undefined,
          )}
          data-resources-explorer=""
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-2.5 pb-4">
            {data.areas.map((area) => (
              <AreaGroup area={area} data={data} key={area.id} />
            ))}
          </div>
        </div>
        <DocumentReader data={data} />
      </div>
    </>
  );
}
