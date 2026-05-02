import type { TerminalDataEvent, TerminalExitEvent } from "@agentdeck/terminal";

export const terminalChannels = {
  close: "terminal:close",
  create: "terminal:create",
  data: "terminal:data",
  exit: "terminal:exit",
  resize: "terminal:resize",
  write: "terminal:write",
} as const;

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

export interface AgentDeckBridge {
  terminal: TerminalBridge;
}

declare global {
  interface Window {
    agentDeck?: AgentDeckBridge;
  }
}

export function getTerminalBridge() {
  return typeof window === "undefined" ? undefined : window.agentDeck?.terminal;
}
