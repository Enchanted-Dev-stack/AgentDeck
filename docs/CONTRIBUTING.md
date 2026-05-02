# Contributing

AgentDeck is intended to be built in public.

## Development Principles

- Keep local-first behavior working without cloud services.
- Prefer small, reviewable changes.
- Keep MCP tools narrow and well documented.
- Do not add agent coordination before shared state and terminals are stable.
- Avoid storing or indexing secrets.

## Project Layout

- `apps/desktop`: desktop app.
- `packages/core`: domain logic.
- `packages/db`: database schema and migrations.
- `packages/mcp-server`: MCP implementation.
- `packages/terminal`: terminal runtime.
- `packages/ui`: shared UI system.

## Expected Checks

Before opening a PR, run:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## Commit Style

Use concise, descriptive commit messages. Prefer conventional prefixes when useful, such as `docs:`, `feat:`, `fix:`, `refactor:`, and `test:`.
