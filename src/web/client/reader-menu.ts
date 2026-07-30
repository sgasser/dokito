import { copyText, descendants } from "./dom";

const enhanced = new WeakSet<HTMLElement>();

function positionPanel(button: HTMLButtonElement, panel: HTMLElement): void {
  const rect = button.getBoundingClientRect();
  const width = 216;
  panel.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width))}px`;
  panel.style.top = `${rect.bottom + 6}px`;
}

export function enhanceReaderMenus(root: ParentNode): void {
  for (const menu of descendants<HTMLElement>(root, "[data-reader-menu]")) {
    if (enhanced.has(menu)) {
      continue;
    }
    const panel = menu.querySelector<HTMLElement>("[data-reader-panel]");
    const button = menu.querySelector<HTMLButtonElement>("button");
    if (!panel || !button) {
      continue;
    }
    enhanced.add(menu);
    menu.hidden = false;

    panel.addEventListener("beforetoggle", (event) => {
      if ("newState" in event && (event as ToggleEvent).newState === "open") {
        positionPanel(button, panel);
      }
    });
    panel.addEventListener("click", (event) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-copy-value]")
          : null;
      if (!target) {
        return;
      }
      panel.hidePopover();
      void copyText(
        target.dataset.copyValue ?? "",
        target.dataset.copyLabel ?? "Value",
      );
    });
  }
}
