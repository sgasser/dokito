# CLI reference

Dokito's Markdown and YAML files are the model interface. The CLI does not
provide CRUD commands for Areas, Repositories, Projects, Resources, or
Tasks. It owns machine-local setup and Area-registry discovery, global
read-only Project and Task listings, scope resolution, validation, Task ID
generation, and the local Web runtime.

Run `dokito --help` to inspect the commands available in the installed binary.

## Global usage

```text
dokito [--json] [--config <path>] <command>
```

| Option | Behavior |
|---|---|
| `--json` | Return structured JSON |
| `--config <path>` | Use a different local configuration file |
| `--version`, `-v` | Print the Dokito version |
| `--help`, `-h` | Print command help |

`--cwd <path>` resolves the Area and Repository from another directory. Only
`register`, `context`, `resolve`, and `validate` work from a resolved Area, so
only they accept it. No other command resolves one, so they reject `--cwd`
rather than accepting it and ignoring it.

The configuration path comes from `--config`, `DOKITO_CONFIG_PATH`,
`$XDG_CONFIG_HOME/dokito/config.yaml`, or `~/.config/dokito/config.yaml`, in
that order. It contains absolute Area paths and Area-relative Repository paths
for this machine and must not be committed.

A path named through `--config` or `DOKITO_CONFIG_PATH` must exist before
`areas`, `projects`, `tasks`, and `resolve` read it; otherwise a mistyped path
would answer with an empty registry instead of `config_not_found`. `register`
creates the file, so it accepts a path that is not there yet.

```yaml
areas:
  product:
    path: "/Users/example/Work/product-area"
    repositories:
      web-app:
        path: "../web-app"
```

Repository paths identify one canonical checkout and may leave the Area
directory. When an entry is absent, that Repository has no local checkout.
Absolute Repository paths are rejected.

## JSON output

Every command accepts `--json`. Successful commands return:

```json
{"ok": true, "data": {}}
```

Errors return a non-zero exit code and:

```json
{"ok": false, "error": {"code": "source_not_found", "message": "..."}}
```

Domain errors use stable codes. Human-readable commands print errors and
warnings to standard error.

## `dokito register`

```bash
dokito register <area-path>
```

Registers an existing Area from its directory in machine-local configuration.
The target must be a real directory with a valid `dokito.yaml`; the manifest
supplies the Area ID and name. The command does not create or change Area files,
initialize Git, commit, create a remote, or push.

For each registered Repository, Dokito checks the sibling directory named by
its ID. A sibling that is a Git root and, when configured, has a matching
GitHub remote is recorded as that Repository's canonical local checkout.
Discovery skips a checkout already assigned to another Repository. Paths for
Repositories no longer present in the Area manifest are removed.
Repeating the same registration is a successful no-op unless it discovers a
previously absent checkout. Registering the same Area ID at a different path
fails with `area_registration_conflict`.

The `data` object contains:

```json
{
  "area": "product",
  "name": "Product",
  "path": "/workspace/product-area",
  "manifestPath": "/workspace/product-area/dokito.yaml",
  "configPath": "/Users/example/.config/dokito/config.yaml",
  "changed": true
}
```

## `dokito areas`

```bash
dokito areas
```

Lists every Area in the machine-local registry. Unlike scope-dependent
commands, it works from any directory, including an unconnected agent
workspace. Human output shows the Area ID, name, path, availability, and
Repository count.

With `--json`, `data` contains the configuration path, stable
ID-sorted Area entries, and warnings:

```json
{
  "configPath": "/Users/example/.config/dokito/config.yaml",
  "areas": [
    {
      "id": "product",
      "name": "Product",
      "path": "/workspace/product-area",
      "available": true,
      "repositoryCount": 3
    }
  ],
  "warnings": []
}
```

Unavailable or mismatched registrations remain visible with
`available: false` and a structured `error`. Select an available Area and run
`dokito --cwd <area-path> context --json` before reading or editing its files.

## `dokito projects` and `dokito tasks`

```bash
dokito projects
dokito tasks
```

These commands list every Project or local Markdown Task from every readable
registered Area without resolving the current directory. Human output prefixes
each item with its Area and ID, then shows its status, title, and useful typed
metadata, including a Task's optional assignee.

With `--json`, `data` contains the configuration path, readable Area count,
`projects` or `tasks`, and warnings. Every item includes `area`, `areaName`,
`areaRoot`, `relativePath`, and its typed document metadata:

```json
{
  "configPath": "/Users/example/.config/dokito/config.yaml",
  "areaCount": 1,
  "projects": [
    {
      "area": "product",
      "areaName": "Product",
      "areaRoot": "/workspace/product-area",
      "id": "launch",
      "status": "active",
      "repositories": ["web-app"],
      "due": "2026-08-12",
      "title": "Launch the product",
      "outcome": "The Web app is available and the release is verified.",
      "relativePath": "projects/launch.md"
    }
  ],
  "warnings": []
}
```

The complete Markdown `content` is omitted. Three cases produce a warning:

- an Area that cannot be read at all is skipped, and `areaCount` excludes it;
- a document that cannot be read is skipped by name, while every other document
  in that Area is still listed and `areaCount` counts the Area as read;
