export function cx(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}

/*
 * One stacking order for the whole app, so a new layer has somewhere to go:
 * a sticky row inside a list (2), the phone navigation (20), the Area sheet
 * above it (30), the palette over the page (50), a toast over that (70), and
 * the skip link above everything, because a focused control a keyboard user
 * cannot see is a trap.
 */

/**
 * The workspace chrome: a fixed rail on the left, the view filling the rest.
 * Below the `rail` breakpoint it becomes a header, because three panes do
 * not fit on a phone.
 */
export const SHELL = {
  /* Once the rail exists the shell owns the viewport and the panes scroll
     inside it, so the rail stays put. On a phone the page scrolls as a page. */
  frame:
    "flex min-h-dvh flex-col bg-canvas rail:h-dvh rail:flex-row rail:overflow-hidden",
  /* No overflow of its own: a filter panel opens over the view beside it, and
     any clipping context here would cut it off. */
  rail: "flex flex-none flex-col gap-2 border-b border-line bg-sidebar p-2 rail:w-[232px] rail:border-r rail:border-b-0 rail:py-2.5",
  railTop:
    "flex items-center gap-2 rail:flex-col rail:items-stretch rail:gap-2",
  areaMenu: "group relative min-w-0 flex-1 rail:flex-none",
  areaSummary:
    "flex min-h-[38px] cursor-pointer list-none items-center gap-[9px] rounded-control px-2 focus-ring hover:bg-nav",
  areaMark:
    "flex size-5 flex-none items-center justify-center rounded-[5px] bg-ink text-ui-xs font-semibold tracking-[-0.02em] text-white",
  areaLabel: "min-w-0 flex-1 truncate text-ui font-[560] tracking-[-0.01em]",
  areaState: "flex-none text-meta text-muted",
  areaChevron:
    "flex-none text-muted transition-transform group-open:rotate-180",
  /* A dropdown on the desktop, a bottom sheet on a phone — same disclosure. */
  areaPanel:
    "fixed inset-x-0 bottom-0 z-30 max-h-[70dvh] overflow-y-auto rounded-t-2xl border-t border-line bg-panel p-2 pb-[calc(env(safe-area-inset-bottom)+16px)] shadow-[0_-8px_32px_rgb(29_32_37/0.18)] rail:absolute rail:inset-x-auto rail:top-[42px] rail:bottom-auto rail:left-0 rail:w-[216px] rail:rounded-panel rail:border rail:p-1 rail:shadow-[0_1px_2px_rgb(29_32_37/0.05),0_14px_36px_rgb(29_32_37/0.16)]",
  areaSheetGrip: "mx-auto mb-2 h-1 w-9 rounded-full bg-line-strong rail:hidden",
  areaPanelLabel:
    "mx-2 my-1 text-meta font-semibold tracking-[0.01em] text-muted",
  areaOption:
    "flex min-h-[52px] w-full items-center gap-2 rounded-[10px] px-2 text-base text-ink focus-ring hover:bg-surface-hover rail:min-h-8 rail:rounded-[5px] rail:text-ui",
  areaOptionActive: "bg-accent-soft",
  /* Archived Areas are held back rather than hidden: the row below the list
     says how many there are and reveals them, and the Area you are looking at
     stays listed whatever its state, so the switcher never hides where you are. */
  areaArchived: "group/archived",
  areaArchivedSummary:
    "flex min-h-11 cursor-pointer list-none items-center rounded-[5px] border-t border-line px-2 pt-1 text-ui-xs text-muted focus-ring hover:text-ink rail:min-h-7",
  searchTrigger:
    "flex min-h-8 items-center gap-2 rounded-control border border-line bg-panel pr-[7px] pl-[9px] text-ui text-ink-soft focus-ring hover:border-accent-line",
  searchTriggerLabel: "flex-1 text-left",
  searchKeys: "flex flex-none gap-[3px]",
  searchKey:
    "rounded-[4px] border border-line bg-sidebar px-[5px] py-0.5 font-mono text-micro leading-none text-ink-soft",
  /* On a phone the primary navigation belongs under the thumb, not in a rail. */
  nav: "fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-sidebar pb-[env(safe-area-inset-bottom)] rail:static rail:mt-3.5 rail:flex-col rail:gap-px rail:border-t-0 rail:bg-transparent rail:pb-0",
  navLink:
    "flex min-h-[52px] flex-1 flex-col items-center justify-center gap-[3px] text-ui-xs font-medium text-muted data-[active=true]:text-accent-dark rail:min-h-8 rail:flex-none rail:flex-row rail:justify-start rail:gap-[9px] rail:rounded-control rail:px-2 rail:text-ui rail:tracking-[-0.005em] rail:text-ink-soft rail:hover:bg-nav rail:hover:text-ink rail:data-[active=true]:bg-nav rail:data-[active=true]:text-ink",
  /* On the rail the hairline says what the entry above it is not: Area-scoped.
     On a phone the four destinations are one row of tabs and it has no work. */
  navDivider: "hidden rail:mx-2 rail:my-1 rail:block rail:h-px rail:bg-line",
  view: "flex min-w-0 flex-1 flex-col pb-[52px] rail:min-h-0 rail:pb-0",
  /* A phone shows the list or the detail, never both; the URL decides which. */
  onlyWide: "hidden rail:flex",
  backLink:
    "mb-3 -ml-1 inline-flex min-h-11 items-center gap-1.5 text-ui text-accent-dark focus-ring rail:hidden",
  /* Title, filters, count: the same header on every destination. */
  viewHeader:
    "flex min-h-12 flex-none items-center justify-between gap-4 border-b border-line px-4",
  viewHeaderMain: "flex min-w-0 items-center gap-1.5",
  viewTitle: "mr-2 flex-none text-ui-lg font-semibold tracking-[-0.012em]",
  viewHeaderSide: "flex flex-none items-center gap-2.5",
  warningBar:
    "group flex-none border-b border-warning/30 bg-warning-soft px-4 py-2.5",
  warningSummary:
    "flex cursor-pointer list-none items-center gap-2.5 text-ui-sm text-warning focus-ring",
  warningIcon:
    "flex size-3.5 flex-none items-center justify-center rounded-full bg-warning text-[9px] leading-none font-bold text-white",
  warningArrow:
    "ml-auto flex-none text-ui-xs transition-transform group-open:rotate-180",
  warningList:
    "mt-2 flex flex-col gap-1 border-t border-warning/20 pt-2 text-ui-xs/normal text-warning",
  viewCount:
    "hidden flex-none text-ui-sm whitespace-nowrap tabular-nums roomy:block",
} as const;

