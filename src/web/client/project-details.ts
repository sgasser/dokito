import { descendants } from "./dom";

const enhancedTaskToggles = new WeakSet<HTMLButtonElement>();
const enhancedBodies = new WeakSet<HTMLElement>();

function enhanceTaskToggles(root: ParentNode): void {
  for (const button of descendants<HTMLButtonElement>(
    root,
    "[data-project-tasks-toggle]",
  )) {
    if (enhancedTaskToggles.has(button)) {
      continue;
    }
    const project = button.closest<HTMLElement>("[data-project-detail]");
    const completed = project?.querySelectorAll<HTMLElement>(
      "[data-project-task-completed]",
    );
    if (!completed || completed.length === 0) {
      continue;
    }

    enhancedTaskToggles.add(button);
    button.hidden = false;
    let expanded = false;
    button.addEventListener("click", () => {
      expanded = !expanded;
      for (const row of completed) {
        row.hidden = !expanded;
      }
      button.textContent = expanded
        ? "Hide completed"
        : (button.dataset.completedLabel ?? "");
      button.setAttribute("aria-expanded", String(expanded));
    });
  }
}

function enhanceBodies(root: ParentNode): void {
  for (const body of descendants<HTMLElement>(root, "[data-project-body]")) {
    if (enhancedBodies.has(body)) {
      continue;
    }
    const viewport = body.querySelector<HTMLElement>(
      "[data-project-body-viewport]",
    );
    const fade = body.querySelector<HTMLElement>("[data-project-body-fade]");
    const top = body.querySelector<HTMLButtonElement>(
      "[data-project-body-toggle]",
    );
    const more = body.querySelector<HTMLButtonElement>(
      "[data-project-body-more]",
    );
    const collapsedHeight = window.matchMedia("(min-width: 900px)").matches
      ? 190
      : 310;
    if (
      !viewport ||
      !fade ||
      !top ||
      !more ||
      viewport.scrollHeight <= collapsedHeight
    ) {
      continue;
    }

    enhancedBodies.add(body);
    let expanded = false;
    const render = (): void => {
      viewport.dataset.collapsed = String(!expanded);
      fade.hidden = expanded;
      top.hidden = false;
      top.textContent = expanded ? "Collapse" : "Show all";
      top.setAttribute("aria-expanded", String(expanded));
      more.hidden = expanded;
      more.setAttribute("aria-expanded", String(expanded));
    };
    const toggle = (): void => {
      expanded = !expanded;
      render();
    };
    top.addEventListener("click", toggle);
    more.addEventListener("click", toggle);
    render();
  }
}

export function enhanceProjectDetails(root: ParentNode): void {
  enhanceTaskToggles(root);
  enhanceBodies(root);
}
