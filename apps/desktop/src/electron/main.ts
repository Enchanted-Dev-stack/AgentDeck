import { app, BrowserWindow, clipboard, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions, type SaveDialogOptions } from "electron";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildAgentDeckServerSpec, createManualConfigSnippet, createMcpInstructions, getClientConfigPath, installMcpConfig, installMcpInstructions, removeMcpConfig, type McpClient, type McpInstructionScope } from "@agentdeck/mcp-server";
import * as pty from "node-pty";
import { resolveDefaultShell, TerminalSessionHost, type PtyAdapter, type ResolvedShell, type TerminalSpawnOptions } from "@agentdeck/terminal";
import { mcpChannels, terminalChannels, workspaceChannels, type McpActionResult, type TerminalCreateRequest } from "../terminal/bridge.js";
import { parseWorkspaceDocument } from "../workspace/schema.js";

const MAX_TERMINAL_ID_LENGTH = 80;
const MAX_TERMINAL_WRITE_LENGTH = 16_384;
const MAX_WORKSPACE_FILE_BYTES = 1_000_000;
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

function registerWorkspaceIpc() {
  ipcMain.handle(workspaceChannels.save, async (event, payload: unknown) => {
    if (!isTrustedIpcEvent(event)) {
      return false;
    }

    const document = parseWorkspaceDocument(payload);
    if (!document) {
      return false;
    }

    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    const saveDialogOptions: SaveDialogOptions = {
      defaultPath: `${document.name || "AgentDeck Workspace"}.agentdeck.json`,
      filters: [{ extensions: ["agentdeck.json", "json"], name: "AgentDeck workspace" }],
      title: "Save AgentDeck workspace",
    };
    const result = ownerWindow ? await dialog.showSaveDialog(ownerWindow, saveDialogOptions) : await dialog.showSaveDialog(saveDialogOptions);
    if (result.canceled || !result.filePath) {
      return false;
    }

    try {
      await writeFile(result.filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
      return true;
    } catch (error) {
      console.error("Failed to save workspace", error);
      return false;
    }
  });

  ipcMain.handle(workspaceChannels.import, async (event) => {
    if (!isTrustedIpcEvent(event)) {
      return null;
    }

    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    const openDialogOptions: OpenDialogOptions = {
      filters: [{ extensions: ["agentdeck.json", "json"], name: "AgentDeck workspace" }],
      properties: ["openFile"],
      title: "Import AgentDeck workspace",
    };
    const result = ownerWindow ? await dialog.showOpenDialog(ownerWindow, openDialogOptions) : await dialog.showOpenDialog(openDialogOptions);
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) {
      return null;
    }

    try {
      const fileStats = await stat(filePath);
      if (fileStats.size > MAX_WORKSPACE_FILE_BYTES) {
        return null;
      }

      const rawDocument = await readFile(filePath, "utf8");
      return parseWorkspaceDocument(JSON.parse(rawDocument));
    } catch (error) {
      console.error("Failed to import workspace", error);
      return null;
    }
  });
}

