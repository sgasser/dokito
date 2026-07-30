import type { ReactNode } from "react";
import { documentStateLabel, documentStateOrder } from "../core/state-model";
import type { WebAreaNavigationItem, WebDashboardData } from "./data";
import {
  CheckIcon,
  FocusIcon,
  ProjectsIcon,
  ResourcesIcon,
  SearchIcon,
  SwitchIcon,
  TasksIcon,
} from "./icons";
import { routes } from "./routes";
import { cx, FILTER, SHELL } from "./ui";
import {
  focusUrl,
  projectsUrl,
  resourcesUrl,
  searchUrl,
  tasksUrl,
} from "./urls";

interface ShellProps {
  data: WebDashboardData;
  children: ReactNode;
  pageTitle: string;
}

/**
 * Three parallel PARA nouns; the medium they are stored in is not one of them.
 * The alias is what root search matches on as a strict prefix, so `gt` reaches
 * Tasks before anything merely containing those letters does.
 */
const AREA_VIEWS = [
  { view: "resources", label: "Resources", alias: "gr" },
  { view: "projects", label: "Projects", alias: "gp" },
  { view: "tasks", label: "Tasks", alias: "gt" },
] as const;

/**
 * Focus is a destination, not a scope. It sits above the hairline with the
 * search field, because everything below the hairline is about the one Area in
 * the switcher and Focus is about all of them. It is not first in the list:
 * above the workspace mark it would read as if it owned the workspace.
 */
const FOCUS_VIEW = { view: "focus", label: "Focus", alias: "gf" } as const;

type NavEntry = (typeof AREA_VIEWS)[number] | typeof FOCUS_VIEW;

const NAV_ICONS: Record<
  NavEntry["view"],
  (props: { size?: number }) => ReactNode
> = {
  focus: FocusIcon,
  resources: ResourcesIcon,
  projects: ProjectsIcon,
  tasks: TasksIcon,
};

function navHref(view: NavEntry["view"], area: string | undefined): string {
  switch (view) {
    case "focus":
      return focusUrl();
    case "resources":
      return resourcesUrl({ area });
    case "projects":
      return projectsUrl({ area });
    default:
      return tasksUrl({ area });
  }
}

function NavLink({ entry, data }: { entry: NavEntry; data: WebDashboardData }) {
  const active =
    data.view === entry.view ||
    (entry.view === "projects" && data.view === "project");
  const Icon = NAV_ICONS[entry.view];

  return (
    <a
      className={SHELL.navLink}
      data-active={String(active)}
      href={navHref(entry.view, data.selectedArea)}
      {...(active ? { "aria-current": "page" as const } : {})}
      data-nav-link=""
      data-nav-view={entry.view}
      data-palette-alias={entry.alias}
    >
      <span aria-hidden="true" className="flex-none">
        <Icon />
      </span>
      {entry.label}
    </a>
  );
}

/**
 * Position keeps current Areas easy to reach, while an explicit label makes a
 * paused Area distinguishable from both active and archived Areas.
 */
function byState(a: WebAreaNavigationItem, b: WebAreaNavigationItem): number {
  return (
    documentStateOrder(a.state) - documentStateOrder(b.state) ||
    a.name.localeCompare(b.name)
  );
}

function AreaOption({
  area,
  data,
}: {
  area: WebAreaNavigationItem;
  data: WebDashboardData;
}) {
  const active = area.id === data.selectedArea;
  return (
    <a
      className={cx(
        SHELL.areaOption,
        active ? SHELL.areaOptionActive : undefined,
      )}
      href={resourcesUrl({ area: area.id })}
      key={area.id}
      {...(active ? { "aria-current": "true" as const } : {})}
      data-area-option={area.name}
    >
      <span className="min-w-0 flex-1 truncate">{area.name}</span>
      {area.state !== "active" ? (
        <span className={SHELL.areaState}>
          {documentStateLabel(area.state)}
        </span>
      ) : null}
      <span className={FILTER.optionCheck}>
        {active ? <CheckIcon /> : null}
      </span>
    </a>
  );
}

/**
 * The Area switcher is a `details` disclosure rather than a menu button: it
 * opens, closes and takes focus without a line of JavaScript.
 */