- a Task whose Project cannot be resolved is listed, with a warning that its
  reference is unresolved.

## `dokito context`

```bash
dokito context [--raw]
```

Resolves the current Area from an Area directory or connected code Repository.
Human output includes the resolved Area root, optional Repository, collection
paths and counts, followed by the exact `context.md`. The context is limited
to 64 KB.

With `--json`, `data` contains the exact context and authoritative paths
needed for direct file work:

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

`repository` and `codeRoot` are omitted when resolution starts inside the Area
directory. Counts cover discoverable Markdown files but do not parse every
document. `--raw` writes only `context.md` and cannot be combined with
`--json`.

## `dokito resolve`

```bash
dokito resolve <reference>
```

Turns a link target into absolute local paths. It searches every registered
Area rather than only the current one and returns every match, because a
person or an agent asking where a name lives is the one who knows which match
they meant. Matches in the Area of the working directory come first.

The reference is the target inside the Wikilink, without `[[...]]` and without
`|display text`.

```bash
dokito resolve "Data retention"
dokito resolve project:launch
dokito resolve task:01K1ABCXYZ0000000000000000
dokito resolve repo:web-app/docs/SPEC.md
```

With `--json`, `data` contains the configuration path, the reference, the Area
of the working directory when it resolves to one, `matches`, and warnings:

```json
{
  "configPath": "/Users/example/.config/dokito/config.yaml",
  "reference": "repo:web-app/docs/SPEC.md",
  "area": "product",
  "matches": [
    {
      "kind": "repository",
      "area": "product",
      "areaName": "Product",
      "areaRoot": "/workspace/product-area",
      "repository": "web-app",
      "path": "/workspace/web-app/docs/SPEC.md",
      "exists": true
    }
  ],
  "warnings": []
}
```

A document match carries `relativePath` instead of `repository`. A configured
checkout that is currently absent is still a match, with `exists: false`, so
the intended location stays visible.

Three cases fail with a non-zero exit code: `reference_invalid` for Wikilink
syntax or a target that is not a filename or a known prefix,
`reference_not_found` when no registered Area holds it, and
`repository_not_local` when an Area registers the Repository but no checkout is
configured for it on this machine.

## `dokito validate`

```bash
dokito validate [--links]
```

Validates the resolved Area manifest, the `context.md` size, every strict
Project and Task document, and their typed relations. It also reads every
Resource and checks local Markdown links.

Without `--links` it reads only the Area and its manifest, so it reaches the
same verdict on every machine the Area is shared with. `--links` adds the
machine-dependent checks: it resolves each `repo:` target against this
machine's configured checkouts and reports which other registered Area holds a
name the current one does not.

Malformed typed documents and invalid structured relations fail with a
non-zero exit code and stable domain error. Every other command skips such a
document and keeps reading; `validate` is the command that rejects it, and it
reports every unreadable document it found in `details.problems`.

Unknown Area or Resource states, a missing H1 in `context.md`, a Resource
whose H1 says something its filename does not,
and unresolved, ambiguous or relative links are successful warnings. An
ambiguous link names the documents that share the filename, and a relative link
names the form to write instead.

With `--json`, `data` contains the Area ID, context path, byte count and
state, collection paths and counts, and `warnings`.

## `dokito id`

```bash
dokito id
```

Generates one uppercase 26-character ULID. Use it as the identity prefix for a
new Task filename. This command does not resolve or change an Area.

With `--json`, the generated value is returned as `data.id`.

## `dokito web`

```bash
dokito web [--port <port>]
dokito web start [--port <port>]
dokito web status
dokito web stop
```

`dokito web` starts the local, read-only Web view on `127.0.0.1` in the
foreground. Requests whose Host is not `127.0.0.1`, `[::1]`, or `localhost`
are rejected.

Without an explicit port, Dokito tries `4176` through `4185` and reuses an
existing Dokito instance. An explicit port must be between 1 and 65535 and
fails when another service uses it.

`dokito web start` runs Dokito in the background. It survives closed terminals
but not a restart or crash, and repeated starts are a no-op. `status` verifies
the runtime identity; `stop` verifies it before sending `SIGTERM`.

Managed state and logs use `<config>.web.json` and `<config>.web.log`. JSON
output includes the log path.

The Web view reads Area files directly. It browses Resources, Projects, Tasks,
and search results. It does not edit Markdown.

## Direct model changes

Create and edit `dokito.yaml`, `context.md`, and Markdown documents with an
editor or agent. Use `dokito context --json` to obtain the resolved paths,
`dokito id --json` for a new Task identity, and `dokito validate --json`
before and after a structured change.

The canonical formats and relation rules are defined in the
[specification](SPEC.md). The bundled Dokito skill adds a safe direct-edit
workflow for agents.

## Common errors

Dokito reports malformed data, unsafe paths, unresolved or ambiguous Areas and
Repositories, missing files, and oversized context as explicit errors. Use
`--json` when another program needs stable error codes and details.

A directory that no Area covers fails in one of two ways. Outside a Git
worktree it is `area_not_resolved`; inside one it is `repository_not_matched`,
because the remotes and configured Repository paths were read and matched
nothing. An agent workspace is usually a checkout, so it meets the second.
Either way `dokito areas` lists what is available instead.
