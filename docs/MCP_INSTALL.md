# MCP Install

AgentDeck uses a local stdio MCP server for V1. Agents do not discover it automatically; each MCP client needs an `agentdeck` server entry.

## Stable Command

Packaged installs should expose this command:

```bash
agentdeck-mcp --state-file /path/to/agentdeck-state.json
```

In development, build the package first and run the generated CLI directly:

```bash
corepack pnpm --filter @agentdeck/core --filter @agentdeck/mcp-server build
node packages/mcp-server/dist/cli.js --state-file /path/to/agentdeck-state.json
```

## Install Into Project Configs

OpenCode project config:

```bash
agentdeck-mcp install --client opencode --project-root /path/to/project --state-file /path/to/agentdeck-state.json
```

This creates or updates `/path/to/project/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "agentdeck": {
      "type": "local",
      "command": [
        "agentdeck-mcp",
        "--state-file",
        "/path/to/agentdeck-state.json"
      ],
      "enabled": true
    }
  }
}
```

Claude Code project config:

```bash
agentdeck-mcp install --client claude-code --project-root /path/to/project --state-file /path/to/agentdeck-state.json
```

This creates or updates `/path/to/project/.mcp.json`:

```json
{
  "mcpServers": {
    "agentdeck": {
      "type": "stdio",
      "command": "agentdeck-mcp",
      "args": ["--state-file", "/path/to/agentdeck-state.json"],
      "env": {}
    }
  }
}
```

## Safety Behavior

- Existing config files are backed up before modification.
- Only the `agentdeck` MCP entry is added, updated, or removed.
- Other MCP servers and unrelated settings are preserved.
- Config files must be valid JSON for automatic installation. If a client config uses JSONC comments, use `print-config` and merge manually.

## Manual Snippets

Print a client-specific snippet without writing files:

```bash
agentdeck-mcp print-config --client opencode --state-file /path/to/agentdeck-state.json
agentdeck-mcp print-config --client claude-code --state-file /path/to/agentdeck-state.json
```

## Uninstall

```bash
agentdeck-mcp uninstall --client opencode --project-root /path/to/project
agentdeck-mcp uninstall --client claude-code --project-root /path/to/project
```
