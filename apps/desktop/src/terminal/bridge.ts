import type { TerminalDataEvent, TerminalExitEvent } from "@agentdeck/terminal";
import type { CreateMemoryInput, CreateNoteInput, CreateTodoInput, Memory, Note, Todo, UpdateNoteInput, UpdateTodoInput, Workspace } from "@agentdeck/core";
import type { WorkspaceDocument } from "../workspace/schema.js";

export const terminalChannels = {
  close: "terminal:close",
  create: "terminal:create",
  cwd: "terminal:cwd",
  data: "terminal:data",
  exit: "terminal:exit",
  resize: "terminal:resize",
  write: "terminal:write",
} as const;

export const workspaceChannels = {
  autoLoad: "workspace:auto-load",
  autoSave: "workspace:auto-save",
  import: "workspace:import",
  save: "workspace:save",
  selectFolder: "workspace:select-folder",
} as const;

export const mcpChannels = {
  copyConfig: "mcp:copy-config",
  copyInstructions: "mcp:copy-instructions",
  getStatus: "mcp:get-status",
  install: "mcp:install",
  installInstructions: "mcp:install-instructions",
  uninstall: "mcp:uninstall",
} as const;

export const sharedStateChannels = {
  bootstrapWorkspace: "shared:workspace:bootstrap",
  createNote: "shared:notes:create",
  createTodo: "shared:todos:create",
  deleteNote: "shared:notes:delete",
  deleteTodo: "shared:todos:delete",
  listDocs: "shared:docs:list",
  listMemories: "shared:memory:list",
  listNotes: "shared:notes:list",
  listTodos: "shared:todos:list",
  readDoc: "shared:docs:read",
  searchMemory: "shared:memory:search",
  selectWorkspaceRoot: "shared:workspace:select-root",
  storeMemory: "shared:memory:store",
  updateNote: "shared:notes:update",
  updateTodo: "shared:todos:update",
} as const;

export const settingsChannels = {
  get: "settings:get",
  update: "settings:update",
} as const;

export type McpClient = "opencode" | "claude-code";
export type McpInstructionScope = "global" | "repo";

export interface McpActionResult {
  backupPath?: string | undefined;
  changed: boolean;
  configPath?: string | undefined;
  message: string;
  ok: boolean;
  status: "installed" | "manual" | "not_installed" | "cancelled" | "error";
}

export interface McpClientSetupStatus {
  configPath?: string | undefined;
  instructionsInstalled: boolean;
  instructionsPath?: string | undefined;
  mcpInstalled: boolean;
  message?: string | undefined;
}

export type McpSetupStatus = Record<McpClient, McpClientSetupStatus>;

export interface TerminalCreateRequest {
  cols: number;
  cwd?: string | undefined;
  id: string;
  rows: number;
}

export interface TerminalCwdEvent {
  cwd: string;
  id: string;
}

export interface TerminalBridge {
  closeSession: (id: string) => Promise<boolean>;
  createSession: (request: TerminalCreateRequest) => Promise<boolean>;
  onCwd: (listener: (event: TerminalCwdEvent) => void) => () => void;
  onData: (listener: (event: TerminalDataEvent) => void) => () => void;
  onExit: (listener: (event: TerminalExitEvent) => void) => () => void;
  resize: (id: string, cols: number, rows: number) => Promise<boolean>;
  write: (id: string, data: string) => Promise<boolean>;
}

export interface WorkspaceBridge {
  autoLoadWorkspace: () => Promise<WorkspaceDocument | null>;
  autoSaveWorkspace: (document: WorkspaceDocument) => Promise<boolean>;
  importWorkspace: () => Promise<WorkspaceDocument | null>;
  saveWorkspace: (document: WorkspaceDocument) => Promise<boolean>;
  selectFolder: () => Promise<string | null>;
}

export interface McpBridge {
  copyConfig: (client: McpClient) => Promise<McpActionResult>;
  copyInstructions: (client: McpClient, scope: McpInstructionScope) => Promise<McpActionResult>;
  getStatus: () => Promise<McpSetupStatus>;
  install: (client: McpClient) => Promise<McpActionResult>;
  installInstructions: (client: McpClient, scope: McpInstructionScope) => Promise<McpActionResult>;
  uninstall: (client: McpClient) => Promise<McpActionResult>;
}

export interface WorkspaceDoc {
  path: string;
  size: number;
  updatedAt: string;
}

export interface WorkspaceDocContent extends WorkspaceDoc {
  text: string;
}

export interface AppSettings {
  sharedContextEnabled: boolean;
}

export interface SettingsBridge {
  get: () => Promise<AppSettings>;
  update: (settings: Partial<AppSettings>) => Promise<AppSettings>;
}

export interface SharedStateBridge {
  bootstrapWorkspace: () => Promise<Workspace | null>;
  createNote: (input: CreateNoteInput) => Promise<Note>;
  createTodo: (input: CreateTodoInput) => Promise<Todo>;
  deleteNote: (noteId: string) => Promise<Note>;
  deleteTodo: (todoId: string) => Promise<Todo>;
  listDocs: (workspaceId: string) => Promise<WorkspaceDoc[]>;
  listMemories: (workspaceId: string) => Promise<Memory[]>;
  listNotes: (workspaceId: string) => Promise<Note[]>;
  listTodos: (workspaceId: string) => Promise<Todo[]>;
  readDoc: (workspaceId: string, path: string) => Promise<WorkspaceDocContent>;
  searchMemory: (workspaceId: string, query: string) => Promise<Memory[]>;
  selectWorkspaceRoot: () => Promise<Workspace | null>;
  storeMemory: (input: CreateMemoryInput) => Promise<Memory>;
  updateNote: (noteId: string, input: UpdateNoteInput) => Promise<Note>;
  updateTodo: (todoId: string, input: UpdateTodoInput) => Promise<Todo>;
}

export interface AgentDeckBridge {
  mcp: McpBridge;
  settings: SettingsBridge;
  shared: SharedStateBridge;
  terminal: TerminalBridge;
  workspace: WorkspaceBridge;
}

declare global {
  interface Window {
    agentDeck?: AgentDeckBridge;
  }
}

export function getTerminalBridge() {
  return typeof window === "undefined" ? undefined : window.agentDeck?.terminal;
}

export function getWorkspaceBridge() {
  return typeof window === "undefined" ? undefined : window.agentDeck?.workspace;
}

export function getMcpBridge() {
  return typeof window === "undefined" ? undefined : window.agentDeck?.mcp;
}

export function getSettingsBridge() {
  return typeof window === "undefined" ? undefined : window.agentDeck?.settings;
}

export function getSharedStateBridge() {
  return typeof window === "undefined" ? undefined : window.agentDeck?.shared;
}
