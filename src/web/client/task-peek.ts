import { descendants } from "./dom";

const enhanced = new WeakSet<HTMLButtonElement>();

export function enhanceTaskPeek(root: ParentNode): void {
  for (const trigger of descendants<HTMLButtonElement>(
    root,
    "[data-peek-open]",
  )) {
    if (enhanced.has(trigger)) {
      continue;
    }
    const region = trigger.closest<HTMLElement>("main");
    const dialog =
      region?.querySelector<HTMLDialogElement>("[data-peek-dialog]");
    if (!dialog) {
      continue;
    }
    enhanced.add(trigger);
    trigger.hidden = false;
    trigger.addEventListener("click", () => dialog.showModal());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        dialog.close();
      }
    });
    dialog.addEventListener("close", () => {
      if (trigger.isConnected) {
        trigger.focus();
      }
    });
  }
}
