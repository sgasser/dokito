---
name: dokito
description: Work with Dokito Areas and connected Repositories by discovering global Projects and Tasks, searching Area documents by name and content, resolving scope, reading and editing canonical Markdown and YAML files, and validating every structured change. Use when listing work across registered Areas, finding a document you cannot name yet, creating or registering an Area, working in an Area or connected code repository, loading scoped knowledge, selecting relations, or when the user asks to use Dokito.
---

# Dokito

Dokito files are the complete model interface. Read and edit `dokito.yaml`,
`context.md`, Projects, Resources, and Tasks directly. Use the CLI only for
machine-local registration and registry discovery, global read-only Project
and Task listings, document search, scope resolution, ULID generation,
validation, and the Web runtime.

## Start work

1. Run `dokito context`.
2. Read the exact `context.md` printed after the summary. Treat the printed
   Area root and collection paths as authoritative local paths.
3. Read `dokito.yaml` directly from the Area root. Find a document you cannot
   name yet with `dokito search '<query>'` rather than a shell search tool. See
   "Discover and read" in [references/workflows.md](references/workflows.md).
4. Load only the files relevant to the request. Do not assume that every
   Project, Resource, or Task belongs in agent context.

Stay in the resolved Area unless the user explicitly requests broader work.
If scope resolution fails, do not conclude that no Areas exist and do not
propose creating or registering an Area yet. Follow the discovery workflow
below. Canonical checkout paths are machine-local Repository entries beneath
their Area registration; never add them to `dokito.yaml`. When an entry is
absent, that Repository has no local checkout until registration records its
verified sibling or the machine-local path is configured.

## Discover Areas and work from unscoped work

An agent runtime workspace, home directory, or orchestration Repository does
not need to belong to an Area. `dokito context` failing there is normal.

1. Run `dokito areas` when the request needs the machine-local registry. Use
   only entries not marked `unavailable`.
2. For a cross-Area overview, run `dokito projects --summary` or
   `dokito tasks --summary`. Each answers with the total, the count per status,
   the count per readable Area, and the warnings, so counts never cost the
   whole listing.
3. For a selection you will act on, narrow `dokito projects` or `dokito tasks`
   with `--area` and `--status` rather than reading every item; see "Bounded
   global listings" in [references/workflows.md](references/workflows.md).
4. Treat these listings as discovery metadata. They identify each item by Area
   and file identity, omit full Markdown content, and print warnings for skipped
   Areas. `dokito tasks` reads only local Tasks and makes no network calls.
5. If the user only asked for an overview, answer from the summary. Before
   reading or editing a selected item, take its Area root from `dokito areas`,
   run `dokito --cwd <areaRoot> context`, and locate the shown file identity
   inside the printed collection path.
6. For broader cross-Area work beyond Project or Task metadata, run
   `dokito search '<query>' --all`, which needs no resolved directory, or
   iterate only available registry entries and discover files inside each
   returned collection path.

Do not scan an arbitrary parent directory to infer registration. Do not link a
generic agent workspace such as an OpenClaw workspace merely to make context
resolution pass. Create a new Area only when the user explicitly asks for one.

## Write links

A link names one thing by its filename, never by a document title and never by
a path relative to the writer. Keep the display text free: `[[filename|what to
read]]`.

- A Resource: its filename, or as much of the trailing path as it takes to be
  unambiguous. `[[Data retention]]`, `[[platform/overview]]`.
- A Project: `[[project:<filename slug>]]`. A bare filename also reaches a
  Project; the prefix says which kind is meant and keeps the link readable.
- A Task: `[[task:<ULID>|what it is]]`. The prefix is required here, because
  only the ULID is the Task's identity and the slug after it is free to change.
  Always give a Task link display text: a bare ULID tells a reader nothing.
- A file in a connected Repository: `[[repo:<repository id>/<path>]]`.

Never write a machine path such as `/Users/...` or `~/...` into an Area. It is
wrong on every other machine and defeats sharing the Area. Reference the
Repository instead, and run `dokito resolve <target>` when a real local path is
needed for the current step. The target is what stands inside the
brackets, without `[[...]]` and without `|display text`.

Link only within the current Area. When something belongs to another Area, say
so in prose; `dokito resolve` finds it across every registered Area.

## Choose the workflow

- For file shapes, identities, and allowed fields, read
  [references/formats.md](references/formats.md).
- For Project, Repository, Task, and Markdown-link relations,
  read [references/relations.md](references/relations.md).
- Before creating, updating, archiving, or removing anything, read
  [references/workflows.md](references/workflows.md).
- For direct edits, concurrent changes, deletion, Git, and completion checks,
  read [references/safety.md](references/safety.md).

Read each reference file you select to the end, one at a time. After truncated
output, continue from the last confirmed line instead of treating what you saw
as the whole rule.

## Create an Area

Create an Area only when the user asks.

1. Confirm its ID, name, target path, and, when relevant, Repository identities
   from canonical GitHub remotes.
2. Inspect version-controlled READMEs, documentation indexes, and relevant
   manifests. Use only confirmed facts.
3. Create `dokito.yaml`, `context.md`, `.gitignore`, `projects/`, `resources/`,
   and `tasks/` according to `references/formats.md`. Preserve existing files
   and reject conflicting Area identity instead of overwriting it.
4. Run `dokito register <area-path>`. Initialize Git only for a new standalone
   Area and never create a remote or push. Registration automatically
   records verified sibling checkouts named by Repository ID.
5. Curate `context.md`, run `dokito validate`, then run `dokito context` in the
   Area and every connected Repository.
6. If a standalone Git repository was initialized, commit the curated Area
   automatically after successful validation. Never commit into an existing
   or parent worktree.

## Structured changes

A bounded unit is one Area and one goal. Immediately before its first write,
resolve the scope again with `dokito context` and record the baseline with
`dokito validate`. Repeat that preflight after an Area switch, an interruption,
or whenever the resolved context can be stale. Consecutive patches inside one
uninterrupted unit do not repeat it.
Read the target and its typed relation dependencies immediately before editing.
Use a context-aware patch and preserve unrelated frontmatter, prose, links,
lists, and checkboxes.

Create a Task ID with `dokito id`, then create its Markdown file directly. No
Dokito model has a CLI CRUD command.

After every structured write:

1. Run `dokito validate`.
2. Re-read every changed Dokito file.
3. Inspect the focused diff.
4. Repair errors introduced by the change before reporting completion.

After the requested Area writes are final, follow the Git completion workflow
in `references/safety.md` and commit the validated Area changes automatically.

Do not rewrite unrelated invalid files merely to make validation pass. Report
pre-existing errors separately when they block a trustworthy result.

## Task lifecycle

When work starts from an explicitly selected Task, patch only that Task's
`status` to `in_progress` and validate the Area. Patch it to `done` only after
the requested work and its checks succeed. Add Tasks or choose `waiting`,
`someday`, or `cancelled` only when the user requests that state change.

## Web runtime

Start Dokito Web only on explicit request. Use `dokito web start` for a
background process, `dokito web status` to inspect it, and `dokito web stop` to
stop it. Use `dokito web` for foreground operation and pass `--config` for a
non-default local configuration.