function registerMcpIpc() {
  ipcMain.handle(mcpChannels.copyConfig, (event, clientPayload: unknown): McpActionResult => {
    if (!isTrustedIpcEvent(event)) {
      return createMcpErrorResult("Unable to copy MCP config from an untrusted renderer.");
    }

    const client = parseMcpClient(clientPayload);
    if (!client) {
      return createMcpErrorResult("Unknown MCP client.");
    }

    try {
      const snippet = createManualConfigSnippet(client, createAgentDeckMcpServerSpec());
      clipboard.writeText(snippet);
      return {
        changed: false,
        message: `${getMcpClientLabel(client)} config copied to clipboard.`,
        ok: true,
        status: "manual",
      };
    } catch (error) {
      console.error("Failed to copy MCP config", error);
      return createMcpErrorResult(error instanceof Error ? error.message : "Failed to copy MCP config.");
    }
  });

  ipcMain.handle(mcpChannels.install, async (event, clientPayload: unknown): Promise<McpActionResult> => {
    if (!isTrustedIpcEvent(event)) {
      return createMcpErrorResult("Unable to install MCP config from an untrusted renderer.");
    }

    const client = parseMcpClient(clientPayload);
    if (!client) {
      return createMcpErrorResult("Unknown MCP client.");
    }

    const projectRoot = await selectMcpProjectRoot(event, `Install AgentDeck MCP for ${getMcpClientLabel(client)}`);
    if (!projectRoot) {
      return {
        changed: false,
        message: "MCP install cancelled.",
        ok: false,
        status: "cancelled",
      };
    }

    try {
      const result = await installMcpConfig({ client, configPath: getClientConfigPath(client, projectRoot), server: createAgentDeckMcpServerSpec() });
      return {
        backupPath: result.backupPath,
        changed: result.changed,
        configPath: result.configPath,
        message: result.changed ? `${getMcpClientLabel(client)} config updated.` : `${getMcpClientLabel(client)} already has AgentDeck MCP configured.`,
        ok: true,
        status: "installed",
      };
    } catch (error) {
      console.error("Failed to install MCP config", error);
      return createMcpErrorResult(error instanceof Error ? error.message : "Failed to install MCP config.");
    }
  });

  ipcMain.handle(mcpChannels.copyInstructions, (event, clientPayload: unknown, scopePayload: unknown): McpActionResult => {
    if (!isTrustedIpcEvent(event)) {
      return createMcpErrorResult("Unable to copy MCP instructions from an untrusted renderer.");
    }

    const client = parseMcpClient(clientPayload);
    const scope = parseMcpInstructionScope(scopePayload);
    if (!client || !scope) {
      return createMcpErrorResult("Unknown MCP instruction target.");
    }

    try {
      clipboard.writeText(createMcpInstructions(client, scope));
      return {
        changed: false,
        message: `${getMcpClientLabel(client)} ${scope} instructions copied to clipboard.`,
        ok: true,
        status: "manual",
      };
    } catch (error) {
      console.error("Failed to copy MCP instructions", error);
      return createMcpErrorResult(error instanceof Error ? error.message : "Failed to copy MCP instructions.");
    }
  });

  ipcMain.handle(mcpChannels.installInstructions, async (event, clientPayload: unknown, scopePayload: unknown): Promise<McpActionResult> => {
    if (!isTrustedIpcEvent(event)) {
      return createMcpErrorResult("Unable to install MCP instructions from an untrusted renderer.");
    }

    const client = parseMcpClient(clientPayload);
    const scope = parseMcpInstructionScope(scopePayload);
    if (!client || !scope) {
      return createMcpErrorResult("Unknown MCP instruction target.");
    }

    const projectRoot = scope === "repo" ? await selectMcpProjectRoot(event, `Install AgentDeck instructions for ${getMcpClientLabel(client)}`) : undefined;
    if (scope === "repo" && !projectRoot) {
      return {
        changed: false,
        message: "MCP instruction install cancelled.",
        ok: false,
        status: "cancelled",
      };
    }

    if (scope === "global" && !(await confirmGlobalInstructionInstall(event, client))) {
      return {
        changed: false,
        message: "MCP instruction install cancelled.",
        ok: false,
        status: "cancelled",
      };
    }

    try {
      const result = await installMcpInstructions({ client, homeDir: app.getPath("home"), projectRoot, scope });
      const target = scope === "global" ? "global" : "repository";
      return {
        backupPath: result.backupPaths[0],
        changed: result.changed,
        configPath: result.paths.join(", "),
        message: result.changed ? `${getMcpClientLabel(client)} ${target} instructions installed.` : `${getMcpClientLabel(client)} ${target} instructions are already installed.`,
        ok: true,
        status: "installed",
      };
    } catch (error) {
      console.error("Failed to install MCP instructions", error);
      return createMcpErrorResult(error instanceof Error ? error.message : "Failed to install MCP instructions.");
    }
  });

  ipcMain.handle(mcpChannels.uninstall, async (event, clientPayload: unknown): Promise<McpActionResult> => {
    if (!isTrustedIpcEvent(event)) {
      return createMcpErrorResult("Unable to uninstall MCP config from an untrusted renderer.");
    }

    const client = parseMcpClient(clientPayload);
    if (!client) {
      return createMcpErrorResult("Unknown MCP client.");
    }

    const projectRoot = await selectMcpProjectRoot(event, `Uninstall AgentDeck MCP for ${getMcpClientLabel(client)}`);
    if (!projectRoot) {
      return {
        changed: false,
        message: "MCP uninstall cancelled.",
        ok: false,
        status: "cancelled",
      };
    }

    try {
      const result = await removeMcpConfig({ client, configPath: getClientConfigPath(client, projectRoot) });
      return {
        backupPath: result.backupPath,
        changed: result.changed,
        configPath: result.configPath,
        message: result.changed ? `${getMcpClientLabel(client)} AgentDeck MCP entry removed.` : `${getMcpClientLabel(client)} did not have AgentDeck MCP configured.`,
        ok: true,
        status: "not_installed",
      };
    } catch (error) {
      console.error("Failed to uninstall MCP config", error);
      return createMcpErrorResult(error instanceof Error ? error.message : "Failed to uninstall MCP config.");
    }
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

function parseMcpClient(payload: unknown): McpClient | undefined {
  return payload === "opencode" || payload === "claude-code" ? payload : undefined;
}

function parseMcpInstructionScope(payload: unknown): McpInstructionScope | undefined {
  return payload === "global" || payload === "repo" ? payload : undefined;
}

function getMcpClientLabel(client: McpClient): string {
  return client === "opencode" ? "OpenCode" : "Claude Code";
}

function createAgentDeckMcpServerSpec() {
  return buildAgentDeckServerSpec({ command: resolveNodeCommand(), commandArgs: [resolveAgentDeckMcpCliPath()], stateFilePath: getAgentDeckStateFilePath() });
}

function resolveAgentDeckMcpCliPath() {
  const require = createRequire(import.meta.url);
  const cliPath = join(dirname(require.resolve("@agentdeck/mcp-server/package.json")), "dist", "cli.js");
  if (!existsSync(cliPath)) {
    throw new Error(`AgentDeck MCP CLI is not built: ${cliPath}`);
  }

  return cliPath;
}

function resolveNodeCommand() {
  if (process.platform === "win32") {
    if (!isWindowsCommandAvailable("node.exe")) {
      throw new Error("Unable to find node.exe on PATH for AgentDeck MCP config.");
    }

    return "node.exe";
  }

  return "node";
}

function getAgentDeckStateFilePath() {
  return join(app.getPath("userData"), "agentdeck-state.json");
}

function createMcpErrorResult(message: string): McpActionResult {
  return {
    changed: false,
    message,
    ok: false,
    status: "error",
  };
}

async function selectMcpProjectRoot(event: IpcMainInvokeEvent, title: string): Promise<string | undefined> {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  const openDialogOptions: OpenDialogOptions = {
    defaultPath: app.getPath("home"),
    properties: ["openDirectory"],
    title,
  };
  const result = ownerWindow ? await dialog.showOpenDialog(ownerWindow, openDialogOptions) : await dialog.showOpenDialog(openDialogOptions);
  return result.canceled ? undefined : result.filePaths[0];
}

async function confirmGlobalInstructionInstall(event: IpcMainInvokeEvent, client: McpClient): Promise<boolean> {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  const options = {
    buttons: ["Install Instructions", "Cancel"],
    cancelId: 1,
    defaultId: 0,
    detail: "This updates user-level agent instructions so the agent knows when to use AgentDeck MCP for shared docs, todos, notes, and memory.",
    message: `Install global AgentDeck instructions for ${getMcpClientLabel(client)}?`,
    noLink: true,
    title: "Install AgentDeck Instructions",
    type: "question" as const,
  };
  const result = ownerWindow ? await dialog.showMessageBox(ownerWindow, options) : await dialog.showMessageBox(options);
  return result.response === 0;
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
      sandbox: false,
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
  registerMcpIpc();
  registerTerminalIpc();
  registerWorkspaceIpc();
  const window = createWindow();

  if (process.env.AGENTDECK_SMOKE_TEST === "1") {
    const fallbackTimer = setTimeout(() => process.exit(1), 5_000);
    window.webContents.once("did-finish-load", async () => {
      const hasBridge = await window.webContents.executeJavaScript("Boolean(window.agentDeck?.mcp && window.agentDeck?.terminal && window.agentDeck?.workspace)");
      console.log(`AgentDeck preload bridge: ${hasBridge ? "available" : "missing"}`);
      setTimeout(() => {
        clearTimeout(fallbackTimer);
        process.exit(hasBridge ? 0 : 1);
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
