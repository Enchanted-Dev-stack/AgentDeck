import type { TerminalDataEvent, TerminalExitEvent } from "@agentdeck/terminal";
import type { WorkspaceDocument } from "../workspace/schema.js";

export const terminalChannels = {
  close: "terminal:close",
  create: "terminal:create",
  data: "terminal:data",
  exit: "terminal:exit",
  resize: "terminal:resize",
  write: "terminal:write",
} as const;

export const workspaceChannels = {
  import: "workspace:import",
  save: "workspace:save",
} as const;

export const mcpChannels = {
  copyConfig: "mcp:copy-config",
  install: "mcp:install",
  uninstall: "mcp:uninstall",
} as const;

export type McpClient = "opencode" | "claude-code";

export interface McpActionResult {
  backupPath?: string | undefined;
  changed: boolean;
  configPath?: string | undefined;
  message: string;
  ok: boolean;
  status: "installed" | "manual" | "not_installed" | "cancelled" | "error";
}

export interface TerminalCreateRequest {
  cols: number;
  id: string;
  rows: number;
}

export interface TerminalBridge {
  closeSession: (id: string) => Promise<boolean>;
  createSession: (request: TerminalCreateRequest) => Promise<boolean>;
  onData: (listener: (event: TerminalDataEvent) => void) => () => void;
  onExit: (listener: (event: TerminalExitEvent) => void) => () => void;
  resize: (id: string, cols: number, rows: number) => Promise<boolean>;
  write: (id: string, data: string) => Promise<boolean>;
}

export interface WorkspaceBridge {
  importWorkspace: () => Promise<WorkspaceDocument | null>;
  saveWorkspace: (document: WorkspaceDocument) => Promise<boolean>;
}

export interface McpBridge {
  copyConfig: (client: McpClient) => Promise<McpActionResult>;
  install: (client: McpClient) => Promise<McpActionResult>;
  uninstall: (client: McpClient) => Promise<McpActionResult>;
}

export interface AgentDeckBridge {
  mcp: McpBridge;
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
