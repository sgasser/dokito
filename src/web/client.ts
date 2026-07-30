/**
 * Dokito is a server-rendered application. These controllers only enhance
 * markup that already navigates and reads correctly without JavaScript.
 */
import { initializeNavigation } from "./client/navigation";
import { initializePalette } from "./client/palette";
import { enhanceProjectDetails } from "./client/project-details";
import { enhanceReaderMenus } from "./client/reader-menu";
import { enhanceTaskPeek } from "./client/task-peek";

function enhance(root: ParentNode): void {
  enhanceReaderMenus(root);
  enhanceProjectDetails(root);
  enhanceTaskPeek(root);
}

function main(): void {
  initializePalette(document);
  initializeNavigation(enhance);
  enhance(document);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main, { once: true });
} else {
  main();
}
