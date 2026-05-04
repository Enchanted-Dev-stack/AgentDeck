import { contextBridge, ipcRenderer } from "electron";
import { mcpChannels, settingsChannels, sharedStateChannels, terminalChannels, workspaceChannels, type AgentDeckBridge, type AppSettings, type McpActionResult, type McpClient, type McpInstructionScope, type McpSetupStatus, type TerminalCreateRequest, type WorkspaceDoc, type WorkspaceDocContent } from "../terminal/bridge.js";
import type { CreateMemoryInput, CreateNoteInput, CreateTodoInput, Memory, Note, Todo, UpdateNoteInput, UpdateTodoInput, Workspace } from "@agentdeck/core";
import type { TerminalDataEvent, TerminalExitEvent } from "@agentdeck/terminal";
import type { TerminalCwdEvent } from "../terminal/bridge.js";
import type { WorkspaceDocument } from "../workspace/schema.js";

const bridge: AgentDeckBridge = {
  mcp: {
    copyConfig: (client: McpClient) => ipcRenderer.invoke(mcpChannels.copyConfig, client) as Promise<McpActionResult>,
    copyInstructions: (client: McpClient, scope: McpInstructionScope) => ipcRenderer.invoke(mcpChannels.copyInstructions, client, scope) as Promise<McpActionResult>,
    getStatus: () => ipcRenderer.invoke(mcpChannels.getStatus) as Promise<McpSetupStatus>,
    install: (client: McpClient) => ipcRenderer.invoke(mcpChannels.install, client) as Promise<McpActionResult>,
    installInstructions: (client: McpClient, scope: McpInstructionScope) => ipcRenderer.invoke(mcpChannels.installInstructions, client, scope) as Promise<McpActionResult>,
    uninstall: (client: McpClient) => ipcRenderer.invoke(mcpChannels.uninstall, client) as Promise<McpActionResult>,
  },
  settings: {
    get: () => ipcRenderer.invoke(settingsChannels.get) as Promise<AppSettings>,
    update: (settings: Partial<AppSettings>) => ipcRenderer.invoke(settingsChannels.update, settings) as Promise<AppSettings>,
  },
  shared: {
    bootstrapWorkspace: () => ipcRenderer.invoke(sharedStateChannels.bootstrapWorkspace) as Promise<Workspace | null>,
    createNote: (input: CreateNoteInput) => ipcRenderer.invoke(sharedStateChannels.createNote, input) as Promise<Note>,
    createTodo: (input: CreateTodoInput) => ipcRenderer.invoke(sharedStateChannels.createTodo, input) as Promise<Todo>,
    deleteNote: (noteId: string) => ipcRenderer.invoke(sharedStateChannels.deleteNote, noteId) as Promise<Note>,
    deleteTodo: (todoId: string) => ipcRenderer.invoke(sharedStateChannels.deleteTodo, todoId) as Promise<Todo>,
    listDocs: (workspaceId: string) => ipcRenderer.invoke(sharedStateChannels.listDocs, workspaceId) as Promise<WorkspaceDoc[]>,
    listMemories: (workspaceId: string) => ipcRenderer.invoke(sharedStateChannels.listMemories, workspaceId) as Promise<Memory[]>,
    listNotes: (workspaceId: string) => ipcRenderer.invoke(sharedStateChannels.listNotes, workspaceId) as Promise<Note[]>,
    listTodos: (workspaceId: string) => ipcRenderer.invoke(sharedStateChannels.listTodos, workspaceId) as Promise<Todo[]>,
    readDoc: (workspaceId: string, path: string) => ipcRenderer.invoke(sharedStateChannels.readDoc, workspaceId, path) as Promise<WorkspaceDocContent>,
    searchMemory: (workspaceId: string, query: string) => ipcRenderer.invoke(sharedStateChannels.searchMemory, workspaceId, query) as Promise<Memory[]>,
    selectWorkspaceRoot: () => ipcRenderer.invoke(sharedStateChannels.selectWorkspaceRoot) as Promise<Workspace | null>,
    storeMemory: (input: CreateMemoryInput) => ipcRenderer.invoke(sharedStateChannels.storeMemory, input) as Promise<Memory>,
    updateNote: (noteId: string, input: UpdateNoteInput) => ipcRenderer.invoke(sharedStateChannels.updateNote, noteId, input) as Promise<Note>,
    updateTodo: (todoId: string, input: UpdateTodoInput) => ipcRenderer.invoke(sharedStateChannels.updateTodo, todoId, input) as Promise<Todo>,
  },
  terminal: {
    closeSession: (id: string) => ipcRenderer.invoke(terminalChannels.close, id) as Promise<boolean>,
    copySelection: (id: string, text: string) => ipcRenderer.invoke(terminalChannels.copySelection, id, text) as Promise<boolean>,
    createSession: (request: TerminalCreateRequest) => ipcRenderer.invoke(terminalChannels.create, request) as Promise<boolean>,
    onCwd: (listener: (event: TerminalCwdEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: TerminalCwdEvent) => listener(payload);
      ipcRenderer.on(terminalChannels.cwd, handler);
      return () => ipcRenderer.off(terminalChannels.cwd, handler);
    },
    onData: (listener: (event: TerminalDataEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: TerminalDataEvent) => listener(payload);
      ipcRenderer.on(terminalChannels.data, handler);
      return () => ipcRenderer.off(terminalChannels.data, handler);
    },
    onExit: (listener: (event: TerminalExitEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: TerminalExitEvent) => listener(payload);
      ipcRenderer.on(terminalChannels.exit, handler);
      return () => ipcRenderer.off(terminalChannels.exit, handler);
    },
    paste: (id: string) => ipcRenderer.invoke(terminalChannels.paste, id) as Promise<boolean>,
    resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke(terminalChannels.resize, id, cols, rows) as Promise<boolean>,
    write: (id: string, data: string) => ipcRenderer.invoke(terminalChannels.write, id, data) as Promise<boolean>,
  },
  workspace: {
    autoLoadWorkspace: () => ipcRenderer.invoke(workspaceChannels.autoLoad) as Promise<WorkspaceDocument | null>,
    autoSaveWorkspace: (document: WorkspaceDocument) => ipcRenderer.invoke(workspaceChannels.autoSave, document) as Promise<boolean>,
    importWorkspace: () => ipcRenderer.invoke(workspaceChannels.import) as Promise<WorkspaceDocument | null>,
    saveWorkspace: (document: WorkspaceDocument) => ipcRenderer.invoke(workspaceChannels.save, document) as Promise<boolean>,
    selectFolder: () => ipcRenderer.invoke(workspaceChannels.selectFolder) as Promise<string | null>,
  },
};

contextBridge.exposeInMainWorld("agentDeck", bridge);
