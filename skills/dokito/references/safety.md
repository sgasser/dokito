# Editing and completion safety

- Use a targeted, context-aware edit. Never replace a whole existing document
  from an earlier read.
- If the target does not match the expected content, re-read it and
  reconcile the concurrent change before trying again.
- Never follow or write through symlinks inside an Area.
- Keep Area files in the Area directory and code in connected Repositories.
- Preserve unrelated user changes and restrict diffs to the intended files.
- Before the first Area write, record `git status --short` in the resolved
  Area root so pre-existing changes remain distinguishable.
- After successful validation, stage and commit only the exact Area paths
  changed for the request. Use a path-limited commit with a concise, plain
  human message, and do not create empty commits.
- If the Area is not its own Git worktree, a target was already dirty, or the
  intended paths cannot be isolated, leave the changes uncommitted and report
  why. Never include connected Repository changes.
- Do not initialize Git outside the new standalone Area workflow. Never push
  or create a remote unless the user explicitly requests that action.
- Treat validation errors introduced by the current change as incomplete work.
- Warnings can describe intentional free-form content; report unresolved ones
  when they matter to the requested result.

For requested Area writes, the completion sequence is:

```text
baseline Git status
→ baseline validation
→ current target and dependencies
→ targeted edit
→ validation
→ re-read
→ focused diff
→ exact-path Area commit
→ final Git status and commit inspection
```
