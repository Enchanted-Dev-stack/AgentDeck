# Architecture

## System Shape

AgentDeck is a local-first desktop app backed by a local shared-state core and a custom MCP server.

```text
CLI agents / MCP clients
        |
        | stdio MCP
        v
MCP server
        |
        v
Shared-state core
        |
        +-- SQLite
        +-- optional Qdrant
        +-- workspace files

Desktop UI
        |
        v
Terminal runtime + shared-state core
```

## Packages

- `apps/desktop`: Electron + React app shell.
- `packages/core`: workspace, todo, note, doc, memory domain logic.
- `packages/db`: SQLite schema and migrations.
- `packages/mcp-server`: MCP tools, resources, prompts, and stdio transport.
- `packages/terminal`: terminal pane runtime and PTY abstraction.
- `packages/ui`: reusable UI primitives and design tokens.

## Storage

SQLite is the source of truth for workspaces, panes, todos, notes, docs metadata, memory records, and MCP audit events.

Qdrant is optional and used only as a semantic index. It should never be the authoritative store for todos, notes, or memory records.

## MCP Strategy

Use stdio first for local CLI agents. Add Streamable HTTP later only when there is a concrete need for remote or multi-client access.

## Future-Proofing

The data model should leave room for later agent sessions, task ownership, soft locks, handoff records, and file-conflict warnings, but these are not part of V1 behavior.
