# Contributing to Dokito

Dokito is early-stage. External contributions are currently limited to:

- bug fixes with a reproducible failure;
- regression tests for confirmed bugs;
- corrections to documentation about existing behavior.

Feature PRs, new integrations, data-model changes, dependency changes, and
unrelated refactors are not accepted for now.

## Fix workflow

1. Include the affected command, reproduction steps, expected result, and
   actual result in the pull request.
2. Add a regression test with the fix.
3. Update the CLI reference or specification when behavior changes.
4. Run:

```bash
bun install
bun run check
bun run build
```

Small documentation corrections can go directly to a pull request.

## Code layout

- `src/core` — domain model, file formats, scope resolution, and every read
  and write;
- `src/cli` — argument parsing and output on top of the core;
- `src/web` — the server-rendered, read-only Web view, using the same core
  readers as the CLI;
- `tests` — Bun tests, with shared fixtures under `tests/fixtures`.

## Requirements

- Keep Markdown and YAML as canonical data sources.
- Do not add Dokito files to connected code repositories.
- Fail on ambiguous writes instead of guessing.
- Do not include private or production data in fixtures.
- Do not commit `dist/`.

`bun run check` regenerates the Web assets, lints the sources, type-checks the
code, rejects unused files, exports, and dependencies, and runs the tests. Keep
generated asset changes with the sources that produced them.

## Pull requests

Explain the bug, the fix, and how it was verified. Keep the change focused.

By contributing, you agree that your work is licensed under the
[Apache License 2.0](LICENSE).
