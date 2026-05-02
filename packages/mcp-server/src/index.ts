import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AgentDeckStore, getWorkspaceInstructions } from "@agentdeck/core";
import { z } from "zod";

export interface AgentDeckMcpOptions {
  stateFilePath: string;
}

export function createAgentDeckMcpServer(options: AgentDeckMcpOptions): McpServer {
  const store = new AgentDeckStore(options.stateFilePath);
  const server = new McpServer({
    name: "agentdeck",
    version: "0.0.0",
  });

  server.registerTool(
    "workspace.list",
    {
      title: "List workspaces",
      description: "List AgentDeck workspaces available in the local shared-state store.",
      annotations: { readOnlyHint: true },
    },
    async () => toToolResult({ workspaces: await store.listWorkspaces() }),
  );

  server.registerTool(
    "workspace.get",
    {
      title: "Get workspace",
      description: "Get one AgentDeck workspace by ID.",
      inputSchema: { workspaceId: z.string().uuid() },
      annotations: { readOnlyHint: true },
    },
    async (input) => toToolResult({ workspace: await store.getWorkspace(input.workspaceId) }),
  );

  server.registerTool(
    "workspace.find_by_root_path",
    {
      title: "Find workspace by root path",
      description: "Find the workspace associated with a local project root path.",
      inputSchema: { rootPath: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    async (input) => toToolResult({ workspace: (await store.findWorkspaceByRootPath(input.rootPath)) ?? null }),
  );

  server.registerTool(
    "workspace.create",
    {
      title: "Create workspace",
      description: "Create a workspace scoped to a local project path.",
      inputSchema: {
        name: z.string().min(1),
        rootPath: z.string().min(1),
        description: z.string().optional(),
      },
    },
    async (input) => toToolResult({ workspace: await store.createWorkspace(input) }),
  );

  server.registerTool(
    "pane.create",
    {
      title: "Create pane",
      description: "Add a saved terminal pane definition to a workspace.",
      inputSchema: {
        workspaceId: z.string().uuid(),
        name: z.string().min(1),
        role: z.string().optional(),
        command: z.string().optional(),
        cwd: z.string().optional(),
        autoStart: z.boolean().optional(),
        position: z.number().int().nonnegative().optional(),
      },
    },
    async (input) => toToolResult({ pane: await store.createPane(input) }),
  );

  server.registerTool(
    "todo.list",
    {
      title: "List todos",
      description: "List shared todos for a workspace.",
      inputSchema: { workspaceId: z.string().uuid() },
      annotations: { readOnlyHint: true },
    },
    async (input) => toToolResult({ todos: await store.listTodos(input.workspaceId) }),
  );

  server.registerTool(
    "todo.create",
    {
      title: "Create todo",
      description: "Create a shared todo for a workspace.",
      inputSchema: {
        workspaceId: z.string().uuid(),
        title: z.string().min(1),
        description: z.string().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    async (input) => toToolResult({ todo: await store.createTodo(input) }),
  );

  server.registerTool(
    "todo.update",
    {
      title: "Update todo",
      description: "Update shared todo fields.",
      inputSchema: {
        todoId: z.string().uuid(),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        status: z.enum(["todo", "in_progress", "done", "cancelled"]).optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    async ({ todoId, ...input }) => toToolResult({ todo: await store.updateTodo(todoId, input) }),
  );

  server.registerTool(
    "note.create",
    {
      title: "Create note",
      description: "Create a shared markdown note. Secret-looking content is refused.",
      inputSchema: {
        workspaceId: z.string().uuid(),
        title: z.string().min(1),
        body: z.string().optional(),
        tags: z.array(z.string()).optional(),
        source: z.enum(["human", "agent", "imported"]).optional(),
      },
    },
    async (input) => toToolResult({ note: await store.createNote(input) }),
  );

  server.registerTool(
    "note.list",
    {
      title: "List notes",
      description: "List shared notes for a workspace.",
      inputSchema: { workspaceId: z.string().uuid() },
      annotations: { readOnlyHint: true },
    },
    async (input) => toToolResult({ notes: await store.listNotes(input.workspaceId) }),
  );

  server.registerTool(
    "memory.store",
    {
      title: "Store memory",
      description: "Store durable project memory. Secret-looking content is refused.",
      inputSchema: {
        workspaceId: z.string().uuid(),
        type: z.enum(["fact", "decision", "convention", "handoff", "setup", "risk"]).optional(),
        content: z.string().min(1),
        source: z.string().optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    async (input) => toToolResult({ memory: await store.storeMemory(input) }),
  );

  server.registerTool(
    "memory.search",
    {
      title: "Search memory",
      description: "Search durable project memory with keyword matching. Qdrant semantic search is planned later.",
      inputSchema: {
        workspaceId: z.string().uuid(),
        query: z.string().min(1),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => toToolResult({ memories: await store.searchMemory(input.workspaceId, input.query) }),
  );

  server.registerTool(
    "context.get_project_context",
    {
      title: "Get project context",
      description: "Return workspace summary, saved panes, open todos, recent notes, and recent memory.",
      inputSchema: { workspaceId: z.string().uuid() },
      annotations: { readOnlyHint: true },
    },
    async (input) => toToolResult({ context: await store.getProjectContext(input.workspaceId) }),
  );

  server.registerTool(
    "instructions.get_workspace_instructions",
    {
      title: "Get workspace instructions",
      description: "Return the standard AgentDeck instructions for CLI coding agents.",
      annotations: { readOnlyHint: true },
    },
    async () => toToolResult({ instructions: getWorkspaceInstructions() }),
  );

  server.registerPrompt(
    "shared_workspace_guide",
    {
      title: "Shared workspace guide",
      description: "Explain how an agent should use AgentDeck shared state.",
    },
    async () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: getWorkspaceInstructions(),
          },
        },
      ],
    }),
  );

  return server;
}

export async function runStdioServer(options: AgentDeckMcpOptions): Promise<void> {
  const server = createAgentDeckMcpServer(options);
  await server.connect(new StdioServerTransport());
}

function toToolResult(data: Record<string, unknown>) {
  return {
    structuredContent: data,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}
