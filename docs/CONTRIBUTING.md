# Contributing

AgentDeck is intended to be built in public.

## Development Principles

- Keep local-first behavior working without cloud services.
- Prefer small, reviewable changes.
- Keep MCP tools narrow and well documented.
- Do not add agent coordination before shared state and terminals are stable.
- Avoid storing or indexing secrets.
- Use Hugeicons Rounded for product icons.
- Use Cabinet Grotesk for headings/titles and Outfit for body/UI text.

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

Each feature should also include the most relevant smoke test available. If an automated smoke test cannot be run locally, note the manual verification steps in the PR or handoff.

## UI Standards

- Product icons must use Hugeicons Rounded through the shared AgentDeck icon wrapper.
- Do not introduce additional icon libraries without an ADR.
- Headings and major labels use Cabinet Grotesk.
- Normal UI text uses Outfit.
- Terminal/data labels may use the approved monospace token.
- Keep motion purposeful, short, and compatible with `prefers-reduced-motion`.

## Commit Style

Use concise, descriptive commit messages. Prefer conventional prefixes when useful, such as `docs:`, `feat:`, `fix:`, `refactor:`, and `test:`.
