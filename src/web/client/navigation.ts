const NAVIGATION_HEADER = "x-dokito-navigation";

interface NavigationDestinationLike {
  url: string;
}

interface NavigateEventLike extends Event {
  canIntercept: boolean;
  destination: NavigationDestinationLike;
  downloadRequest: string | null;
  formData: FormData | null;
  hashChange: boolean;
  navigationType: "push" | "reload" | "replace" | "traverse";
  signal: AbortSignal;
  intercept(options: {
    focusReset?: "after-transition" | "manual";
    handler: () => Promise<void>;
  }): void;
}

interface NavigationLike extends EventTarget {}

type Enhance = (root: ParentNode) => void;

interface RenderResult {
  focus?: HTMLElement;
  root: ParentNode;
}

let hardNavigation = false;
let navigationSequence = 0;

function windowNavigation(): NavigationLike | undefined {
  return (
    window as typeof window & {
      navigation?: NavigationLike;
    }
  ).navigation;
}

function areaSegment(url: URL): string | undefined {
  const segments = url.pathname.split("/");
  return segments[1] === "area" && segments[2] ? segments[2] : undefined;
}

function canHandle(event: NavigateEventLike): boolean {
  if (
    hardNavigation ||
    !event.canIntercept ||
    event.hashChange ||
    event.downloadRequest !== null ||
    event.formData !== null ||
    event.navigationType === "reload"
  ) {
    return false;
  }
  const current = new URL(window.location.href);
  const destination = new URL(event.destination.url);
  const area = areaSegment(current);
  return (
    destination.origin === current.origin &&
    area !== undefined &&
    areaSegment(destination) === area
  );
}

function syncAttributes(current: Element, next: Element): void {
  for (const attribute of [...current.attributes]) {
    if (!next.hasAttribute(attribute.name)) {
      current.removeAttribute(attribute.name);
    }
  }
  for (const attribute of [...next.attributes]) {
    current.setAttribute(attribute.name, attribute.value);
  }
}

function syncMainAttributes(current: HTMLElement, next: HTMLElement): void {
  const busy = current.getAttribute("aria-busy");
  syncAttributes(current, next);
  if (busy) {
    current.setAttribute("aria-busy", busy);
  }
}

function replaceContent(current: Element, next: Element): void {
  const content = document.createDocumentFragment();
  for (const child of [...next.childNodes]) {
    content.append(document.importNode(child, true));
  }
  current.replaceChildren(content);
}

function imported<T extends Element>(node: T): T {
  return document.importNode(node, true);
}

function revealCurrentLink(root: HTMLElement): void {
  const current = root.querySelector<HTMLElement>(
    '[data-document-link][aria-current="page"]',
  );
  let directory = current?.closest<HTMLDetailsElement>("details");
  while (directory && root.contains(directory)) {
    directory.open = true;
    directory = directory.parentElement?.closest<HTMLDetailsElement>("details");
  }
}

function directHeader(root: Element): HTMLElement | undefined {
  return [...root.children].find(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.tagName === "HEADER",
  );
}

function taskUpdate(
  currentMain: HTMLElement,
  nextMain: HTMLElement,
): RenderResult | undefined {
  const current = currentMain.querySelector<HTMLElement>("[data-tasks-view]");
  const next = nextMain.querySelector<HTMLElement>("[data-tasks-view]");
  if (
    !current ||
    !next ||
    current.dataset.navigationKey !== next.dataset.navigationKey
  ) {
    return undefined;
  }

  const previous = current.querySelector<HTMLAnchorElement>(
    '[data-work-row][data-active="true"]',
  )?.dataset.workItem;
  const currentList = current.querySelector<HTMLElement>("[data-work-list]");
  const nextList = next.querySelector<HTMLElement>("[data-work-list]");
  const currentDetail =
    current.querySelector<HTMLElement>("[data-work-detail]");
  const nextDetail = next.querySelector<HTMLElement>("[data-work-detail]");
  if (!currentList || !nextList || !currentDetail || !nextDetail) {
    return undefined;
  }

  const header = directHeader(current);
  const nextHeader = directHeader(next);
  if (header && nextHeader) {
    header.replaceWith(imported(nextHeader));
  }

  const scrollTop = currentList.scrollTop;
  syncAttributes(currentList, nextList);
  replaceContent(currentList, nextList);
  currentList.scrollTop = scrollTop;

  const detail = imported(nextDetail);
  currentDetail.replaceWith(detail);
  syncAttributes(current, next);
  syncMainAttributes(currentMain, nextMain);

  const detailFocus = detail.querySelector<HTMLElement>(
    "[data-navigation-focus]",
  );
  const returnFocus = previous
    ? [...current.querySelectorAll<HTMLElement>("[data-work-row]")].find(
        (row) => row.dataset.workItem === previous,
      )
    : undefined;
  return {
    root: current,
    ...(detailFocus
      ? { focus: detailFocus }
      : returnFocus
        ? { focus: returnFocus }
        : {}),
  };
}

