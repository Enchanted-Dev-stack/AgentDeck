import { lstat, open, readdir, readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AgentDeckStore, getWorkspaceInstructions } from "@agentdeck/core";
import { z } from "zod";

export * from "./mcpInstall.js";

const supportedDocExtensions = new Set([
  ".adoc",
  ".md",
  ".mdx",
  ".rst",
  ".txt",
]);
const maxDocBytes = 1_000_000;

export interface AgentDeckMcpOptions {
  stateFilePath: string;
}

export function createAgentDeckMcpServer(
  options: AgentDeckMcpOptions,
): McpServer {
  const store = new AgentDeckStore(options.stateFilePath);
  const server = new McpServer({
    name: "agentdeck",
    version: "0.0.0",
  });

  server.registerTool(
    "workspace.list",
    {
      title: "List workspaces",
      description:
        "List AgentDeck workspaces available in the local shared-state store.",
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
    async (input) =>
      toToolResult({ workspace: await store.getWorkspace(input.workspaceId) }),
  );

  server.registerTool(
    "workspace.find_by_root_path",
    {
      title: "Find workspace by root path",
      description:
        "Find the workspace associated with a local project root path.",
      inputSchema: { rootPath: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      toToolResult({
        workspace:
          (await store.findWorkspaceByRootPath(input.rootPath)) ?? null,
      }),
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
    async (input) =>
      toToolResult({ workspace: await store.createWorkspace(input) }),
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
    async (input) =>
      toToolResult({ todos: await store.listTodos(input.workspaceId) }),
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
    async ({ todoId, ...input }) =>
      toToolResult({ todo: await store.updateTodo(todoId, input) }),
  );

  server.registerTool(
    "todo.delete",
    {
      title: "Delete todo",
      description: "Delete a shared todo by ID.",
      inputSchema: { todoId: z.string().uuid() },
    },
    async (input) =>
      toToolResult({ todo: await store.deleteTodo(input.todoId) }),
  );

  server.registerTool(
    "note.create",
    {
      title: "Create note",
      description:
        "Create a shared markdown note. Secret-looking content is refused.",
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
    async (input) =>
      toToolResult({ notes: await store.listNotes(input.workspaceId) }),
  );

  server.registerTool(
    "note.get",
    {
      title: "Get note",
      description: "Get one shared note by ID.",
      inputSchema: { noteId: z.string().uuid() },
      annotations: { readOnlyHint: true },
    },
    async (input) => toToolResult({ note: await store.getNote(input.noteId) }),
  );

  server.registerTool(
    "note.update",
    {
      title: "Update note",
      description:
        "Update shared note fields. Secret-looking content is refused.",
      inputSchema: {
        noteId: z.string().uuid(),
        title: z.string().min(1).optional(),
        body: z.string().optional(),
        tags: z.array(z.string()).optional(),
        source: z.enum(["human", "agent", "imported"]).optional(),
      },
    },
    async ({ noteId, ...input }) =>
      toToolResult({ note: await store.updateNote(noteId, input) }),
  );

  server.registerTool(
    "note.delete",
    {
      title: "Delete note",
      description: "Delete a shared note by ID.",
      inputSchema: { noteId: z.string().uuid() },
    },
    async (input) =>
      toToolResult({ note: await store.deleteNote(input.noteId) }),
  );

  server.registerTool(
    "memory.store",
    {
      title: "Store memory",
      description:
        "Store durable project memory. Secret-looking content is refused.",
      inputSchema: {
        workspaceId: z.string().uuid(),
        type: z
          .enum(["fact", "decision", "convention", "handoff", "setup", "risk"])
          .optional(),
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
      description:
        "Search durable project memory with keyword matching. Qdrant semantic search is planned later.",
      inputSchema: {
        workspaceId: z.string().uuid(),
        query: z.string().min(1),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      toToolResult({
        memories: await store.searchMemory(input.workspaceId, input.query),
      }),
  );

  server.registerTool(
    "docs.list",
    {
      title: "List docs",
      description:
        "List readable text documentation files under the workspace docs directory.",
      inputSchema: { workspaceId: z.string().uuid() },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      toToolResult({ docs: await listWorkspaceDocs(store, input.workspaceId) }),
  );

  server.registerTool(
    "docs.read",
    {
      title: "Read doc",
      description:
        "Read one text documentation file under the workspace docs directory.",
      inputSchema: {
        workspaceId: z.string().uuid(),
        path: z.string().min(1),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      toToolResult({
        doc: await readWorkspaceDoc(store, input.workspaceId, input.path),
      }),
  );

  server.registerTool(
    "context.get_project_context",
    {
      title: "Get project context",
      description:
        "Return workspace summary, saved panes, open todos, recent notes, and recent memory.",
      inputSchema: { workspaceId: z.string().uuid() },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      toToolResult({
        context: await store.getProjectContext(input.workspaceId),
      }),
  );

  server.registerTool(
    "instructions.get_workspace_instructions",
    {
      title: "Get workspace instructions",
      description:
        "Return the standard AgentDeck instructions for CLI coding agents.",
      annotations: { readOnlyHint: true },
    },
    async () => toToolResult({ instructions: getWorkspaceInstructions() }),
  );

  registerResources(server, store);

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

  server.registerPrompt(
    "start_work_session",
    {
      title: "Start work session",
      description:
        "Guide an agent through the standard AgentDeck startup checks.",
    },
    async () =>
      toPromptResult(
        "Start by calling `context.get_project_context`, then review `todo.list`, `memory.search`, and relevant docs before editing.",
      ),
  );

  server.registerPrompt(
    "summarize_workspace",
    {
      title: "Summarize workspace",
      description:
        "Summarize shared AgentDeck workspace state for a human handoff.",
    },
    async () =>
      toPromptResult(
        "Use AgentDeck MCP context, todos, notes, and memory to produce a concise workspace summary with open risks and next steps.",
      ),
  );

  server.registerPrompt(
    "convert_notes_to_todos",
    {
      title: "Convert notes to todos",
      description:
        "Turn durable notes into clear shared todos when action is needed.",
    },
    async () =>
      toPromptResult(
        "Review relevant notes, identify actionable work, create or update todos, and preserve non-actionable context as memory.",
      ),
  );

  server.registerPrompt(
    "prepare_handoff",
    {
      title: "Prepare handoff",
      description: "Prepare a durable handoff for the next agent or human.",
    },
    async () =>
      toPromptResult(
        "Summarize completed work, current state, blockers, verification, and next steps. Store durable decisions or risks with `memory.store`.",
      ),
  );

  return server;
}

export async function runStdioServer(
  options: AgentDeckMcpOptions,
): Promise<void> {
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

function toPromptResult(text: string) {
  return {
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text,
        },
      },
    ],
  };
}

function registerResources(server: McpServer, store: AgentDeckStore): void {
  server.registerResource(
    "workspace",
    new ResourceTemplate("workspace://{workspaceId}", { list: undefined }),
    {
      title: "Workspace",
      description: "Read one AgentDeck workspace as JSON.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      toTextResource(uri, {
        workspace: await store.getWorkspace(
          getTemplateValue(variables.workspaceId, "workspaceId"),
        ),
      }),
  );

  server.registerResource(
    "todo",
    new ResourceTemplate("todo://{todoId}", { list: undefined }),
    {
      title: "Todo",
      description: "Read one shared todo as JSON.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      toTextResource(uri, {
        todo: await store.getTodo(getTemplateValue(variables.todoId, "todoId")),
      }),
  );

  server.registerResource(
    "note",
    new ResourceTemplate("note://{noteId}", { list: undefined }),
    {
      title: "Note",
      description: "Read one shared note as JSON.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      toTextResource(uri, {
        note: await store.getNote(getTemplateValue(variables.noteId, "noteId")),
      }),
  );

  server.registerResource(
    "doc",
    new ResourceTemplate("doc://{workspaceId}/{+path}", { list: undefined }),
    {
      title: "Workspace doc",
      description:
        "Read one documentation file under the workspace docs directory.",
    },
    async (uri, variables) => {
      const workspaceId = getTemplateValue(
        variables.workspaceId,
        "workspaceId",
      );
      const path = decodeTemplatePath(getTemplateValue(variables.path, "path"));
      const doc = await readWorkspaceDoc(store, workspaceId, path);
      return toDocResource(uri, doc);
    },
  );

  server.registerResource(
    "memory",
    new ResourceTemplate("memory://{memoryId}", { list: undefined }),
    {
      title: "Memory",
      description: "Read one durable memory record as JSON.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      toTextResource(uri, {
        memory: await store.getMemory(
          getTemplateValue(variables.memoryId, "memoryId"),
        ),
      }),
  );
}

function toTextResource(
  uri: URL,
  data: unknown,
  mimeType = "application/json",
) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return {
    contents: [
      {
        uri: uri.toString(),
        mimeType,
        text,
      },
    ],
  };
}

function toDocResource(uri: URL, doc: ReadDoc) {
  return {
    contents: [
      {
        uri: uri.toString(),
        mimeType: getDocMimeType(doc.path),
        text: doc.text,
        _meta: {
          path: doc.path,
          size: doc.size,
          updatedAt: doc.updatedAt,
        },
      },
    ],
  };
}

function getTemplateValue(
  value: string | string[] | undefined,
  variableName: string,
): string {
  if (Array.isArray(value)) {
    return value.join("/");
  }

  if (!value) {
    throw new Error(`Missing resource variable: ${variableName}`);
  }

  return value;
}

function decodeTemplatePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    throw new Error("Invalid encoded doc path.");
  }
}

interface ListedDoc {
  path: string;
  uri: string;
  size: number;
  updatedAt: string;
}

interface ReadDoc extends ListedDoc {
  text: string;
}

async function listWorkspaceDocs(
  store: AgentDeckStore,
  workspaceId: string,
): Promise<ListedDoc[]> {
  const workspace = await store.getWorkspace(workspaceId);
  const docsRoot = resolve(workspace.rootPath, "docs");

  try {
    return (await walkDocs(docsRoot, docsRoot, workspaceId)).sort(
      (left, right) => left.path.localeCompare(right.path),
    );
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return [];
    }

    throw error;
  }
}

async function readWorkspaceDoc(
  store: AgentDeckStore,
  workspaceId: string,
  docPath: string,
): Promise<ReadDoc> {
  const workspace = await store.getWorkspace(workspaceId);
  const docsRoot = resolve(workspace.rootPath, "docs");
  const targetPath = resolveDocPath(docsRoot, docPath);
  const realDocsRoot = await realpath(docsRoot);
  const realTargetPath = await realpath(targetPath);

  if (!isInsidePath(realDocsRoot, realTargetPath)) {
    throw new Error("Doc path resolves outside the workspace docs directory.");
  }

  const linkStats = await lstat(targetPath);
  if (linkStats.isSymbolicLink()) {
    throw new Error(`Doc path is not a readable file: ${docPath}`);
  }

  const file = await open(realTargetPath, "r");

  try {
    const stats = await file.stat();

    if (!stats.isFile()) {
      throw new Error(`Doc path is not a readable file: ${docPath}`);
    }

    if (stats.size > maxDocBytes) {
      throw new Error(
        `Doc file exceeds maximum readable size of ${maxDocBytes} bytes: ${docPath}`,
      );
    }

    if (!isSupportedDocPath(targetPath)) {
      throw new Error(`Unsupported doc file extension: ${docPath}`);
    }

    const normalizedPath = toPortablePath(relative(docsRoot, targetPath));
    return {
      path: normalizedPath,
      uri: toDocUri(workspaceId, normalizedPath),
      size: stats.size,
      updatedAt: stats.mtime.toISOString(),
      text: await file.readFile("utf8"),
    };
  } finally {
    await file.close();
  }
}

async function walkDocs(
  docsRoot: string,
  directory: string,
  workspaceId: string,
): Promise<ListedDoc[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const docs: ListedDoc[] = [];

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }

    const entryPath = resolve(directory, entry.name);
    if (!isInsidePath(docsRoot, entryPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      docs.push(...(await walkDocs(docsRoot, entryPath, workspaceId)));
      continue;
    }

    if (!entry.isFile() || !isSupportedDocPath(entryPath)) {
      continue;
    }

    const stats = await lstat(entryPath);
    if (stats.size > maxDocBytes) {
      continue;
    }

    const docPath = toPortablePath(relative(docsRoot, entryPath));
    docs.push({
      path: docPath,
      uri: toDocUri(workspaceId, docPath),
      size: stats.size,
      updatedAt: stats.mtime.toISOString(),
    });
  }

  return docs;
}

