# AgentDeck

AgentDeck is an open-source, local-first workspace for developers running CLI coding agents.

The goal is simple: open a saved multi-terminal workspace, run tools like OpenCode, Claude Code, Codex, Aider, or custom shell agents, and let every agent share the same todos, notes, docs, and project memory through MCP.

## Planned Capabilities

- Saved multi-terminal workspaces with reusable pane layouts.
- Shared todos, docs, notes, and memory scoped to a workspace.
- Local MCP server for agent access to shared context.
- Optional Qdrant-backed semantic memory.
- Agent launch templates and generated workspace instructions.
- Local-first storage with no cloud dependency required.

## Project Status

AgentDeck is in the planning and foundation stage. The initial implementation will focus on shared state, MCP, and workspace persistence before advanced coordination or cloud features.

## Architecture Direction

AgentDeck starts as a TypeScript-first monorepo:

- Electron + React desktop app.
- `xterm.js` and `node-pty` for terminal panes.
- SQLite and Drizzle for durable local state.
- TypeScript MCP server over stdio for local CLI agents.
- Optional Qdrant integration for semantic memory.

See `docs/ARCHITECTURE.md` for details.

## Roadmap

See `docs/ROADMAP.md`.

## Contributing

AgentDeck is intended to be built in public. See `docs/CONTRIBUTING.md` for contribution guidelines.

## License

MIT
