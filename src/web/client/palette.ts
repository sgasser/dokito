import { el } from "./dom";

interface PaletteEntry {
  title: string;
  meta: string;
  kind: "Task" | "Project" | "Resource";
  url: string;
  live?: boolean;
}

interface PaletteRow {
  title: string;
  meta: string;
  /** Empty on the row that leads to the full search, which is not a thing. */
  kind: string;
  /** Commands only: typed instead of the title, matched as a strict prefix. */
  alias?: string;
  live?: boolean;
  url: string;
}

interface PreparedSearch {
  searchMeta: string;
  searchTitle: string;
  searchWords: string[];
}

type PreparedPaletteRow = PaletteRow & PreparedSearch;
type PreparedPaletteEntry = PaletteEntry & PreparedSearch;

const COMMAND = "Command";

/**
 * The overlay is the quick list, not the result set: past eight rows a reader
 * is reading rather than choosing, and the row below leads to the view built
 * for reading results.
 */
const LIMIT = 8;

/** Above every tier, so a row that matches nothing sorts itself out. */
const NO_MATCH = 6;

/**
 * One rule for commands and content alike, best first: exact alias, exact
 * title, alias prefix, title word prefix, title anywhere, and last the line
 * beside the title — a Resource path, or the state of a piece of work.
 */
function prepare<T extends PaletteRow>(row: T): T & PreparedSearch {
  const searchTitle = row.title.toLocaleLowerCase();
  return {
    ...row,
    searchMeta: row.meta.toLocaleLowerCase(),
    searchTitle,
    searchWords: searchTitle.split(" "),
  };
}

function tier(row: PreparedPaletteRow, needle: string): number {
  const title = row.searchTitle;
  const alias = row.alias ?? "";
  if (alias.length > 0 && alias === needle) {
    return 0;
  }
  if (title === needle) {
    return 1;
  }
  if (alias.length > 0 && alias.startsWith(needle)) {
    return 2;
  }
  if (row.searchWords.some((word) => word.startsWith(needle))) {
    return 3;
  }
  if (title.includes(needle)) {
    return 4;
  }
  return row.searchMeta.includes(needle) ? 5 : NO_MATCH;
}

/**
 * Within a tier, work that is live comes first — a Task in progress is more
 * likely the one meant than a Task finished last month — and a command comes
 * before the rest, because a command was named exactly and content was found.
 */
function ranked(
  rows: PreparedPaletteRow[],
  needle: string,
  limit: number,
): PaletteRow[] {
  const buckets = Array.from(
    { length: NO_MATCH * 4 },
    () => [] as PaletteRow[],
  );
  for (const row of rows) {
    const matchTier = tier(row, needle);
    if (matchTier === NO_MATCH) {
      continue;
    }
    const priority = (row.live ? 0 : 2) + (row.kind === COMMAND ? 0 : 1);
    buckets[matchTier * 4 + priority]?.push(row);
  }

  const matches: PaletteRow[] = [];
  for (const bucket of buckets) {
    for (const row of bucket) {
      matches.push(row);
      if (matches.length === limit) {
        return matches;
      }
    }
  }
  return matches;
}

function absolute(url: string): URL {
  return new URL(url, window.location.origin);
}

/**
 * Two families of command, both already on the page as links: the navigation
 * destinations, and the Areas other than the one in scope. Reading them from
 * the rendered navigation keeps one list of destinations rather than a second
 * one that has to be kept in step with it — which is also why nothing here
 * counts them.
 */
function pageCommands(): PaletteRow[] {
  const rows: PaletteRow[] = [];
  const links = (
    selector: string,
    prefix: string,
    name: (node: HTMLAnchorElement) => string | undefined,
    skipCurrent = false,
  ): void => {
    for (const node of document.querySelectorAll<HTMLAnchorElement>(selector)) {
      const label = name(node)?.trim();
      if (!label || (skipCurrent && node.hasAttribute("aria-current"))) {
        continue;
      }
      rows.push({
        title: `${prefix} ${label}`,
        meta: "",
        kind: COMMAND,
        ...(node.dataset.paletteAlias
          ? { alias: node.dataset.paletteAlias }
          : {}),
        url: node.href,
      });
    }
  };
  // Every destination is listed wherever you stand, so the list an empty
  // query shows does not change length with the view. Switching to the Area
  // you are already in, on the other hand, is not a command.
  links("[data-nav-link]", "Go to", (node) => node.textContent ?? "");
  links(
    "[data-area-option]",
    "Switch Area to",
    (node) => node.dataset.areaOption,
    true,
  );
  return rows;
}