function resourceUpdate(
  currentMain: HTMLElement,
  nextMain: HTMLElement,
): RenderResult | undefined {
  const current = currentMain.querySelector<HTMLElement>(
    "[data-resources-view]",
  );
  const next = nextMain.querySelector<HTMLElement>("[data-resources-view]");
  if (
    !current ||
    !next ||
    current.dataset.navigationKey !== next.dataset.navigationKey
  ) {
    return undefined;
  }

  const currentExplorer = current.querySelector<HTMLElement>(
    "[data-resources-explorer]",
  );
  const nextExplorer = next.querySelector<HTMLElement>(
    "[data-resources-explorer]",
  );
  const currentDetail = current.querySelector<HTMLElement>(
    "[data-document-detail]",
  );
  const nextDetail = next.querySelector<HTMLElement>("[data-document-detail]");
  if (!currentExplorer || !nextExplorer || !currentDetail || !nextDetail) {
    return undefined;
  }

  const previous = currentExplorer
    .querySelector<HTMLAnchorElement>(
      '[data-document-link][aria-current="page"]',
    )
    ?.getAttribute("href");
  const nextLinks = new Map(
    [
      ...nextExplorer.querySelectorAll<HTMLAnchorElement>(
        "[data-document-link]",
      ),
    ]
      .map((link) => [link.getAttribute("href"), link] as const)
      .filter(
        (entry): entry is [string, HTMLAnchorElement] => entry[0] !== null,
      ),
  );
  for (const link of currentExplorer.querySelectorAll<HTMLAnchorElement>(
    "[data-document-link]",
  )) {
    const href = link.getAttribute("href");
    const nextLink = href ? nextLinks.get(href) : undefined;
    if (!nextLink) {
      continue;
    }
    if (nextLink.hasAttribute("data-active")) {
      link.setAttribute("data-active", nextLink.dataset.active ?? "");
    } else {
      link.removeAttribute("data-active");
    }
    if (nextLink.hasAttribute("aria-current")) {
      link.setAttribute(
        "aria-current",
        nextLink.getAttribute("aria-current") ?? "page",
      );
    } else {
      link.removeAttribute("aria-current");
    }
  }
  syncAttributes(currentExplorer, nextExplorer);
  revealCurrentLink(currentExplorer);

  const detail = imported(nextDetail);
  currentDetail.replaceWith(detail);
  syncAttributes(current, next);
  syncMainAttributes(currentMain, nextMain);

  const requested = detail.dataset.documentRequested === "true";
  const detailFocus = requested
    ? detail.querySelector<HTMLElement>("[data-document-title]")
    : undefined;
  const returnFocus = previous
    ? [
        ...currentExplorer.querySelectorAll<HTMLAnchorElement>(
          "[data-document-link]",
        ),
      ].find((link) => link.getAttribute("href") === previous)
    : undefined;
  return {
    root: current,
    ...(detailFocus
      ? { focus: detailFocus }
      : returnFocus
        ? { focus: returnFocus }
        : {}),
  };
}

function searchUpdate(
  currentMain: HTMLElement,
  nextMain: HTMLElement,
): RenderResult | undefined {
  const current = currentMain.querySelector<HTMLElement>("[data-search-view]");
  const next = nextMain.querySelector<HTMLElement>("[data-search-view]");
  if (
    !current ||
    !next ||
    current.dataset.navigationKey !== next.dataset.navigationKey
  ) {
    return undefined;
  }

  const currentHits = current.querySelector<HTMLElement>("[data-search-hits]");
  const nextHits = next.querySelector<HTMLElement>("[data-search-hits]");
  const currentPreview = current.querySelector<HTMLElement>(
    "[data-search-preview]",
  );
  const nextPreview = next.querySelector<HTMLElement>("[data-search-preview]");
  if (!currentHits || !nextHits || !currentPreview || !nextPreview) {
    return undefined;
  }

  const previous = currentHits
    .querySelector<HTMLAnchorElement>(
      '[data-search-hit-link][aria-current="page"]',
    )
    ?.getAttribute("href");
  const nextLinks = new Map(
    [...nextHits.querySelectorAll<HTMLAnchorElement>("[data-search-hit-link]")]
      .map((link) => [link.getAttribute("href"), link] as const)
      .filter(
        (entry): entry is [string, HTMLAnchorElement] => entry[0] !== null,
      ),
  );
  for (const link of currentHits.querySelectorAll<HTMLAnchorElement>(
    "[data-search-hit-link]",
  )) {
    const href = link.getAttribute("href");
    const nextLink = href ? nextLinks.get(href) : undefined;
    if (nextLink) {
      syncAttributes(link, nextLink);
    }
  }
  syncAttributes(currentHits, nextHits);

  const preview = imported(nextPreview);
  currentPreview.replaceWith(preview);
  syncAttributes(current, next);
  syncMainAttributes(currentMain, nextMain);

  const detailFocus =
    preview.dataset.previewRequested === "true"
      ? preview.querySelector<HTMLElement>("[data-navigation-focus]")
      : undefined;
  const returnFocus = previous
    ? [
        ...currentHits.querySelectorAll<HTMLAnchorElement>(
          "[data-search-hit-link]",
        ),
      ].find((link) => link.getAttribute("href") === previous)
    : undefined;
  return {
    root: current,
    ...(detailFocus
      ? { focus: detailFocus }
      : returnFocus
        ? { focus: returnFocus }
        : {}),
  };
}

