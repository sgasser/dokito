# File workflows

## Discover and read

Run `dokito context`, then use the printed paths. Read `dokito.yaml` for
Repository registrations.

Resolve a known reference with `dokito resolve '<target>'`. Find an unknown
document with `dokito search`; it ranks filename, title, heading, then content.

```bash
dokito search 'data retention'
dokito search 'retention' --type resources --limit 5
dokito search 'retention' --all          # every registered Area
```

Each hit includes its Area and relative path. For `--all`, get the Area root
from `dokito areas` before opening the file. Narrow large result sets with a
more specific query or `--type`.

## Bounded global listings

Use `--summary` for counts. Without it, `projects` and `tasks` return every
item; add `--area` and `--status` before reading a narrower listing.

```bash
dokito projects --summary
dokito tasks --area product --status in_progress
```

## Create

1. Validate the Area and read the owning manifest plus relation targets.
2. Choose the identity from the user intent. Ask only when an identity or
   relation choice would materially change the result.
3. Refuse a collision with an existing path or identity.
4. Create one file from the canonical shape in `formats.md`.
5. Add prose directly to that file.
6. Validate, re-read, and inspect the diff.

For a Task, run `dokito id` and use the printed ID as the filename prefix.

## Update

1. Validate the baseline.
2. Read the exact current target and every affected relation target.
3. Patch only the intended scalar, list, or prose.
4. Preserve the rest of the bytes where the editing tool permits.
5. Validate, re-read, and inspect the diff.

An Area or Resource is active when its `state` field is omitted. Clearing an
optional Project or Task property means removing that field rather than
writing `null` or an empty scalar.

## Change many files

Split work that crosses Areas or many files into bounded units, normally one
Area and one goal per patch, and validate after every unit. One large patch
hides which change broke validation.

## Remove

Remove only when deletion is the intended user outcome. Search typed relations
and Markdown links first. Re-read the exact target immediately before removal,
remove only that identity, validate, and report any links that intentionally
remain unresolved.
