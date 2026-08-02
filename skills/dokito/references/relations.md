# Dokito relations

Read the current `dokito.yaml`, relevant Projects, and relevant Tasks before
creating or changing a typed relation.

- A Project lists every registered Repository needed to deliver its outcome.
  Omit Repositories for non-software Projects.
- A Task names a Project when it is part of that Project's work, either by
  advancing its outcome or as direct, bounded follow-up. Project and Task
  statuses are independent. Use Markdown links alone for thematic, historical,
  or secondary relations.
- A Task names a Repository only when the work directly applies to that
  codebase. Coordination work can carry a Project without a Repository.
- When a Task names both, its Repository must appear in the Project's
  `repositories` list.
- Resources, Projects, Tasks, and Context relate through Markdown links in
  their prose. Do not add ad hoc knowledge-relation frontmatter. Write each
  link as a filename, as described under "Write links" in the skill.

Before removing a Project or Repository relation, inspect every Task that can
depend on it. Before renaming or deleting a document, search for Markdown and
wiki links that target it: Dokito never rewrites a link for you, and a rename
that changes the filename changes the identity every link uses. `dokito validate --json` is the final structural check, not a
replacement for semantic judgment.