function updateShell(main: HTMLElement): void {
  const frame = document.querySelector<HTMLElement>("[data-view]");
  const view = main.dataset.view;
  if (frame && view) {
    frame.dataset.view = view;
  }
  if (main.dataset.pageTitle) {
    document.title = main.dataset.pageTitle;
  }
  const activeView = view === "project" ? "projects" : view;
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    "[data-nav-link]",
  )) {
    const active = link.dataset.navView === activeView;
    link.dataset.active = String(active);
    if (active) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }
}

function closePalette(): void {
  const palette = document.querySelector<HTMLDialogElement>(
    "[data-palette-dialog]",
  );
  if (palette?.open) {
    palette.close();
  }
}

function focus(target: HTMLElement | undefined): void {
  if (!target) {
    return;
  }
  if (target.tabIndex < 0 && !target.hasAttribute("tabindex")) {
    target.tabIndex = -1;
  }
  target.focus({ preventScroll: true });
}

function replaceMain(current: HTMLElement, next: HTMLElement): RenderResult {
  current.replaceWith(next);
  const focus = next.querySelector<HTMLElement>("h1");
  return {
    root: next,
    ...(focus ? { focus } : {}),
  };
}

function render(current: HTMLElement, next: HTMLElement): RenderResult {
  return (
    taskUpdate(current, next) ??
    resourceUpdate(current, next) ??
    searchUpdate(current, next) ??
    replaceMain(current, next)
  );
}

async function loadMain(
  url: string,
  signal: AbortSignal,
): Promise<HTMLElement> {
  const response = await fetch(url, {
    headers: {
      accept: "text/html",
      [NAVIGATION_HEADER]: "1",
    },
    signal,
  });
  if (
    !response.ok ||
    response.redirected ||
    response.headers.get(NAVIGATION_HEADER) !== "1" ||
    !response.headers.get("content-type")?.includes("text/html")
  ) {
    throw new Error(`Navigation response rejected: ${response.status}`);
  }
  const parsed = new DOMParser().parseFromString(
    await response.text(),
    "text/html",
  );
  const main = parsed.querySelector<HTMLElement>(
    "main[data-dokito-navigation]",
  );
  if (!main) {
    throw new Error("Navigation response has no main region.");
  }
  return imported(main);
}

function navigateNormally(url: string): void {
  hardNavigation = true;
  window.location.assign(url);
}

export function initializeNavigation(enhance: Enhance): void {
  const navigation = windowNavigation();
  if (!navigation) {
    return;
  }
  navigation.addEventListener("navigate", (rawEvent) => {
    const event = rawEvent as NavigateEventLike;
    if (!canHandle(event)) {
      return;
    }
    const destination = event.destination.url;
    const sequence = ++navigationSequence;
    event.intercept({
      focusReset: "manual",
      async handler() {
        const current = document.querySelector<HTMLElement>(
          "main[data-dokito-navigation]",
        );
        if (!current) {
          navigateNormally(destination);
          return;
        }
        current.setAttribute("aria-busy", "true");
        closePalette();
        try {
          const next = await loadMain(destination, event.signal);
          if (event.signal.aborted) {
            return;
          }
          const result = render(current, next);
          updateShell(next);
          enhance(result.root);
          focus(result.focus);
        } catch {
          if (!event.signal.aborted) {
            navigateNormally(destination);
          }
        } finally {
          if (current.isConnected && sequence === navigationSequence) {
            current.removeAttribute("aria-busy");
          }
        }
      },
    });
  });
}