function resolveDocPath(docsRoot: string, docPath: string): string {
  if (docPath.includes("\0")) {
    throw new Error("Doc path contains an invalid null byte.");
  }

  const normalizedInput = docPath.replace(/\\/g, "/");
  if (isAbsolute(normalizedInput)) {
    throw new Error(
      "Doc path must be relative to the workspace docs directory.",
    );
  }

  const targetPath = resolve(docsRoot, normalizedInput);
  if (!isInsidePath(docsRoot, targetPath)) {
    throw new Error("Doc path resolves outside the workspace docs directory.");
  }

  return targetPath;
}

function isInsidePath(parentPath: string, childPath: string): boolean {
  const relativePath = relative(parentPath, childPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function isSupportedDocPath(filePath: string): boolean {
  return supportedDocExtensions.has(extname(filePath).toLowerCase());
}

function getDocMimeType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".adoc":
      return "text/asciidoc";
    case ".md":
    case ".mdx":
      return "text/markdown";
    case ".rst":
      return "text/x-rst";
    default:
      return "text/plain";
  }
}

function toPortablePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function toDocUri(workspaceId: string, docPath: string): string {
  const encodedPath = docPath.split("/").map(encodeURIComponent).join("/");
  return `doc://${workspaceId}/${encodedPath}`;
}

function isFileNotFoundError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT",
  );
}
