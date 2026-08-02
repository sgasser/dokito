# Specification

This document defines the current file formats and runtime behavior of Dokito.
It is the technical reference for implementers and integrations. Start with the
project [README](../README.md) if Dokito is new to you.

The terms Area, Repository, Project, Resource, and Task are capitalized
when they refer to Dokito model types.

## Domain model

| Model | Identity | Purpose |
|---|---|---|
| Area | lowercase slug in `dokito.yaml` | durable product or responsibility |
| Repository | lowercase slug registered by an Area | external codebase identified by a GitHub remote or canonical local path |
| Project | lowercase filename slug | outcome with a beginning and an end |
| Resource | Area-relative Markdown path | reference material that stays useful |
| Task | 26-character ULID | tracked piece of work |

The Area owns its Markdown documents. Repositories remain external: Dokito
stores their identities and relations, not copies of their data.

The Area, Project, and Resource terminology is inspired by the
[PARA method](https://fortelabs.com/blog/para/). Dokito does not reproduce
PARA's folder hierarchy: an Area owns its Projects and Resources, inactive
documents remain in their collections through state or status, and Tasks form
a separate execution model.

### Relations

Dokito separates structured operational relations from free-form knowledge
relations.

| Source | Stored relation | Target | Cardinality | Invariant |
|---|---|---|---|---|
| Area | `repositories` in `dokito.yaml` | Repository | zero to many | every Repository ID is unique inside the Area |
| Project | `repositories` | Repository | zero to many | every ID is registered by the Area |
| Task | `project` | Project | zero or one | the Project exists in the same Area |
| Task | `repository` | Repository | zero or one | the Repository is registered by the Area |
| Document | Markdown or wiki link | Area document or Repository | zero to many | unresolved and ambiguous targets produce a validation warning |

When a Task carries both `project` and `repository`, that Repository must
appear in the Project's `repositories` list. `dokito validate` rejects an Area
where a Task names a Project–Repository pair that violates this relation.

Projects, Tasks, and Resources link supporting documents in prose. Unresolved
and ambiguous links are validation warnings; see
[Links and references](#links-and-references) for how a target is written.

Some relations are derived rather than stored:

- a Project's Tasks are the Tasks whose `project` names it;
- a Repository's relevant Tasks include Tasks attached directly to it and
  Tasks attached to an active Project that references it.

### Relation selection

A Project lists every Repository needed to deliver its outcome and omits the
field for non-software work. A Task names a Project when it is part of that
Project's work, either by advancing its outcome or as direct, bounded
follow-up. Project and Task statuses are independent. Use Markdown links alone
for thematic, historical, or secondary relations. A Task names a Repository
only when it directly applies to that codebase; Project-wide coordination can
carry `project` without `repository`.

Agents and editors choose relations from the current `dokito.yaml`, Projects,
and Tasks. Scope resolution identifies the current Area and optional
Repository, but it does not infer new model relations.

### File contract

The canonical Markdown and YAML files are the complete discovery and mutation
interface for every model. There is no parallel CRUD command set. Editors and
agents discover documents from the resolved collection paths, read the
current files, and make targeted changes directly.

The CLI owns only machine-local registration and registry discovery, global
read-only Project and Task listings, scope resolution, validation, Task
ULID generation, and the Web runtime. Before and after a structured file
change, agents run `dokito validate`. Identities come from manifest keys or
document paths and remain stable unless the file or key is intentionally
renamed after all typed and Markdown relations have been checked.

## Area and Repository models

### Area

An Area is a durable responsibility, typically a product or a broader scope
such as Personal. Its Markdown files live together in an Area directory.
The Area ID comes from `dokito.yaml`, not from the directory name.

```text
product-area/
├── .gitignore
├── dokito.yaml
├── context.md
├── projects/
├── resources/
└── tasks/
```

An Area records its state and context in `context.md`:

```markdown
---
state: paused
---

# Writing

Paused while the product launch runs.
```

| Area property | Required | Storage and value |
|---|---|---|
| `id` | yes | immutable lowercase slug in `dokito.yaml` |
| `name` | yes | non-empty display name in `dokito.yaml` |
| `state` | no | `active`, `paused`, or `archived` in `context.md`; omission means active |
| Context title | no | first H1 in `context.md` |
| Context prose | no | free-form Markdown after optional frontmatter |

Unknown states are read as active and reported as validation warnings. A
missing H1 is also a warning; the Web view falls back to the filename.

Create the manifest, context, and collection directories directly, then use
`dokito register <area-path>` to record the existing Area locally. Registration
does not scaffold files or mutate Git.

#### Manifest

Every Area starts with:

```yaml
version: 1
id: personal
name: Personal
```

Software Repositories are added when relevant:

```yaml
version: 1
id: product
name: Product

repositories:
  web-app:
    github: example/web-app
```

### Repository

Repository registrations contain an optional GitHub identity. A canonical
checkout can be recorded in the machine-local Area registration. Every
connected Repository resolves the same Area `context.md`.

| Repository property | Required | Storage and value |
|---|---|---|
| `id` | yes | immutable lowercase key in `dokito.yaml` |
| `github` | no | normalized `owner/repository` identity |
| local path | no | one path relative to the registered Area path in machine-local configuration, never stored in the Area |

## Scope resolution

Dokito has two Area entry paths.

Inside an Area directory, Dokito resolves the nearest `dokito.yaml` directly.

```text
current directory
→ nearest Area manifest
→ owning Area
```

For connected software work, Dokito keeps its configuration in the Area
directory and identifies the Repository by its Git remotes:

```text
current directory
→ Git worktree root
→ configured Git remotes
→ matching Repository registration
→ owning Area
```

GitHub SSH and HTTPS remotes normalize to the same `owner/repository` identity:

```text
git@github.com:example/web-app.git
https://github.com/example/web-app.git
→ example/web-app
```

Dokito checks all configured remotes, so an `upstream` can identify a checkout
whose `origin` is a fork. When remote matching is missing or ambiguous, an
exact canonical Repository path in machine-local configuration can select the
Area and Repository. A single valid remote match takes precedence over the
configured path.

## Project model

Projects are typed Markdown documents stored directly under `projects/`. The
filename is the Project ID and must be a lowercase slug:

```text
projects/launch.md
```

```markdown
---
status: active
repositories:
  - web-app
  - api
due: "2026-08-12"
---

# Launch the product

Outcome: The Web app is available and the release is verified.
```

| Project property | Required | Storage and value |
|---|---|---|
| `id` | yes | immutable lowercase filename slug |
| `status` | yes | `planned`, `active`, `done`, or `cancelled` in frontmatter |
| `repositories` | no | Repository IDs registered by the Area, stored in frontmatter |
| `due` | no | quoted `YYYY-MM-DD` calendar date in frontmatter |
| title | yes | first H1 |
| outcome | no | first prose paragraph after the H1; optional `Outcome:` prefix is ignored |
| note | no | second prose paragraph after the H1 |
| content | no | complete Markdown document, including later free-form prose and links |

Project frontmatter is strict and unknown fields are rejected. Before removing
a Project or Repository relation, check every Task for typed dependencies.
Markdown links are not rewritten automatically.

## Resource model

Resources are Markdown files discovered recursively under `resources/`. Their
normalized relative path is their identity; nested directories and spaces in
filenames are allowed. Resources need no registration and are not included
automatically in `context.md`.

A Resource can say that it has been superseded:

```markdown
---
state: archived
---

# Pricing thinking
```

| Resource property | Required | Storage and value |
|---|---|---|
| identity | yes | normalized Area-relative `.md` path below `resources/` |
| `state` | no | `active` or `archived`; omission means active |
| title | no | first H1, otherwise derived from the filename |
| content | no | free-form Markdown |

Frontmatter and an H1 are optional. Unknown states are read as active, and a
missing title is derived from the filename; both produce validation warnings.
Resources use Markdown links rather than typed relation frontmatter.

## Task model

Important Tasks use one typed Markdown file each, stored directly under
`tasks/`:

```text
tasks/01K1ABCXYZ0000000000000000-revise-privacy-notice.md
```

The uppercase 26-character ULID prefix is the Task ID. The remaining filename
contains lowercase letters, digits, and hyphens and does not affect identity.
Task IDs must be unique within an Area.

```markdown
---
status: todo
project: launch
repository: web-app
priority: high
due: "2026-08-05"
---

# Revise the privacy notice

Explain which customer data the Web app sends to the API.
```

| Task property | Required | Storage and value |
|---|---|---|
| `id` | yes | immutable uppercase 26-character ULID at the start of the filename |
| `status` | yes | `todo`, `in_progress`, `waiting`, `someday`, `done`, or `cancelled` in frontmatter |
| `project` | no | lowercase ID of an existing Project in frontmatter |
| `repository` | no | Repository ID registered by the Area in frontmatter |
| `priority` | no | `low`, `normal`, `high`, or `urgent` in frontmatter |
| `due` | no | quoted `YYYY-MM-DD` calendar date in frontmatter |
| title | yes | first H1 |
| description | no | first prose paragraph after the H1 |
| content | no | complete Markdown document, including later free-form prose, links, and checklists |

`dokito id` generates a new Task ULID; the caller creates the filename,
frontmatter, H1, and prose directly. Task frontmatter is strict and unknown
fields are rejected. Clear optional fields by removing them, not by writing
`null` or an empty scalar. Any status transition is valid.

## Links and references

A link names one thing by its filename. Nothing resolves through a document
title, so a title stays display text and only the filename has to be kept in
agreement. An Area references only itself and its own Repositories, which is
what lets it be shared on its own.

| Written | Means |
|---|---|
| `[[Data retention]]` | the document with that filename, in any collection |
| `[[platform/overview]]` | enough of the path to be unambiguous |
| `[[resources/platform/overview.md]]` | the complete Area-relative path |
| `[[project:launch]]` | the Project with that filename |
| `[[task:01K1ABCXYZ0000000000000000]]` | the Task with that ULID |
| `[[repo:web-app/docs/SPEC.md]]` | a path inside a registered Repository |

Both Markdown and wiki syntax carry any of these, and the display text is
independent of the target in either.

A filename alone reaches any collection, so `[[launch]]` finds
`projects/launch.md`. The `project:` and `task:` prefixes say which kind is
meant and narrow the search to it. A `task:` target is the bare ULID and
nothing else: the slug after it is not part of the identity, so a link that
carried it would depend on a name that is free to change. Anything following
either identity, as in `project:a/b`, is reported rather than resolved.

A target is the end of exactly one document's Area-relative path, matched
without regard to case and with `.md` optional. When several documents end the
same way, the one nearest the linking document in the collection tree wins,
counting steps up to the nearest shared folder and back down. A complete Area
path outranks a longer path that merely ends the same way.

Documents that remain equally near are ambiguous. Dokito resolves nothing and
`validate` names them, because a duplicate filename is fixed once at its source
rather than silently at every link that reaches it. Relative targets containing
`..` do not resolve; the warning names the form to write instead.

A `repo:` target is not a document. It never appears in the Area link graph,
and the Area manifest is what decides whether its Repository is known. Whether
a checkout exists is a fact about the current machine, so it is checked only by
`dokito validate --links` and never changes whether an Area is valid. Having no
page to open, it renders in the Web view as code rather than as a link.

`dokito resolve` turns any of these into absolute local paths, searching every
registered Area and returning every match rather than choosing one.

## Context

`dokito context` resolves the current Area from either an Area directory or a
connected Repository, reads `context.md`, enforces a 64 KB limit, and writes
the available Project, Resource, and Task counts and paths followed by the
file. It never adds Repository, Project, Task, revision, source, or instruction
text to the context itself.

Structured output returns the exact file content as `data.context`, non-fatal
resolution warnings as `data.warnings`, and one collection object for Projects,
Resources, and Tasks. The `data` object is:

```json
{
  "area": "product",
  "areaName": "Product",
  "areaRoot": "/workspace/product-area",
  "manifestPath": "/workspace/product-area/dokito.yaml",
  "contextPath": "/workspace/product-area/context.md",
  "repository": "web-app",
  "codeRoot": "/workspace/web-app",
  "resolution": "git_remote",
  "context": "# Product\n",
  "projects": {
    "path": "/workspace/product-area/projects",
    "count": 1
  },
  "resources": {
    "path": "/workspace/product-area/resources",
    "count": 5
  },
  "tasks": {
    "path": "/workspace/product-area/tasks",
    "count": 2
  },
  "warnings": []
}
```

`repository` and `codeRoot` are omitted when the command resolves from inside
the Area directory.

Counts cover discoverable Markdown files in each collection. They do not parse
or validate every document, so one malformed Project, Resource, or Task cannot
prevent context from loading. Symlinks and excluded files are not counted.

`--raw` writes only the exact `context.md` content. It cannot be combined with
`--json`.

Projects, Resources, and Tasks are never implicit context sources. Agents use
the returned collection paths to discover and search only the files relevant
to the request.

## Validation

`dokito validate` resolves the current Area, verifies `dokito.yaml`, reads
`context.md` within its 64 KB limit, parses every Project and Task with the
strict runtime readers, enforces cross-Project Repository relations, and reads
every discovered Resource as UTF-8 Markdown. Invalid typed documents,
structured relations, references, dates, paths, and headings fail with a
domain error and non-zero exit status.

Reading and validating differ on purpose.

Every command except `validate` skips a document it cannot parse, reports it by
name, and keeps the rest of the Area readable, so one malformed file never
hides the work around it. A file the operating system refuses is treated the
same way: it is a fact about that file, not about the Area.

A relation never removes a document. A Task whose Project is missing or
unreadable stays in the result, because the Task's own file is readable and the
work is real. Its warning states that the reference is unresolved rather than
that the Task was skipped.

Free-form conventions do not make an Area invalid. An unknown Area or Resource
state, a missing H1 in `context.md` or a Resource, and an unresolved, ambiguous
or relative link produce warnings while the command succeeds. Structured output
returns the Area, context state and byte count, collection paths and counts,
and warnings.

The default pass reads only the Area and its manifest, so it reaches the same
verdict on every machine the Area is shared with. `--links` adds the checks that
cannot: it resolves each `repo:` target against this machine's checkouts and
reports which other registered Area holds a name this one does not.

## Local configuration

```yaml
areas:
  product:
    path: /Users/example/Workspace/Projects/product-area
    repositories:
      web-app:
        path: ../web-app
```

Area paths are absolute. Each Repository path is relative to its Area path,
belongs only to the current machine, and identifies one canonical checkout.
Relative paths may leave the Area directory so the common sibling layout works.
Absolute Repository paths are invalid.

`dokito register <area-path>` adds an existing valid Area to the `areas`
mapping. It records sibling Git roots named by Repository ID when their
configured GitHub identities match, unless that checkout already belongs to
another configured Repository. Registration preserves configured paths for
Repositories still in the manifest and removes paths whose Repository key is
no longer present. Repeating the same Area and path is a no-op unless the
resulting registration changes; registering the same ID at another path fails.

When a Repository path is absent, that Repository has no local checkout.
Runtime scope resolution and the Web view use only paths recorded in this
configuration.

`dokito areas` lists the complete machine-local `areas` registry without
resolving the current directory. It returns available Areas with their
manifest identity and Repository count, keeps unavailable registrations
visible with structured errors, and allows an unscoped agent workspace to
select an Area before running `dokito --cwd <area-path> context`.

`dokito projects` and `dokito tasks` also work without resolving the current
directory. They parse the canonical Markdown documents in every readable
registered Area, attach Area identity and paths to each result, omit full
Markdown content, and list every local item. Invalid or unavailable Areas do
not hide readable Areas and produce warnings.

## Local Web view

Dokito Web is a local, read-only interface:

- Requests are accepted only for a Host of `127.0.0.1`, `[::1]`, or `localhost`.
- **Focus** answers what needs attention now, across every Area in scope.
- **Tasks** shows Markdown Tasks grouped by status.
- **Projects** summarizes Projects and their next open work.
- **Resources** lists `context.md` and Resources, hiding archived material by
  default.

The default view opens Resources in the first readable active Area, then a
paused or archived Area. Area navigation changes the selected Area. Tasks,
Projects, and Resources are Area-scoped. Search reads every Area but keeps one
in its address; Focus is the only destination without an Area at all, so
`/focus` is the whole path.

### Focus

Focus reads open Tasks and active Projects from every Area in scope and admits
three disjoint bands, in this order:

- **Urgent** — any open Task with `priority: urgent`, whatever its status.
- **In progress** — the remaining Tasks with `status: in_progress`.
- **Due soon** — whatever else falls due within fourteen calendar days of the
  reader's local day. Overdue work is included, undated work is not.

Each band is ordered by due date, undated last; an empty band is not rendered.
Membership follows the date rather than the status, so what no band admits is
exactly the open work that is undated or due later. A line below the bands
counts it and carries one link per holding Area, with that Area's count, to its
Tasks list.

Scope is active Areas by default; `?areas=paused` adds paused Areas. Archived
Areas never appear. Opening a row switches the selected Area to the one that
owns the Task or Project and carries no filter across.

Active Projects follow the same rule as the bands: those a band reached are
listed with that next Task, their open Task count, Area, and due date; the rest
are counted in one line.

A Task remains backed by its Markdown file. It can start in
[Conductor](https://www.conductor.build/), a Mac app for coding agents, when
Dokito resolves the canonical local checkout for one related Repository and
finds Conductor on macOS.

The Web view does not edit documents. The Web server returns `400` for invalid
query input, `404` for unknown Areas or documents, and `500` only for
configuration or internal failures. It binds to `127.0.0.1`.

## Runtime constraints

Every address renders as a complete server-side page and works without
client-side JavaScript. In browsers that support intercepted navigation,
same-Area GET navigation may progressively request and replace only the main
region. Direct requests, reloads, unsupported browsers, Area changes, and
failed enhancements still use the complete page. Area files are read directly
on each request and are never mutated by the runtime. Local registration
writes use atomic replacement.