/**
 * One filter everywhere: a button that opens a panel of single-select options,
 * each with its count on the right and a check when it is the one in force.
 * A `details` element does the disclosure without a line of JavaScript, and it
 * is anchored to the button that opened it.
 */
export const FILTER = {
  bar: "flex min-w-0 items-center gap-1.5",
  menu: "group/filter relative flex-none",
  button:
    "flex h-7 cursor-pointer list-none items-center gap-1.5 rounded-control border border-line bg-panel px-[9px] text-ui-md whitespace-nowrap text-ink-soft focus-ring group-open/filter:border-line-strong group-open/filter:bg-rail hover:border-line-strong",
  chevron:
    "flex-none opacity-55 transition-transform group-open/filter:rotate-180",
  panel:
    "absolute top-[34px] left-0 z-30 w-[216px] rounded-panel border border-line bg-panel p-1 shadow-[0_1px_2px_rgb(29_32_37/0.05),0_12px_32px_rgb(29_32_37/0.14)]",
  panelRight: "right-0 left-auto",
  panelTitle:
    "mx-2 mt-1 mb-[5px] text-meta font-semibold tracking-[0.01em] text-muted",
  option:
    "flex h-[30px] w-full items-center gap-2 rounded-[5px] px-2 text-left text-ui-md text-ink focus-ring hover:bg-surface-hover",
  optionActive: "bg-accent-soft",
  optionLabel: "min-w-0 flex-1 truncate",
  optionCount: "flex-none font-mono text-micro text-muted tabular-nums",
  optionCheck: "w-3 flex-none text-accent",
} as const;
