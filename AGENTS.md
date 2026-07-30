# Dokito agent guide

## Repository map

- `src/core` owns the domain model, file formats, scope resolution, and all
  reads and writes.
- `src/cli` handles arguments and output on top of the core.
- `src/web` is the read-only Web view and uses the core readers.
- `docs/SPEC.md` defines file formats and runtime behavior.
- `docs/CLI.md` documents the command-line contract.
- `CONTRIBUTING.md` defines repository invariants and the required change
  workflow; read it before changing behavior.
- `tests` contains Bun tests and shared fixtures.

## Develop and verify

Use Bun. Run the narrowest relevant test while iterating, then run
`bun run check` for a complete validation. Run `bun run build` when the change
can affect the compiled CLI, and `bun run test:e2e` for browser workflows.

Edit `src/web/client.ts` and `src/web/styles.css`, not their generated
counterparts. `bun run check` regenerates the Web assets. Keep the generated
changes that correspond to source changes, and never commit `dist/`.
