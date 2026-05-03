import { contextBridge, ipcRenderer } from "electron";
import { mcpChannels, terminalChannels, workspaceChannels, type AgentDeckBridge, type McpActionResult, type McpClient, type McpInstructionScope, type TerminalCreateRequest } from "../terminal/bridge.js";
import type { TerminalDataEvent, TerminalExitEvent } from "@agentdeck/terminal";
import type { WorkspaceDocument } from "../workspace/schema.js";

const bridge: AgentDeckBridge = {
  mcp: {
    copyConfig: (client: McpClient) => ipcRenderer.invoke(mcpChannels.copyConfig, client) as Promise<McpActionResult>,
    copyInstructions: (client: McpClient, scope: McpInstructionScope) => ipcRenderer.invoke(mcpChannels.copyInstructions, client, scope) as Promise<McpActionResult>,
    install: (client: McpClient) => ipcRenderer.invoke(mcpChannels.install, client) as Promise<McpActionResult>,
    installInstructions: (client: McpClient, scope: McpInstructionScope) => ipcRenderer.invoke(mcpChannels.installInstructions, client, scope) as Promise<McpActionResult>,
    uninstall: (client: McpClient) => ipcRenderer.invoke(mcpChannels.uninstall, client) as Promise<McpActionResult>,
  },
  terminal: {
    closeSession: (id: string) => ipcRenderer.invoke(terminalChannels.close, id) as Promise<boolean>,
    createSession: (request: TerminalCreateRequest) => ipcRenderer.invoke(terminalChannels.create, request) as Promise<boolean>,
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
    resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke(terminalChannels.resize, id, cols, rows) as Promise<boolean>,
    write: (id: string, data: string) => ipcRenderer.invoke(terminalChannels.write, id, data) as Promise<boolean>,
  },
  workspace: {
    importWorkspace: () => ipcRenderer.invoke(workspaceChannels.import) as Promise<WorkspaceDocument | null>,
    saveWorkspace: (document: WorkspaceDocument) => ipcRenderer.invoke(workspaceChannels.save, document) as Promise<boolean>,
  },
};

contextBridge.exposeInMainWorld("agentDeck", bridge);
