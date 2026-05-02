import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as pty from "node-pty";
import { resolveDefaultShell, TerminalSessionHost, type PtyAdapter, type ResolvedShell, type TerminalSpawnOptions } from "@agentdeck/terminal";
import { terminalChannels, type TerminalCreateRequest } from "../terminal/bridge.js";

const MAX_TERMINAL_ID_LENGTH = 80;
const MAX_TERMINAL_WRITE_LENGTH = 16_384;
const sessionOwners = new Map<string, number>();

class NodePtyAdapter implements PtyAdapter {
  spawn(options: TerminalSpawnOptions) {
    const ptyOptions: pty.IWindowsPtyForkOptions = {
      cols: options.cols,
      cwd: options.cwd,
      env: options.env,
      name: "xterm-256color",
      rows: options.rows,
      useConptyDll: process.platform === "win32",
    };
    const terminalProcess = pty.spawn(options.file, options.args, ptyOptions);

    return {
      kill: () => terminalProcess.kill(),
      onData: (handler: (data: string) => void) => terminalProcess.onData(handler),
      onExit: (handler: (event: { exitCode: number; signal?: number }) => void) => terminalProcess.onExit(handler),
      resize: (cols: number, rows: number) => terminalProcess.resize(cols, rows),
      write: (data: string) => terminalProcess.write(data),
    };
  }
}

const terminalHost = new TerminalSessionHost(new NodePtyAdapter(), {
  onData: (event) => sendToOwner(terminalChannels.data, event.id, event),
  onExit: (event) => {
    sendToOwner(terminalChannels.exit, event.id, event);
    sessionOwners.delete(event.id);
  },
});

function sendToOwner(channel: string, sessionId: string, payload: unknown) {
  const ownerId = sessionOwners.get(sessionId);
  const ownerWindow = BrowserWindow.getAllWindows().find((window) => window.webContents.id === ownerId);
  ownerWindow?.webContents.send(channel, payload);
}

function registerTerminalIpc() {
  ipcMain.handle(terminalChannels.create, (event, payload: unknown) => {
    if (!isTrustedIpcEvent(event)) {
      return false;
    }

    const request = parseCreateRequest(payload);
    if (!request) {
      return false;
    }

    const ownerId = event.sender.id;
    if (terminalHost.getSessionIds().includes(request.id)) {
      if (sessionOwners.get(request.id) !== ownerId) {
        return false;
      }

      terminalHost.resize(request.id, request.cols, request.rows);
      return true;
    }

    try {
      terminalHost.createSession({ cols: request.cols, cwd: app.getPath("home"), env: getSafeShellEnv(), id: request.id, rows: request.rows, shell: resolveAvailableShell() });
      sessionOwners.set(request.id, ownerId);
      return true;
    } catch (error) {
      console.error("Failed to create terminal session", error);
      return false;
    }
  });

  ipcMain.handle(terminalChannels.write, (event, idPayload: unknown, dataPayload: unknown) => {
    const id = parseTerminalId(idPayload);
    if (!id || !isTrustedSessionOwner(event, id) || typeof dataPayload !== "string" || dataPayload.length > MAX_TERMINAL_WRITE_LENGTH) {
      return false;
    }

    return terminalHost.write(id, dataPayload);
  });
  ipcMain.handle(terminalChannels.resize, (event, idPayload: unknown, colsPayload: unknown, rowsPayload: unknown) => {
    const id = parseTerminalId(idPayload);
    const cols = parseTerminalDimension(colsPayload, 500);
    const rows = parseTerminalDimension(rowsPayload, 300);
    if (!id || cols === undefined || rows === undefined || !isTrustedSessionOwner(event, id)) {
      return false;
    }

    return terminalHost.resize(id, cols, rows);
  });
  ipcMain.handle(terminalChannels.close, (event, idPayload: unknown) => {
    const id = parseTerminalId(idPayload);
    if (!id || !isTrustedSessionOwner(event, id)) {
      return false;
    }

    const closed = terminalHost.closeSession(id);
    if (closed) {
      sessionOwners.delete(id);
    }

    return closed;
  });
}

function parseCreateRequest(payload: unknown): TerminalCreateRequest | undefined {
  if (!isPlainObject(payload) || !hasOnlyKeys(payload, ["cols", "id", "rows"])) {
    return undefined;
  }

  const id = parseTerminalId(payload.id);
  const cols = parseTerminalDimension(payload.cols, 500);
  const rows = parseTerminalDimension(payload.rows, 300);
  if (!id || cols === undefined || rows === undefined) {
    return undefined;
  }

  return { cols, id, rows };
}

