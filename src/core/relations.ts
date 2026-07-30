import { fail } from "./error";
import type { ProjectDocument } from "./types";

export function assertProjectRepositoryRelation(
  project: Pick<ProjectDocument, "id" | "repositories">,
  repository: string,
  task?: string,
): void {
  fail(
    project.repositories.includes(repository),
    "project_repository_mismatch",
    `Project '${project.id}' does not reference Repository '${repository}'.`,
    {
      project: project.id,
      repository,
      ...(task ? { task } : {}),
    },
  );
}
