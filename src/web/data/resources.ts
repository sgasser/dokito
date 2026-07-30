import { fail } from "../../core/error";
import { explorerDocuments, explorerTree } from "../kinds";
import { relatedDocuments } from "./areas";
import { WorkspaceSnapshot, type WorkspaceSnapshotInput } from "./snapshot";
import type { WebDocument, WebResourcesDashboardData } from "./types";

export interface ResourcesViewInput extends WorkspaceSnapshotInput {
  document?: string;
  archived?: boolean;
}

export async function loadResourcesView(
  input: ResourcesViewInput,
): Promise<WebResourcesDashboardData> {
  const snapshot = await WorkspaceSnapshot.create(input);
  const { scope } = snapshot;
  const requestedArchived = input.archived === true;

  // Only the Areas on screen are read: the switcher names Areas rather than
  // counting their documents, so the rest have nothing to contribute here.
  const selectedRoot = scope.selectedArea ? scope.scoped[0] : undefined;
  const [inScope, navigation, relations] = await Promise.all([
    Promise.all(scope.scoped.map((area) => snapshot.documents(area))),
    snapshot.navigation(),
    selectedRoot ? snapshot.relations(selectedRoot) : undefined,
  ]);
  const selectedArea = scope.selectedArea ? inScope[0] : undefined;
  const listed = inScope.flatMap((area) => explorerDocuments(area.documents));

  let selected: WebDocument | undefined;
  if (input.document !== undefined) {
    fail(
      selectedArea !== undefined,
      "document_area_required",
      "Opening a document requires an Area.",
    );
    selected = selectedArea.documents.find(
      (document) => document.relativePath === input.document,
    );
    fail(
      selected !== undefined,
      "document_not_found",
      `Document not found in Area '${selectedArea.id}': ${input.document}`,
    );
  } else if (selectedArea) {
    // The reader wants something open; the phone layout knows this was not
    // asked for, so it keeps showing the list.
    selected =
      selectedArea.documents.find(
        (document) => document.relativePath === "context.md",
      ) ?? explorerTree(selectedArea.documents, requestedArchived)[0];
  }

  // A copied or hand-written deep link may not carry the filter query. The
  // reader still has to reveal the document it was explicitly asked to open.
  const includeArchived = requestedArchived || selected?.state === "archived";
  const related =
    selected && selectedArea && relations
      ? relatedDocuments(
          selectedArea.documents,
          selected,
          relations.statuses,
          relations.graph,
        )
      : undefined;

  return {
    view: "resources",
    areaNavigation: navigation,
    ...(scope.selectedArea ? { selectedArea: scope.selectedArea } : {}),
    warnings: scope.warnings,
    areas: inScope,
    ...(selected ? { selectedDocument: selected } : {}),
    ...(related ? { related } : {}),
    documentRequested: input.document !== undefined,
    includeArchived,
    currentCount: listed.filter((document) => document.state !== "archived")
      .length,
    archivedCount: listed.filter((document) => document.state === "archived")
      .length,
  };
}
