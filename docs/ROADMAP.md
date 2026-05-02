# Roadmap

## Phase 0: Foundation Docs

- PRD, architecture, data model, MCP contract, security model, UI direction, and contribution guide.
- Initial monorepo skeleton.

## Phase 1: Shared State Core

- Workspace CRUD.
- Todo CRUD.
- Note CRUD.
- Memory records.
- SQLite schema and migrations.

## Phase 2: MCP Server

- Stdio transport.
- Shared context tools/resources/prompts.
- Workspace instructions and project context tools.

## Phase 3: Desktop App Shell

- Workspace list/detail.
- Todos, notes, docs, memory views.
- MCP status view.
- Command palette foundation.

## Phase 4: Multi-Terminal Workspaces

- `xterm.js` terminal panes.
- `node-pty` process management.
- Saved layouts and pane commands.
- Reopen workspace layouts.

## Phase 5: Agent Launch Templates

- OpenCode and other CLI agent profiles.
- Generated `AGENTS.md` and `.shared/*` instruction files.

## Phase 6: Optional Semantic Memory

- Qdrant adapter.
- Embedding provider interface.
- Hybrid keyword/semantic search.

## Later

- Agent registry.
- Task claiming and soft locks.
- Git/file conflict detection.
- Team sharing and cloud sync.
