# File workflows

## Discover and read

Run `dokito context`, then use the printed paths. Read `dokito.yaml` for
Repository registrations.

A reference you already hold never needs a search: `dokito resolve '<target>'`
prints its path directly. To find a document you cannot name yet, work outwards
from the narrowest signal and stop at the level that answers, because the
search is lexical and unranked and a body match on a common word says nothing
about what the document is about:

```bash
rg --files projects resources tasks | rg -i '<term>'   # identity
rg -ni '^#{1,6}.*<term>' projects resources tasks      # heading
rg -ni '<term>' projects resources tasks               # body
```

Bound a broad body search before printing it: pass `--max-count` or count the
hits first, so a common word cannot fill the answer with prose.

## Bounded global listings

`dokito projects --summary` and `dokito tasks --summary` answer a global
overview with the total, the count per status, the count per readable Area, and
the warnings the listing would report. Their output stays a few lines whatever
the registry holds, so use them for counts, totals, and a compact picture.

Without `--summary`, both commands return every item of every registered Area.
Narrow the listing with `--area` and `--status` before it reaches your output,
and never repeat a listing merely because an unnarrowed first attempt was
truncated.

```bash
dokito projects --summary
dokito tasks --area product --status in_progress
```

Both filters are checked: an Area that was not read and a status the model does
not define fail instead of answering with an empty list. Every item still names
its Area and its file identity, and the warnings are printed with the listing,
so the next step needs no second tool.

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
