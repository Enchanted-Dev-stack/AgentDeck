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

    await expect(secondStore.getWorkspace(workspace.id)).resolves.toMatchObject({
      id: workspace.id,
      name: "Persistent",
    });
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
});

async function createTestStore(): Promise<AgentDeckStore> {
  return new AgentDeckStore(await createStateFilePath());
}

async function createStateFilePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agentdeck-"));
  return join(directory, "state.json");
}
