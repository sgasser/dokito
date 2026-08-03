---
status: in_progress
assignee: "Launch Agent"
project: launch
priority: high
---

# Coordinate the product launch

Verify the release across the Web app, API, and website.

## Rollout checklist

- Confirm the [product context](product).
- Run the verification command on every surface.

## Decision

Use a staged launch once every surface reports ready.

| Surface | Check |
| --- | --- |
| Web | Smoke test |
| API | Health check |

```sh
bun run check
```