function AreaMenu({ data }: { data: WebDashboardData }) {
  const areas = [...data.areaNavigation].sort(byState);
  const current = areas.find((area) => area.id === data.selectedArea);
  const label = current?.name ?? "Choose Area";
  /*
   * An archived Area you are currently viewing stays in the list, so the
   * switcher never hides where you are.
   */
  const listed = areas.filter(
    (area) => area.state !== "archived" || area.id === data.selectedArea,
  );
  const archived = areas.filter(
    (area) => area.state === "archived" && area.id !== data.selectedArea,
  );

  return (
    <details className={SHELL.areaMenu}>
      <summary className={SHELL.areaSummary}>
        <span aria-hidden="true" className={SHELL.areaMark}>
          D
        </span>
        <span className={SHELL.areaLabel}>{label}</span>
        {current && current.state !== "active" ? (
          <span className={SHELL.areaState}>
            {documentStateLabel(current.state)}
          </span>
        ) : null}
        <SwitchIcon />
        <span className="sr-only">Change Area</span>
      </summary>
      <div className={SHELL.areaPanel} data-area-navigation="">
        <span aria-hidden="true" className={SHELL.areaSheetGrip} />
        <p className={SHELL.areaPanelLabel}>Area</p>
        {listed.map((area) => (
          <AreaOption area={area} data={data} key={area.id} />
        ))}
        {archived.length > 0 ? (
          <details className={SHELL.areaArchived}>
            <summary className={SHELL.areaArchivedSummary}>
              {archived.length} archived
            </summary>
            {archived.map((area) => (
              <AreaOption area={area} data={data} key={area.id} />
            ))}
          </details>
        ) : null}
      </div>
    </details>
  );
}

/** One surface searches all Area content and runs commands. */
function RootSearch() {
  return (
    <dialog
      aria-label="Search all Areas"
      className="dokito-palette"
      data-palette-dialog=""
    >
      <div className="flex h-12 flex-none items-center gap-2.5 border-b border-line px-3.5">
        <span aria-hidden="true" className="flex-none text-muted">
          <SearchIcon />
        </span>
        <input
          aria-autocomplete="list"
          aria-controls="dokito-palette-list"
          aria-expanded="false"
          aria-label="Search all Areas or run a command"
          autoComplete="off"
          className="min-w-0 flex-1 border-0 bg-transparent text-[15px] tracking-[-0.01em] text-ink outline-none placeholder:text-muted"
          data-palette-input=""
          placeholder="Search Resources, Projects and Tasks, or run a command"
          role="combobox"
          type="text"
        />
      </div>
      <div
        className="max-h-[420px] overflow-y-auto p-1.5"
        data-palette-list=""
        id="dokito-palette-list"
        role="listbox"
      />
      <div className="flex h-[34px] flex-none items-center gap-3.5 border-t border-line bg-canvas px-3 text-ui-xs text-muted">
        <span>↑↓ to move</span>
        <span>↵ to open</span>
        <span>esc to close</span>
      </div>
    </dialog>
  );
}

function Warnings({ data }: { data: WebDashboardData }) {
  if (data.warnings.length === 0) {
    return null;
  }
  return (
    <details className={SHELL.warningBar}>
      <summary className={SHELL.warningSummary}>
        <span aria-hidden="true" className={SHELL.warningIcon}>
          !
        </span>
        {data.warnings.length === 1
          ? "One thing needs attention"
          : `${data.warnings.length} things need attention`}
        <span aria-hidden="true" className={SHELL.warningArrow}>
          ⌄
        </span>
      </summary>
      <div className={SHELL.warningList}>
        {data.warnings.map((warning) => (
          <span key={warning}>{warning}</span>
        ))}
      </div>
    </details>
  );
}

export function WorkspaceMain({ children, data, pageTitle }: ShellProps) {
  return (
    <main
      className={SHELL.view}
      data-area={data.selectedArea}
      data-dokito-navigation=""
      data-page-title={pageTitle}
      data-view={data.view}
      id="main-content"
    >
      <Warnings data={data} />
      {children}
    </main>
  );
}

export function Shell({ data, children, pageTitle }: ShellProps) {
  const rootSearchUrl = searchUrl({ area: data.selectedArea });

  return (
    <div
      className={SHELL.frame}
      data-palette-index={routes.paletteIndex(data.selectedArea)}
      data-palette-search={rootSearchUrl}
      data-view={data.view}
    >
      <RootSearch />
      <nav
        aria-label="Dokito navigation"
        className={SHELL.rail}
        data-shell-navigation=""
      >
        <div className={SHELL.railTop}>
          <AreaMenu data={data} />
          <a
            className={SHELL.searchTrigger}
            data-palette-open=""
            href={rootSearchUrl}
          >
            <span aria-hidden="true" className="flex-none text-muted">
              <SearchIcon />
            </span>
            <span className={SHELL.searchTriggerLabel}>Search or command</span>
            <span aria-hidden="true" className={SHELL.searchKeys}>
              <span className={SHELL.searchKey}>⌘K</span>
            </span>
          </a>
        </div>
        <div className={SHELL.nav}>
          <NavLink data={data} entry={FOCUS_VIEW} />
          <span aria-hidden="true" className={SHELL.navDivider} />
          {AREA_VIEWS.map((entry) => (
            <NavLink data={data} entry={entry} key={entry.view} />
          ))}
        </div>
      </nav>
      <WorkspaceMain data={data} pageTitle={pageTitle}>
        {children}
      </WorkspaceMain>
    </div>
  );
}
