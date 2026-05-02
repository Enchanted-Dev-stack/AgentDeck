# ADR 0001: TypeScript-First Electron Stack

## Status

Accepted for initial implementation.

## Context

AgentDeck needs saved terminal panes, MCP support, local persistence, Qdrant integration, and a contributor-friendly open-source architecture.

## Decision

Start with a TypeScript-first monorepo using Electron, React, `xterm.js`, `node-pty`, SQLite, Drizzle, and the TypeScript MCP SDK.

## Consequences

- Faster implementation and easier contributor onboarding.
- Strong alignment with existing terminal and MCP libraries.
- Electron has a larger runtime footprint than Tauri.
- Module boundaries should stay clean enough to allow a future Tauri/Rust core if needed.
