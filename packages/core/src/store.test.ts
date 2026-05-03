import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import { AgentDeckStore } from "./store.js";

describe("AgentDeckStore", () => {
  test("creates a workspace and shared todo", async () => {
    const store = await createTestStore();
    const workspace = await store.createWorkspace({
      name: "Demo",
      rootPath: ".",
    });
    const todo = await store.createTodo({
      workspaceId: workspace.id,
      title: "Build shared state",
      priority: "high",
    });

    await expect(store.listTodos(workspace.id)).resolves.toEqual([todo]);
  });

  test("persists state across store instances", async () => {
    const filePath = await createStateFilePath();
    const firstStore = new AgentDeckStore(filePath);
    const workspace = await firstStore.createWorkspace({
      name: "Persistent",
      rootPath: ".",
    });

    const secondStore = new AgentDeckStore(filePath);

    await expect(secondStore.getWorkspace(workspace.id)).resolves.toMatchObject(
      {
        id: workspace.id,
        name: "Persistent",
      },
    );
  });

  test("serializes concurrent writes from separate store instances", async () => {
    const filePath = await createStateFilePath();
    const setupStore = new AgentDeckStore(filePath);
    const workspace = await setupStore.createWorkspace({
      name: "Concurrent",
      rootPath: ".",
    });

    await Promise.all(
      Array.from({ length: 8 }, async (_, index) => {
        const store = new AgentDeckStore(filePath);
        await store.createTodo({
          workspaceId: workspace.id,
          title: `Todo ${index}`,
        });
      }),
    );

    const finalStore = new AgentDeckStore(filePath);
    const todos = await finalStore.listTodos(workspace.id);

    expect(todos).toHaveLength(8);
  });

  test("refuses secret-looking shared context", async () => {
    const store = await createTestStore();
    const workspace = await store.createWorkspace({
      name: "Secrets",
      rootPath: ".",
    });

    await expect(
      store.storeMemory({
        workspaceId: workspace.id,
        content: "api_key=sk-abcdefghijklmnopqrstuvwxyz123456",
      }),
    ).rejects.toThrow(/secret/i);
  });

  test("writes valid JSON state atomically", async () => {
    const filePath = await createStateFilePath();
    const store = new AgentDeckStore(filePath);
    await store.createWorkspace({
      name: "Atomic",
      rootPath: ".",
    });

    const state = JSON.parse(await readFile(filePath, "utf8"));

    expect(state.version).toBe(1);
    expect(state.workspaces).toHaveLength(1);
  });

  test("gets and deletes todos", async () => {
    const store = await createTestStore();
    const workspace = await store.createWorkspace({
      name: "Todos",
      rootPath: ".",
    });
    const todo = await store.createTodo({
      workspaceId: workspace.id,
      title: "Remove me",
    });

    await expect(store.getTodo(todo.id)).resolves.toEqual(todo);
    await expect(store.deleteTodo(todo.id)).resolves.toEqual(todo);
    await expect(store.listTodos(workspace.id)).resolves.toEqual([]);
  });

  test("gets updates and deletes notes", async () => {
    const store = await createTestStore();
    const workspace = await store.createWorkspace({
      name: "Notes",
      rootPath: ".",
    });
    const note = await store.createNote({
      workspaceId: workspace.id,
      title: "Draft",
      body: "Initial body",
    });

    await expect(store.getNote(note.id)).resolves.toEqual(note);
    const updatedNote = await store.updateNote(note.id, {
      title: "Updated",
      body: "Final body",
      tags: ["handoff"],
    });

    expect(updatedNote).toMatchObject({
      id: note.id,
      title: "Updated",
      body: "Final body",
      tags: ["handoff"],
    });
    await expect(store.deleteNote(note.id)).resolves.toEqual(updatedNote);
    await expect(store.listNotes(workspace.id)).resolves.toEqual([]);
  });

  test("gets stored memory", async () => {
    const store = await createTestStore();
    const workspace = await store.createWorkspace({
      name: "Memory",
      rootPath: ".",
    });
    const memory = await store.storeMemory({
      workspaceId: workspace.id,
      type: "decision",
      content: "Use local MCP by default.",
    });

    await expect(store.getMemory(memory.id)).resolves.toEqual(memory);
  });
});

async function createTestStore(): Promise<AgentDeckStore> {
  return new AgentDeckStore(await createStateFilePath());
}

async function createStateFilePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agentdeck-"));
  return join(directory, "state.json");
}
