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

if (isTrustedRendererLocation(window.location)) {
  contextBridge.exposeInMainWorld("agentDeck", bridge);
}

function isTrustedRendererLocation(location: Location) {
  const isPackagedRenderer = location.protocol === "file:" && location.pathname.replaceAll("\\", "/").endsWith("/out/renderer/index.html");
  const isLocalDevRenderer = process.env.NODE_ENV === "development" && (location.origin === "http://127.0.0.1:5173" || location.origin === "http://localhost:5173");
  return isPackagedRenderer || isLocalDevRenderer;
}
