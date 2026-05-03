import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  type AgentDeckState,
  type Memory,
  type MemoryType,
  type Note,
  type NoteSource,
  type Pane,
  type Priority,
  type Todo,
  type TodoStatus,
  type Workspace,
  agentDeckStateSchema,
  createEmptyState,
} from "./schemas.js";
import { mayContainSecret } from "./secretDetection.js";

export interface CreateWorkspaceInput {
  name: string;
  rootPath: string;
  description?: string | undefined;
}

export interface CreatePaneInput {
  workspaceId: string;
  name: string;
  role?: string | undefined;
  command?: string | undefined;
  cwd?: string | undefined;
  autoStart?: boolean | undefined;
  position?: number | undefined;
}

export interface CreateTodoInput {
  workspaceId: string;
  title: string;
  description?: string | undefined;
  priority?: Priority | undefined;
  tags?: string[] | undefined;
}

export interface UpdateTodoInput {
  title?: string | undefined;
  description?: string | undefined;
  status?: TodoStatus | undefined;
  priority?: Priority | undefined;
  tags?: string[] | undefined;
}

export interface CreateNoteInput {
  workspaceId: string;
  title: string;
  body?: string | undefined;
  tags?: string[] | undefined;
  source?: NoteSource | undefined;
}

export interface UpdateNoteInput {
  title?: string | undefined;
  body?: string | undefined;
  tags?: string[] | undefined;
  source?: NoteSource | undefined;
}

export interface CreateMemoryInput {
  workspaceId: string;
  type?: MemoryType | undefined;
  content: string;
  source?: string | undefined;
  tags?: string[] | undefined;
}

export interface ProjectContext {
  workspace: Workspace;
  panes: Pane[];
  openTodos: Todo[];
  recentNotes: Note[];
  recentMemories: Memory[];
}

export class AgentDeckStore {
  constructor(private readonly filePath: string) {}

  async listWorkspaces(): Promise<Workspace[]> {
    const state = await this.readState();
    return [...state.workspaces];
  }

  async getWorkspace(workspaceId: string): Promise<Workspace> {
    const state = await this.readState();
    return requireEntity(
      state.workspaces.find((workspace) => workspace.id === workspaceId),
      "workspace",
      workspaceId,
    );
  }

  async findWorkspaceByRootPath(
    rootPath: string,
  ): Promise<Workspace | undefined> {
    const state = await this.readState();
    const normalizedRootPath = normalizeRootPath(rootPath);
    return state.workspaces.find((workspace) =>
      areSamePath(workspace.rootPath, normalizedRootPath),
    );
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    assertNoSecrets("workspace", [
      input.name,
      input.rootPath,
      input.description ?? "",
    ]);
    const normalizedRootPath = normalizeRootPath(input.rootPath);

    return this.mutateState((state) => {
      const existingWorkspace = state.workspaces.find((workspace) =>
        areSamePath(workspace.rootPath, normalizedRootPath),
      );
      if (existingWorkspace) {
        throw new Error(
          `Workspace already exists for root path: ${normalizedRootPath}`,
        );
      }

      const now = new Date().toISOString();
      const workspace: Workspace = {
        id: randomUUID(),
        name: input.name,
        rootPath: normalizedRootPath,
        description: input.description ?? "",
        createdAt: now,
        updatedAt: now,
      };

      return {
        state: {
          ...state,
          workspaces: [...state.workspaces, workspace],
        },
        result: workspace,
      };
    });
  }

