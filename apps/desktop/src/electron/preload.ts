import { contextBridge, ipcRenderer } from "electron";
import { terminalChannels, type AgentDeckBridge, type TerminalCreateRequest } from "../terminal/bridge.js";
import type { TerminalDataEvent, TerminalExitEvent } from "@agentdeck/terminal";

const bridge: AgentDeckBridge = {
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
};

contextBridge.exposeInMainWorld("agentDeck", bridge);
