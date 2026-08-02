# Dokito file formats

Use these canonical shapes for new files. Existing prose and formatting remain
authoritative and must be preserved by targeted edits.

Every Project and Task needs a `#` H1 somewhere in its body, and the first one
becomes the document title. A Project or Task without one fails validation for
the whole Area; in `context.md` a missing H1 is only a warning and the Web view
falls back to the filename. A Resource is named by its file and needs no H1 at
all. An H1 that appears solely inside a fenced code block does not count, and
demoting the real one to `##` invalidates the document.

## Area

Area IDs and Repository IDs are lowercase slugs matching
`^[a-z][a-z0-9-]*$`.

```yaml
version: 1
id: product
name: Product

repositories:
  web-app:
    github: example/web-app
```

Omit an empty `repositories` mapping.

An Area directory contains:

```text
product-area/
├── .gitignore
├── dokito.yaml
├── context.md
├── projects/
├── resources/
└── tasks/
```

Preserve an existing `.gitignore`; otherwise create it with:

```gitignore
.DS_Store
.context/
```

Place an empty `.gitkeep` in each empty standard collection so Git can retain
the directory.

`context.md` may declare `active`, `paused`, or `archived`; omission means
active.

```markdown
---
state: active
---

# Product

Purpose, current focus, and durable rules.
```

`context.md` holds at most 65,536 bytes. Beyond that both `dokito context` and
`dokito validate` fail with `context_too_large`, which blocks the first step of
every later session in that Area. Keep it curated rather than exhaustive and
move detail into Resources.

## Resource

Resource identity is its path below `resources/`. Nested directories and spaces
are allowed and the filename ends in `.md`.

Choose a filename that is unique within the Area and name the file the way you
would say it aloud: it is what links resolve and what every screen shows,
heading included. Folders organize Resources but do not distinguish them: a
link written from a Task or a Project cannot see the folder, so
`Platform overview.md` works where a second `platform/overview.md` does not.
An H1 is optional and is not shown, because the heading is the filename. One
that says something else is reported by `dokito validate`, so put that wording
in the filename or the body instead.

```markdown
Reference material, in whatever shape suits it.
```

A Resource may declare `state: archived`. Omit `state` for active Resources.
Other frontmatter fields are not part of the Resource model.

## Project

Project identity is its lowercase slug filename directly below `projects/`.
Frontmatter is strict.

```markdown
---
status: active
repositories:
  - web-app
due: "2026-08-12"
---

# Launch the product

Outcome: The release is available and verified.
```

Allowed statuses are `planned`, `active`, `done`, and `cancelled`. Omit
`repositories` and `due` when absent. Dates are quoted `YYYY-MM-DD` calendar
dates.

## Task

Task identity is an uppercase 26-character ULID at the start of a filename
directly below `tasks/`. Generate it with `dokito id --json`. The name must be
`<ULID>-<slug>.md`: the hyphen and the slug are required, and the slug uses
only lowercase letters, digits, and hyphens. The slug describes the Task and
does not change its identity, but omitting it, or spelling it with capitals,
spaces, or underscores, fails validation for the whole Area.

```markdown
---
status: todo
project: launch
repository: web-app
priority: high
due: "2026-08-05"
---

# Revise the privacy notice

Explain the required change.
```

Task frontmatter is strict. Allowed statuses are `todo`, `in_progress`,
`waiting`, `someday`, `done`, and `cancelled`. Allowed priorities are `low`,
`normal`, `high`, and `urgent`. Omit absent optional fields.
