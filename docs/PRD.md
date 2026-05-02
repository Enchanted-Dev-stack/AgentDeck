# AgentDeck PRD

## Summary

AgentDeck lets developers run CLI coding agents inside saved multi-terminal workspaces while sharing todos, docs, notes, and memory through MCP.

## Target Users

- Solo developers using OpenCode, Claude Code, Codex, Aider, Cursor-style agents, or custom CLI agents.
- Open-source maintainers who want contributors and agents to share project context.
- AI-heavy engineering teams that need reproducible local agent workflows.

## Jobs To Be Done

- When I start a project, I want to launch my preferred terminal layout and agent commands immediately.
- When I use multiple agents, I want each one to access shared todos, docs, notes, and memory.
- When I stop working, I want my workspace layout and shared context saved for later.
- When agents learn useful project facts, I want those facts stored durably and searchable.

## V1 Scope

- Workspace records and saved pane definitions.
- Shared todos, notes, docs index, and memory records.
- Local SQLite persistence.
- MCP server exposing shared context tools, resources, and prompts.
- Agent instruction generation through `AGENTS.md` and workspace prompt files.

## Non-Goals For V1

- Full autonomous agent orchestration.
- Cloud sync or hosted execution.
- Billing, teams, or account management.
- Direct code editing inside AgentDeck.
- Replacing GitHub Issues, Linear, Notion, or Jira.

## Acceptance Criteria

- A user can create and reopen a workspace.
- A workspace can contain named terminal pane definitions.
- Todos and notes persist locally.
- Agents can access shared context through MCP.
- The MCP server binds locally or uses stdio by default.
- Docs explain setup, architecture, MCP tools, and contribution flow.
