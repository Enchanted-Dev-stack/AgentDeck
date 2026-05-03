# MCP Contract

## Transport

V1 uses stdio for local CLI agents. HTTP transport is deferred until remote or multi-client use cases are required.

See `docs/MCP_INSTALL.md` for local `agentdeck-mcp` install commands and client config snippets.

## Tool Naming

Tools use dot-separated names grouped by domain.

## Initial Tools

- `workspace.list`
- `workspace.get`
- `workspace.find_by_root_path`
- `workspace.create`
- `pane.create`
- `todo.create`
- `todo.list`
- `todo.update`
- `todo.delete`
- `note.create`
- `note.list`
- `note.get`
- `note.update`
- `note.delete`
- `memory.store`
- `memory.search`
- `docs.list`
- `docs.read`
- `context.get_project_context`
- `instructions.get_workspace_instructions`

## Initial Resources

- `workspace://{workspaceId}`
- `todo://{todoId}`
- `note://{noteId}`
- `doc://{workspaceId}/{+path}`
- `memory://{memoryId}`

## Initial Prompts

- `shared_workspace_guide`
- `start_work_session`
- `summarize_workspace`
- `convert_notes_to_todos`
- `prepare_handoff`

## Safety Rules

- V1 MCP tools do not execute arbitrary shell commands.
- Docs reads stay inside `<workspace.rootPath>/docs`.
- Docs reads only return supported text documentation files: `.adoc`, `.md`, `.mdx`, `.rst`, and `.txt`.
- Secret-looking memory writes should be rejected or require explicit override.
- Tool outputs should include structured content and readable text summaries.
