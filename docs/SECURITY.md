# Security

AgentDeck is local-first, but it manages terminals, MCP tools, docs, and memory. Treat these as sensitive surfaces.

## V1 Defaults

- MCP uses stdio by default.
- HTTP MCP is disabled by default.
- Secrets are not intentionally indexed or stored.
- Environment variables are referenced, not copied into workspace exports.
- Docs reads are restricted to configured workspace roots.
- Shared-state writes use a local lock file and atomic replace to reduce cross-process clobbering and partial-write corruption.
- Free-text workspace, pane, todo, note, and memory fields are scanned for common secret patterns before persistence.

## Secret Handling

AgentDeck should reject or warn on memory and note content that resembles:

- API keys.
- OAuth tokens.
- Private keys.
- Passwords.
- `.env` content.

## Qdrant

Qdrant is optional. If enabled locally, users are responsible for protecting its local network boundary. AgentDeck should store tenant/workspace IDs in payload filters and never rely on Qdrant as the source of truth.

## Future Work

- MCP audit log.
- Per-tool capability policies.
- Template import safety checks.
- Redaction pipeline before semantic indexing.
