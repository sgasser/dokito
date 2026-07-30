# File workflows

## Discover and read

Run `dokito context --json`, then use the returned paths. Read `dokito.yaml`
for Repository registrations. Use `rg --files` in a collection for
identity discovery and `rg -n` for content search.

## Create

1. Validate the Area and read the owning manifest plus relation targets.
2. Choose the identity from the user intent. Ask only when an identity or
   relation choice would materially change the result.
3. Refuse a collision with an existing path or identity.
4. Create one file from the canonical shape in `formats.md`.
5. Add prose directly to that file.
6. Validate, re-read, and inspect the diff.

For a Task, run `dokito id --json` and use `data.id` as the filename prefix.

## Update

1. Validate the baseline.
2. Read the exact current target and every affected relation target.
3. Patch only the intended scalar, list, or prose.
4. Preserve the rest of the bytes where the editing tool permits.
5. Validate, re-read, and inspect the diff.

An Area or Resource is active when its `state` field is omitted. Clearing an
optional Project or Task property means removing that field rather than
writing `null` or an empty scalar.

## Remove

Remove only when deletion is the intended user outcome. Search typed relations
and Markdown links first. Re-read the exact target immediately before removal,
remove only that identity, validate, and report any links that intentionally
remain unresolved.