class Palette {
  private readonly dialog: HTMLDialogElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly commands: PreparedPaletteRow[];
  private entries: PreparedPaletteEntry[] = [];
  private matches: PaletteRow[] = [];
  private cursor = 0;
  private state: "idle" | "loading" | "ready" | "failed" = "idle";
  private returnFocus: HTMLElement | undefined;

  constructor(
    private readonly indexUrl: string,
    private readonly searchUrl: string,
    root: ParentNode,
  ) {
    const dialog = root.querySelector<HTMLDialogElement>(
      "[data-palette-dialog]",
    );
    const input = dialog?.querySelector<HTMLInputElement>(
      "[data-palette-input]",
    );
    const list = dialog?.querySelector<HTMLElement>("[data-palette-list]");
    if (!dialog || !input || !list) {
      throw new Error("The root search shell is incomplete.");
    }
    this.dialog = dialog;
    this.input = input;
    this.list = list;
    this.commands = pageCommands().map(prepare);

    this.input.addEventListener("input", () => this.render());
    this.input.addEventListener("keydown", this.onInputKeyDown);
    this.dialog.addEventListener("click", (event) => {
      if (event.target === this.dialog) {
        this.dialog.close();
      }
    });
    this.dialog.addEventListener("close", () => {
      this.input.setAttribute("aria-expanded", "false");
      this.input.removeAttribute("aria-activedescendant");
      if (this.returnFocus?.isConnected) {
        this.returnFocus.focus();
      }
      this.returnFocus = undefined;
    });
  }

  async open(returnFocus: HTMLElement | undefined): Promise<void> {
    this.returnFocus = returnFocus;
    this.input.value = "";
    // A failed index read is not permanent: the next explicit open retries.
    // Set loading before the first render so the empty index never flashes as
    // a truthful "No matches" result while the request is still in flight.
    const shouldLoad = this.state === "idle" || this.state === "failed";
    if (shouldLoad) {
      this.state = "loading";
    }
    this.render();
    if (!this.dialog.open) {
      this.dialog.showModal();
    }
    this.input.setAttribute("aria-expanded", "true");
    this.input.focus();

    if (shouldLoad) {
      try {
        const response = await fetch(this.indexUrl);
        if (!response.ok) {
          throw new Error(String(response.status));
        }
        this.entries = ((await response.json()) as PaletteEntry[]).map(prepare);
        this.state = "ready";
      } catch {
        this.state = "failed";
      }
      this.render();
    }
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  private readonly onInputKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.move(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = this.matches[this.cursor];
      if (target) {
        this.activate(target);
      }
    }
  };

  /**
   * The cursor stops at both ends rather than wrapping. A list this short is
   * read in one glance, so arriving back at the top reads as a missed keypress.
   */
  private move(delta: number): void {
    if (this.matches.length === 0) {
      return;
    }
    this.cursor = Math.min(
      this.matches.length - 1,
      Math.max(0, this.cursor + delta),
    );
    this.updateSelection(true);
  }

  private activate(target: PaletteRow): void {
    window.location.href = target.url;
  }

  /**
   * Nothing typed is not nothing to show: what is live in this Area, the file
   * being read, and then the four destinations.
   */
  private defaults(commands: PaletteRow[]): PaletteRow[] {
    const live = (kind: string, limit: number): PaletteEntry[] =>
      this.entries
        .filter((entry) => entry.live === true && entry.kind === kind)
        .slice(0, limit);
    const here = this.entries.find(
      (entry) =>
        entry.kind === "Resource" &&
        absolute(entry.url).pathname === window.location.pathname,
    );
    return [
      ...live("Task", 2),
      ...live("Project", 1),
      ...(here ? [here] : []),
      ...commands.filter((row) => row.alias).slice(0, 4),
    ];
  }

  /** The query is never a dead end: full search sits at the bottom of the list. */
  private fallback(query: string): PaletteRow {
    const url = absolute(this.searchUrl);
    url.searchParams.set("q", query);
    return {
      title: `Search every Area for “${query}”`,
      meta: "",
      kind: "",
      url: `${url.pathname}${url.search}`,
    };
  }