  async createPane(input: CreatePaneInput): Promise<Pane> {
    assertNoSecrets("pane", [
      input.name,
      input.role ?? "",
      input.command ?? "",
      input.cwd ?? "",
    ]);

    return this.mutateState((state) => {
      requireEntity(
        state.workspaces.find(
          (workspace) => workspace.id === input.workspaceId,
        ),
        "workspace",
        input.workspaceId,
      );
      const now = new Date().toISOString();
      const pane: Pane = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        name: input.name,
        role: input.role ?? "shell",
        command: input.command ?? "",
        cwd: input.cwd ?? ".",
        autoStart: input.autoStart ?? false,
        position:
          input.position ??
          state.panes.filter((item) => item.workspaceId === input.workspaceId)
            .length,
        createdAt: now,
        updatedAt: now,
      };

      return {
        state: {
          ...state,
          panes: [...state.panes, pane],
        },
        result: pane,
      };
    });
  }

  async listTodos(workspaceId: string): Promise<Todo[]> {
    const state = await this.readState();
    requireEntity(
      state.workspaces.find((workspace) => workspace.id === workspaceId),
      "workspace",
      workspaceId,
    );
    return state.todos.filter((todo) => todo.workspaceId === workspaceId);
  }

  async getTodo(todoId: string): Promise<Todo> {
    const state = await this.readState();
    return requireEntity(
      state.todos.find((todo) => todo.id === todoId),
      "todo",
      todoId,
    );
  }

  async createTodo(input: CreateTodoInput): Promise<Todo> {
    assertNoSecrets("todo", [
      input.title,
      input.description ?? "",
      ...(input.tags ?? []),
    ]);

    return this.mutateState((state) => {
      requireEntity(
        state.workspaces.find(
          (workspace) => workspace.id === input.workspaceId,
        ),
        "workspace",
        input.workspaceId,
      );
      const now = new Date().toISOString();
      const todo: Todo = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        title: input.title,
        description: input.description ?? "",
        status: "todo",
        priority: input.priority ?? "medium",
        tags: input.tags ?? [],
        createdAt: now,
        updatedAt: now,
      };

      return {
        state: {
          ...state,
          todos: [...state.todos, todo],
        },
        result: todo,
      };
    });
  }

  async updateTodo(todoId: string, input: UpdateTodoInput): Promise<Todo> {
    assertNoSecrets("todo", [
      input.title ?? "",
      input.description ?? "",
      ...(input.tags ?? []),
    ]);

    return this.mutateState((state) => {
      const current = requireEntity(
        state.todos.find((todo) => todo.id === todoId),
        "todo",
        todoId,
      );
      const updated: Todo = {
        ...current,
        title: input.title ?? current.title,
        description: input.description ?? current.description,
        status: input.status ?? current.status,
        priority: input.priority ?? current.priority,
        tags: input.tags ?? current.tags,
        updatedAt: new Date().toISOString(),
      };

      return {
        state: {
          ...state,
          todos: state.todos.map((todo) =>
            todo.id === todoId ? updated : todo,
          ),
        },
        result: updated,
      };
    });
  }

  async deleteTodo(todoId: string): Promise<Todo> {
    return this.mutateState((state) => {
      const current = requireEntity(
        state.todos.find((todo) => todo.id === todoId),
        "todo",
        todoId,
      );

      return {
        state: {
          ...state,
          todos: state.todos.filter((todo) => todo.id !== todoId),
        },
        result: current,
      };
    });
  }

  async createNote(input: CreateNoteInput): Promise<Note> {
    assertNoSecrets("note", [
      input.title,
      input.body ?? "",
      ...(input.tags ?? []),
    ]);

    return this.mutateState((state) => {
      requireEntity(
        state.workspaces.find(
          (workspace) => workspace.id === input.workspaceId,
        ),
        "workspace",
        input.workspaceId,
      );
      const now = new Date().toISOString();
      const note: Note = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        title: input.title,
        body: input.body ?? "",
        tags: input.tags ?? [],
        source: input.source ?? "human",
        createdAt: now,
        updatedAt: now,
      };

      return {
        state: {
          ...state,
          notes: [...state.notes, note],
        },
        result: note,
      };
    });
  }

  async listNotes(workspaceId: string): Promise<Note[]> {
    const state = await this.readState();
    requireEntity(
      state.workspaces.find((workspace) => workspace.id === workspaceId),
      "workspace",
      workspaceId,
    );
    return state.notes.filter((note) => note.workspaceId === workspaceId);
  }

  async getNote(noteId: string): Promise<Note> {
    const state = await this.readState();
    return requireEntity(
      state.notes.find((note) => note.id === noteId),
      "note",
      noteId,
    );
  }

  async updateNote(noteId: string, input: UpdateNoteInput): Promise<Note> {
    assertNoSecrets("note", [
      input.title ?? "",
      input.body ?? "",
      ...(input.tags ?? []),
    ]);

    return this.mutateState((state) => {
      const current = requireEntity(
        state.notes.find((note) => note.id === noteId),
        "note",
        noteId,
      );
      const updated: Note = {
        ...current,
        title: input.title ?? current.title,
        body: input.body ?? current.body,
        tags: input.tags ?? current.tags,
        source: input.source ?? current.source,
        updatedAt: new Date().toISOString(),
      };

      return {
        state: {
          ...state,
          notes: state.notes.map((note) =>
            note.id === noteId ? updated : note,
          ),
        },
        result: updated,
      };
    });
  }

  async deleteNote(noteId: string): Promise<Note> {
    return this.mutateState((state) => {
      const current = requireEntity(
        state.notes.find((note) => note.id === noteId),
        "note",
        noteId,
      );

      return {
        state: {
          ...state,
          notes: state.notes.filter((note) => note.id !== noteId),
        },
        result: current,
      };
    });
  }

  async storeMemory(input: CreateMemoryInput): Promise<Memory> {
    assertNoSecrets("memory", [
      input.content,
      input.source ?? "",
      ...(input.tags ?? []),
    ]);

    return this.mutateState((state) => {
      requireEntity(
        state.workspaces.find(
          (workspace) => workspace.id === input.workspaceId,
        ),
        "workspace",
        input.workspaceId,
      );
      const now = new Date().toISOString();
      const memory: Memory = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        type: input.type ?? "fact",
        content: input.content,
        source: input.source ?? "human",
        tags: input.tags ?? [],
        createdAt: now,
        updatedAt: now,
      };

      return {
        state: {
          ...state,
          memories: [...state.memories, memory],
        },
        result: memory,
      };
    });
  }

  async getMemory(memoryId: string): Promise<Memory> {
    const state = await this.readState();
    return requireEntity(
      state.memories.find((memory) => memory.id === memoryId),
      "memory",
      memoryId,
    );
  }

  async listMemories(workspaceId: string): Promise<Memory[]> {
    const state = await this.readState();
    requireEntity(
      state.workspaces.find((workspace) => workspace.id === workspaceId),
      "workspace",
      workspaceId,
    );
    return state.memories.filter((memory) => memory.workspaceId === workspaceId);
  }

  async searchMemory(workspaceId: string, query: string): Promise<Memory[]> {
    const state = await this.readState();
    requireEntity(
      state.workspaces.find((workspace) => workspace.id === workspaceId),
      "workspace",
      workspaceId,
    );
    const normalizedQuery = query.toLowerCase();
    return state.memories.filter((memory) => {
      return (
        memory.workspaceId === workspaceId &&
        memory.content.toLowerCase().includes(normalizedQuery)
      );
    });
  }

  async getProjectContext(workspaceId: string): Promise<ProjectContext> {
    const state = await this.readState();
    const workspace = requireEntity(
      state.workspaces.find((item) => item.id === workspaceId),
      "workspace",
      workspaceId,
    );
    const panes = state.panes.filter(
      (pane) => pane.workspaceId === workspaceId,
    );
    const openTodos = state.todos.filter(
      (todo) =>
        todo.workspaceId === workspaceId &&
        todo.status !== "done" &&
        todo.status !== "cancelled",
    );
    const recentNotes = [...state.notes]
      .filter((note) => note.workspaceId === workspaceId)
      .sort(sortByUpdatedAtDesc)
      .slice(0, 10);
    const recentMemories = [...state.memories]
      .filter((memory) => memory.workspaceId === workspaceId)
      .sort(sortByUpdatedAtDesc)
      .slice(0, 10);

    return {
      workspace,
      panes,
      openTodos,
      recentNotes,
      recentMemories,
    };
  }

  private async readState(): Promise<AgentDeckState> {
    try {
      const file = await readFile(this.filePath, "utf8");
      return agentDeckStateSchema.parse(JSON.parse(file));
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return createEmptyState();
      }

      throw error;
    }
  }

  private async writeState(state: AgentDeckState): Promise<void> {
    const parsedState = agentDeckStateSchema.parse(state);
    const tempFilePath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(dirname(this.filePath), { recursive: true });
    const file = await open(tempFilePath, "w");

    try {
      await file.writeFile(`${JSON.stringify(parsedState, null, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }

    await rename(tempFilePath, this.filePath);
  }

  private async mutateState<Result>(
    mutator: (state: AgentDeckState) => {
      state: AgentDeckState;
      result: Result;
    },
  ): Promise<Result> {
    return withFileLock(`${this.filePath}.lock`, async () => {
      const currentState = await this.readState();
      const mutation = mutator(currentState);
      await this.writeState(mutation.state);
      return mutation.result;
    });
  }
}

async function withFileLock<Result>(
  lockFilePath: string,
  callback: () => Promise<Result>,
): Promise<Result> {
  await mkdir(dirname(lockFilePath), { recursive: true });
  const lock = await acquireLock(lockFilePath);

  try {
    return await callback();
  } finally {
    await lock.close();
    await unlink(lockFilePath).catch(() => undefined);
  }
}

async function acquireLock(lockFilePath: string) {
  const startedAt = Date.now();
  const timeoutMs = 5_000;

  while (true) {
    try {
      return await open(lockFilePath, "wx");
    } catch (error) {
      if (!isAlreadyExistsError(error) || Date.now() - startedAt > timeoutMs) {
        throw error;
      }

      await delay(25);
    }
  }
}

function requireEntity<T>(
  entity: T | undefined,
  entityName: string,
  id: string,
): T {
  if (!entity) {
    throw new Error(`Unknown ${entityName}: ${id}`);
  }

  return entity;
}

function sortByUpdatedAtDesc(
  left: { updatedAt: string },
  right: { updatedAt: string },
): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function isFileNotFoundError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT",
  );
}

function isAlreadyExistsError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "EEXIST",
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

function assertNoSecrets(entityName: string, values: string[]): void {
  const combinedValue = values.join("\n");
  if (mayContainSecret(combinedValue)) {
    throw new Error(
      `${entityName} appears to contain a secret. Refusing to store it in shared context.`,
    );
  }
}

function normalizeRootPath(rootPath: string): string {
  return resolve(rootPath);
}

function areSamePath(left: string, right: string): boolean {
  const normalizedLeft = normalizeRootPath(left);
  const normalizedRight = normalizeRootPath(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}