function parseTerminalId(payload: unknown) {
  if (typeof payload !== "string" || payload.length === 0 || payload.length > MAX_TERMINAL_ID_LENGTH || !/^[a-zA-Z0-9_-]+$/.test(payload)) {
    return undefined;
  }

  return payload;
}

function parseTerminalDimension(payload: unknown, maxValue: number): number | undefined {
  if (typeof payload !== "number" || !Number.isInteger(payload) || payload < 1 || payload > maxValue) {
    return undefined;
  }

  return payload;
}

function isPlainObject(payload: unknown): payload is Record<string, unknown> {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload);
}

function hasOnlyKeys(payload: Record<string, unknown>, allowedKeys: string[]) {
  return Object.keys(payload).every((key) => allowedKeys.includes(key));
}

function isTrustedSessionOwner(event: IpcMainInvokeEvent, sessionId: string) {
  return isTrustedIpcEvent(event) && sessionOwners.get(sessionId) === event.sender.id;
}

function isTrustedIpcEvent(event: IpcMainInvokeEvent) {
  return event.senderFrame ? isTrustedRendererUrl(event.senderFrame.url) : false;
}

function resolveAvailableShell(): ResolvedShell {
  if (process.env.AGENTDECK_SHELL) {
    return { args: [], file: process.env.AGENTDECK_SHELL };
  }

  if (process.platform !== "win32") {
    return resolveDefaultShell(process.platform, process.env);
  }

  const candidates = ["pwsh.exe", "powershell.exe", process.env.ComSpec || "cmd.exe"];
  for (const candidate of candidates) {
    if (isWindowsCommandAvailable(candidate)) {
      return { args: [], file: candidate };
    }
  }

  return { args: [], file: "cmd.exe" };
}

function isWindowsCommandAvailable(command: string) {
  return spawnSync("where.exe", [command], { stdio: "ignore" }).status === 0;
}

function getSafeShellEnv() {
  const allowedKeys = ["ComSpec", "HOME", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "PATH", "PATHEXT", "ProgramFiles", "ProgramFiles(x86)", "SystemDrive", "SystemRoot", "TEMP", "TMP", "USERDOMAIN", "USERNAME", "USERPROFILE", "windir"];
  return Object.fromEntries(allowedKeys.flatMap((key) => (process.env[key] ? [[key, process.env[key] as string]] : [])));
}

function closeSessionsForWebContents(webContentsId: number) {
  for (const [sessionId, ownerId] of sessionOwners) {
    if (ownerId === webContentsId) {
      terminalHost.closeSession(sessionId);
      sessionOwners.delete(sessionId);
    }
  }
}

function isTrustedRendererUrl(url: string) {
  try {
    const parsedUrl = new URL(url);
    const devRendererOrigin = getTrustedDevRendererOrigin();
    if (devRendererOrigin && parsedUrl.origin === devRendererOrigin) {
      return true;
    }

    return parsedUrl.href === pathToFileURL(join(__dirname, "../renderer/index.html")).href;
  } catch {
    return false;
  }
}

function getTrustedDevRendererOrigin() {
  if (!process.env.ELECTRON_RENDERER_URL) {
    return undefined;
  }

  try {
    const rendererUrl = new URL(process.env.ELECTRON_RENDERER_URL);
    return rendererUrl.origin === "http://127.0.0.1:5173" || rendererUrl.origin === "http://localhost:5173" ? rendererUrl.origin : undefined;
  } catch {
    return undefined;
  }
}

function createWindow() {
  const window = new BrowserWindow({
    height: 900,
    minHeight: 640,
    minWidth: 980,
    show: false,
    title: "AgentDeck",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "../preload/preload.mjs"),
      sandbox: true,
    },
    width: 1320,
  });

  const webContentsId = window.webContents.id;
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url)) {
      event.preventDefault();
    }
  });
  window.webContents.on("render-process-gone", () => closeSessionsForWebContents(webContentsId));
  window.on("closed", () => closeSessionsForWebContents(webContentsId));
  window.once("ready-to-show", () => window.show());

  if (process.env.ELECTRON_RENDERER_URL && isTrustedRendererUrl(process.env.ELECTRON_RENDERER_URL)) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
    return window;
  }

  void window.loadFile(join(__dirname, "../renderer/index.html"));
  return window;
}

app.whenReady().then(() => {
  registerTerminalIpc();
  const window = createWindow();

  if (process.env.AGENTDECK_SMOKE_TEST === "1") {
    const fallbackTimer = setTimeout(() => app.quit(), 5_000);
    window.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        clearTimeout(fallbackTimer);
        app.quit();
      }, 1_000);
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => terminalHost.closeAll());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
