export function getWorkspaceInstructions(): string {
  return [
    "# AgentDeck Shared Workspace Instructions",
    "",
    "You are working inside an AgentDeck workspace.",
    "",
    "Use the AgentDeck MCP tools as the shared source of truth for project context.",
    "",
    "Before starting substantial work:",
    "1. Call `context.get_project_context` for the active workspace.",
    "2. Review relevant todos with `todo.list`.",
    "3. Search notes or memory when you need project conventions or prior decisions.",
    "",
    "While working:",
    "- Create or update todos when shared task state changes.",
    "- Store durable findings in notes or memory.",
    "- Do not store secrets, API keys, private keys, tokens, or raw `.env` content.",
    "- Do not store noisy terminal logs as memory unless the user explicitly asks.",
    "",
    "AgentDeck V1 provides shared state only. It does not provide task claiming, locking, or autonomous coordination yet.",
  ].join("\n");
}
