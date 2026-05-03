import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, test } from "vitest";
import { createAgentDeckMcpServer } from "./index.js";

describe("AgentDeck MCP server", () => {
  const clients: Client[] = [];

  afterEach(async () => {
    await Promise.all(
      clients.map((client) => client.close().catch(() => undefined)),
    );
    clients.length = 0;
  });

  test("exposes the V1 tool, resource, and prompt contract", async () => {
    const { client } = await createTestClient();

    await expect(client.listTools()).resolves.toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "workspace.list" }),
        expect.objectContaining({ name: "workspace.get" }),
        expect.objectContaining({ name: "workspace.find_by_root_path" }),
        expect.objectContaining({ name: "workspace.create" }),
        expect.objectContaining({ name: "pane.create" }),
        expect.objectContaining({ name: "todo.create" }),
        expect.objectContaining({ name: "todo.list" }),
        expect.objectContaining({ name: "todo.update" }),
        expect.objectContaining({ name: "todo.delete" }),
        expect.objectContaining({ name: "note.create" }),
        expect.objectContaining({ name: "note.list" }),
        expect.objectContaining({ name: "note.get" }),
        expect.objectContaining({ name: "note.update" }),
        expect.objectContaining({ name: "note.delete" }),
        expect.objectContaining({ name: "memory.store" }),
        expect.objectContaining({ name: "memory.search" }),
        expect.objectContaining({ name: "docs.list" }),
        expect.objectContaining({ name: "docs.read" }),
        expect.objectContaining({ name: "context.get_project_context" }),
        expect.objectContaining({
          name: "instructions.get_workspace_instructions",
        }),
      ]),
    });
    await expect(client.listResourceTemplates()).resolves.toMatchObject({
      resourceTemplates: expect.arrayContaining([
        expect.objectContaining({ uriTemplate: "workspace://{workspaceId}" }),
        expect.objectContaining({ uriTemplate: "todo://{todoId}" }),
        expect.objectContaining({ uriTemplate: "note://{noteId}" }),
        expect.objectContaining({ uriTemplate: "doc://{workspaceId}/{+path}" }),
        expect.objectContaining({ uriTemplate: "memory://{memoryId}" }),
      ]),
    });
    await expect(client.listPrompts()).resolves.toMatchObject({
      prompts: expect.arrayContaining([
        expect.objectContaining({ name: "shared_workspace_guide" }),
        expect.objectContaining({ name: "start_work_session" }),
        expect.objectContaining({ name: "summarize_workspace" }),
        expect.objectContaining({ name: "convert_notes_to_todos" }),
        expect.objectContaining({ name: "prepare_handoff" }),
      ]),
    });
  });

  test("reads shared entities and docs through tools and resources", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "agentdeck-project-"));
    await mkdir(join(projectRoot, "docs", "nested"), { recursive: true });
    await writeFile(
      join(projectRoot, "docs", "guide.md"),
      "# Guide\n\nUse local MCP.\n",
      "utf8",
    );
    await writeFile(
      join(projectRoot, "docs", "nested", "setup.md"),
      "# Setup\n\nRun tests.\n",
      "utf8",
    );
    await writeFile(
      join(projectRoot, "docs", "ignored.bin"),
      "binary-ish",
      "utf8",
    );
    const { client } = await createTestClient();

    const workspace = getStructured<{
      workspace: { id: string; name: string };
    }>(
      await callTool(client, "workspace.create", {
        name: "Docs",
        rootPath: projectRoot,
      }),
    ).workspace;
    const todo = getStructured<{ todo: { id: string; status: string } }>(
      await callTool(client, "todo.create", {
        workspaceId: workspace.id,
        title: "Read docs",
      }),
    ).todo;
    const note = getStructured<{ note: { id: string; title: string } }>(
      await callTool(client, "note.create", {
        workspaceId: workspace.id,
        title: "Decision",
        body: "Local-first MCP.",
      }),
    ).note;
    const memory = getStructured<{ memory: { id: string; content: string } }>(
      await callTool(client, "memory.store", {
        workspaceId: workspace.id,
        type: "decision",
        content: "Use local MCP by default.",
      }),
    ).memory;

    const docs = getStructured<{ docs: { path: string; uri: string }[] }>(
      await callTool(client, "docs.list", { workspaceId: workspace.id }),
    ).docs;
    expect(docs.map((doc) => doc.path).sort()).toEqual([
      "guide.md",
      "nested/setup.md",
    ]);
    await expect(
      callTool(client, "docs.read", {
        workspaceId: workspace.id,
        path: "nested/setup.md",
      }),
    ).resolves.toMatchObject({
      structuredContent: {
        doc: expect.objectContaining({
          path: "nested/setup.md",
          text: expect.stringContaining("Run tests"),
        }),
      },
    });

    await expect(
      client.readResource({ uri: `workspace://${workspace.id}` }),
    ).resolves.toMatchObject({
      contents: [
        expect.objectContaining({ text: expect.stringContaining("Docs") }),
      ],
    });
    await expect(
      client.readResource({ uri: `todo://${todo.id}` }),
    ).resolves.toMatchObject({
      contents: [
        expect.objectContaining({ text: expect.stringContaining("Read docs") }),
      ],
    });
    await expect(
      client.readResource({ uri: `note://${note.id}` }),
    ).resolves.toMatchObject({
      contents: [
        expect.objectContaining({
          text: expect.stringContaining("Local-first MCP"),
        }),
      ],
    });
    await expect(
      client.readResource({ uri: `memory://${memory.id}` }),
    ).resolves.toMatchObject({
      contents: [
        expect.objectContaining({
          text: expect.stringContaining("Use local MCP"),
        }),
      ],
    });
    await expect(
      client.readResource({ uri: `doc://${workspace.id}/nested/setup.md` }),
    ).resolves.toMatchObject({
      contents: [
        expect.objectContaining({
          mimeType: "text/markdown",
          text: "# Setup\n\nRun tests.\n",
        }),
      ],
    });
  });

  test("updates and deletes shared todo and note tools", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "agentdeck-project-"));
    const { client } = await createTestClient();
    const workspace = getStructured<{ workspace: { id: string } }>(
      await callTool(client, "workspace.create", {
        name: "Mutations",
        rootPath: projectRoot,
      }),
    ).workspace;
    const todo = getStructured<{ todo: { id: string } }>(
      await callTool(client, "todo.create", {
        workspaceId: workspace.id,
        title: "Delete me",
      }),
    ).todo;
    const note = getStructured<{ note: { id: string } }>(
      await callTool(client, "note.create", {
        workspaceId: workspace.id,
        title: "Draft",
        body: "Before",
      }),
    ).note;

    await expect(
      callTool(client, "note.update", {
        noteId: note.id,
        title: "Final",
        body: "After",
        tags: ["handoff"],
      }),
    ).resolves.toMatchObject({
      structuredContent: {
        note: expect.objectContaining({
          id: note.id,
          title: "Final",
          body: "After",
          tags: ["handoff"],
        }),
      },
    });
    await expect(
      callTool(client, "note.get", { noteId: note.id }),
    ).resolves.toMatchObject({
      structuredContent: {
        note: expect.objectContaining({ id: note.id, title: "Final" }),
      },
    });
    await expect(
      callTool(client, "note.delete", { noteId: note.id }),
    ).resolves.toMatchObject({
      structuredContent: { note: expect.objectContaining({ id: note.id }) },
    });
    await expect(
      callTool(client, "todo.delete", { todoId: todo.id }),
    ).resolves.toMatchObject({
      structuredContent: { todo: expect.objectContaining({ id: todo.id }) },
    });
    await expect(
      callTool(client, "note.list", { workspaceId: workspace.id }),
    ).resolves.toMatchObject({
      structuredContent: { notes: [] },
    });
    await expect(
      callTool(client, "todo.list", { workspaceId: workspace.id }),
    ).resolves.toMatchObject({
      structuredContent: { todos: [] },
    });
  });

  test("rejects docs path traversal", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "agentdeck-project-"));
    const { client } = await createTestClient();
    const workspace = getStructured<{ workspace: { id: string } }>(
      await callTool(client, "workspace.create", {
        name: "Traversal",
        rootPath: projectRoot,
      }),
    ).workspace;

    await expect(
      callTool(client, "docs.read", {
        workspaceId: workspace.id,
        path: "../secret.md",
      }),
    ).resolves.toMatchObject({
      isError: true,
    });
    await expect(
      client.readResource({ uri: `doc://${workspace.id}/%2E%2E%2Fsecret.md` }),
    ).rejects.toThrow(/outside/i);
  });

  async function createTestClient(): Promise<{ client: Client }> {
    const stateDirectory = await mkdtemp(join(tmpdir(), "agentdeck-mcp-"));
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createAgentDeckMcpServer({
      stateFilePath: join(stateDirectory, "state.json"),
    });
    const client = new Client({ name: "agentdeck-test", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    clients.push(client);
    return { client };
  }
});

interface TestToolResult {
  structuredContent?: unknown;
  isError?: boolean;
  [key: string]: unknown;
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<TestToolResult> {
  return (await client.callTool(
    { name, arguments: args },
    CallToolResultSchema,
  )) as TestToolResult;
}

function getStructured<T>(result: { structuredContent?: unknown }): T {
  expect(result.structuredContent).toBeTruthy();
  return result.structuredContent as T;
}