  /**
   * A short list is not a silent one: it says whether it is waiting, whether
   * it is broken, or whether the query simply has nothing here — which the row
   * below it already offers to widen. Without this the failure is invisible,
   * because the commands come from the page and are listed whatever the index
   * did, so a reader would read "no Tasks" where the truth is "no answer".
   */
  private note(query: string, hits: number): string {
    if (this.state === "loading") {
      return "Loading search…";
    }
    if (this.state === "failed") {
      return "Search could not be loaded.";
    }
    return query.length > 0 && hits === 0
      ? `Nothing here matches “${query}”.`
      : "";
  }

  private render(): void {
    const query = this.input.value.trim();
    const needle = query.toLocaleLowerCase();
    const hits =
      needle.length === 0
        ? this.defaults(this.commands)
        : ranked([...this.commands, ...this.entries], needle, LIMIT);
    // The query is never a dead end, so the list is never empty once one is
    // typed — which is why the state of the read has to be said in words.
    this.matches = needle.length === 0 ? hits : [...hits, this.fallback(query)];
    this.cursor = 0;
    this.list.replaceChildren();

    const note = this.note(query, hits.length);
    if (note) {
      this.list.append(
        el("p", "px-2.5 pt-3 pb-2.5 text-ui-md text-muted", note),
      );
    }
    if (this.matches.length === 0) {
      this.input.removeAttribute("aria-activedescendant");
      return;
    }

    this.matches.forEach((entry, index) => {
      const rowClass =
        "flex h-[38px] items-center gap-2.5 rounded-control border-0 bg-transparent px-2 text-left focus-ring aria-selected:bg-accent-soft";
      const row = el("a", rowClass);
      row.id = `dokito-palette-option-${index}`;
      row.dataset.paletteEntry = String(index);
      row.setAttribute("role", "option");
      row.tabIndex = -1;
      row.href = entry.url;
      row.append(
        el("span", "min-w-0 flex-1 truncate text-ui text-ink", entry.title),
      );
      if (entry.meta) {
        row.append(
          el(
            "span",
            "max-w-[42%] min-w-0 flex-none truncate text-ui-xs text-muted roomy:max-w-[55%]",
            entry.meta,
          ),
        );
      }
      if (entry.alias) {
        row.append(
          el(
            "span",
            "flex-none rounded-[3px] bg-rail px-1 py-px font-mono text-micro leading-[1.4] text-ink-soft",
            entry.alias,
          ),
        );
      }
      if (entry.kind) {
        row.append(
          el(
            "span",
            "flex-none text-ui-xs whitespace-nowrap text-muted",
            entry.kind,
          ),
        );
      }
      row.addEventListener("mouseenter", () => this.select(index));
      row.addEventListener("click", () => this.select(index));
      this.list.append(row);
    });
    this.updateSelection(false);
  }

  private select(index: number): void {
    this.cursor = index;
    this.updateSelection(false);
  }

  private updateSelection(scroll: boolean): void {
    for (const row of this.list.querySelectorAll<HTMLElement>(
      "[data-palette-entry]",
    )) {
      const selected = Number(row.dataset.paletteEntry) === this.cursor;
      row.setAttribute("aria-selected", String(selected));
      if (selected) {
        this.input.setAttribute("aria-activedescendant", row.id);
        if (scroll) {
          row.scrollIntoView({ block: "nearest" });
        }
      }
    }
  }
}

let initialized = false;

export function initializePalette(root: ParentNode): void {
  if (initialized) {
    return;
  }
  const shell = root.querySelector<HTMLElement>("[data-palette-index]");
  const indexUrl = shell?.dataset.paletteIndex;
  const searchUrl = shell?.dataset.paletteSearch;
  if (!indexUrl || !searchUrl) {
    return;
  }
  initialized = true;
  const palette = new Palette(indexUrl, searchUrl, root);

  for (const trigger of root.querySelectorAll<HTMLElement>(
    "[data-palette-open]",
  )) {
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      void palette.open(trigger);
    });
  }

  // One surface has one shortcut.
  document.addEventListener("keydown", (event) => {
    if (palette.isOpen || event.key.toLowerCase() !== "k") {
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      void palette.open(
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : undefined,
      );
    }
  });
}
