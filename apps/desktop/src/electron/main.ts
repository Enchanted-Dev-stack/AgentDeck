import { app, BrowserWindow, clipboard, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions, type SaveDialogOptions } from "electron";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { lstat, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import { pathToFileURL } from "node:url";
import { buildAgentDeckServerSpec, createManualConfigSnippet, createMcpInstructions, getClientConfigPath, getMcpInstructionsPath, getOpenCodeGlobalConfigPath, installMcpConfig, installMcpInstructions, removeMcpConfig, type McpClient, type McpInstructionScope } from "@agentdeck/mcp-server";
import * as pty from "node-pty";
import { resolveDefaultShell, TerminalSessionHost, type PtyAdapter, type ResolvedShell, type TerminalSpawnOptions } from "@agentdeck/terminal";
import { mcpChannels, terminalChannels, workspaceChannels, type McpActionResult, type McpClientSetupStatus, type McpSetupStatus, type TerminalCreateRequest } from "../terminal/bridge.js";
import { parseWorkspaceDocument } from "../workspace/schema.js";

const MAX_TERMINAL_ID_LENGTH = 80;
const MAX_TERMINAL_WRITE_LENGTH = 16_384;
const MAX_WORKSPACE_FILE_BYTES = 1_000_000;
const CLAUDE_MCP_COMMAND_TIMEOUT_MS = 15_000;
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

  ipcMain.handle(mcpChannels.getStatus, async (event): Promise<McpSetupStatus> => {
    if (!isTrustedIpcEvent(event)) {
      return createEmptyMcpSetupStatus("Unable to inspect MCP status from an untrusted renderer.");
    }

    return getMcpSetupStatus();
  });

  ipcMain.handle(mcpChannels.install, async (event, clientPayload: unknown): Promise<McpActionResult> => {
    if (!isTrustedIpcEvent(event)) {
      return createMcpErrorResult("Unable to install MCP config from an untrusted renderer.");
    }

    const client = parseMcpClient(clientPayload);
    if (!client) {
      return createMcpErrorResult("Unknown MCP client.");
    }

    if (!(await confirmGlobalMcpChange(event, client, "install"))) {
      return {
        changed: false,
        message: "MCP install cancelled.",
        ok: false,
        status: "cancelled",
      };
    }

    try {
      const result = await installGlobalMcpConfig(client);
      return {
        backupPath: result.backupPath,
        changed: result.changed,
        configPath: result.configPath,
        message: result.changed ? `${getMcpClientLabel(client)} global MCP config updated.` : `${getMcpClientLabel(client)} already has AgentDeck MCP configured globally.`,
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

    if (!(await confirmGlobalMcpChange(event, client, "uninstall"))) {
      return {
        changed: false,
        message: "MCP uninstall cancelled.",
        ok: false,
        status: "cancelled",
      };
    }

    try {
      const result = await removeGlobalMcpConfig(client);
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

async function installGlobalMcpConfig(client: McpClient) {
  if (client === "opencode") {
    return installMcpConfig({ client, configPath: getOpenCodeGlobalConfigPath(app.getPath("home")), server: createAgentDeckMcpServerSpec() });
  }

  const server = createAgentDeckMcpServerSpec();
  const configPath = getClaudeUserConfigPath();
  const previousConfigText = await readTextIfExistsSafe(configPath);
  try {
    await runClaudeMcpCommand(["mcp", "remove", "agentdeck", "--scope", "user"], { allowFailure: true });
    await runClaudeMcpCommand(["mcp", "add", "--transport", "stdio", "--scope", "user", "agentdeck", "--", server.command, ...server.args]);
  } catch (error) {
    await assertSafeStatusFileTarget(configPath);
    if (previousConfigText !== undefined) {
      await writeFile(configPath, previousConfigText, "utf8");
    } else {
      await removeFileIfExists(configPath);
    }

    throw error;
  }

  return {
    changed: true,
    configPath,
  };
}

async function removeGlobalMcpConfig(client: McpClient) {
  if (client === "opencode") {
    return removeMcpConfig({ client, configPath: getOpenCodeGlobalConfigPath(app.getPath("home")) });
  }

  if (!(await isClaudeAgentDeckMcpInstalled())) {
    return {
      changed: false,
      configPath: getClaudeUserConfigPath(),
    };
  }

  await runClaudeMcpCommand(["mcp", "remove", "agentdeck", "--scope", "user"]);
  return {
    changed: true,
    configPath: getClaudeUserConfigPath(),
  };
}

async function getMcpSetupStatus(): Promise<McpSetupStatus> {
  const [opencode, claudeCode] = await Promise.all([
    resolveMcpClientSetupStatus(getOpenCodeSetupStatus(), "Unable to read OpenCode MCP status."),
    resolveMcpClientSetupStatus(getClaudeCodeSetupStatus(), "Unable to read Claude Code MCP status."),
  ]);
  return {
    "claude-code": claudeCode,
    opencode,
  };
}

async function resolveMcpClientSetupStatus(statusPromise: Promise<McpClientSetupStatus>, fallbackMessage: string): Promise<McpClientSetupStatus> {
  try {
    return await statusPromise;
  } catch (error) {
    return {
      instructionsInstalled: false,
      mcpInstalled: false,
      message: error instanceof Error ? error.message : fallbackMessage,
    };
  }
}

async function getOpenCodeSetupStatus(): Promise<McpClientSetupStatus> {
  const homeDir = app.getPath("home");
  const configPath = getOpenCodeGlobalConfigPath(homeDir);
  const instructionsPath = getMcpInstructionsPath({ client: "opencode", homeDir, scope: "global" });

  try {
    const config = asObject(await readJsonIfExistsSafe(configPath));
    const mcp = asObject(config.mcp);
    const instructions = Array.isArray(config.instructions) ? config.instructions : [];
    return {
      configPath,
      instructionsInstalled: instructions.includes(instructionsPath) && (await fileContains(instructionsPath, "<!-- agentdeck:start -->")),
      instructionsPath,
      mcpInstalled: "agentdeck" in mcp,
    };
  } catch (error) {
    return {
      configPath,
      instructionsInstalled: false,
      instructionsPath,
      mcpInstalled: false,
      message: error instanceof Error ? error.message : "Unable to read OpenCode MCP status.",
    };
  }
}

async function getClaudeCodeSetupStatus(): Promise<McpClientSetupStatus> {
  const homeDir = app.getPath("home");
  const instructionsPath = getMcpInstructionsPath({ client: "claude-code", homeDir, scope: "global" });
  return {
    configPath: getClaudeUserConfigPath(),
    instructionsInstalled: await fileContains(instructionsPath, "<!-- agentdeck:start -->"),
    instructionsPath,
    mcpInstalled: await isClaudeAgentDeckMcpInstalled(),
  };
}

function createEmptyMcpSetupStatus(message: string): McpSetupStatus {
  return {
    "claude-code": { instructionsInstalled: false, mcpInstalled: false, message },
    opencode: { instructionsInstalled: false, mcpInstalled: false, message },
  };
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
    if (!isCommandAvailable("node.exe")) {
      throw new Error("Unable to find node.exe on PATH for AgentDeck MCP config.");
    }

    return "node.exe";
  }

  return "node";
}

function getAgentDeckStateFilePath() {
  return join(app.getPath("userData"), "agentdeck-state.json");
}

function getClaudeUserConfigPath() {
  return join(app.getPath("home"), ".claude.json");
}

async function readTextIfExistsSafe(filePath: string): Promise<string | undefined> {
  await assertSafeStatusFileTarget(filePath);
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function removeFileIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }
  }
}

function runClaudeMcpCommand(args: string[], options: { allowFailure?: boolean } = {}): Promise<void> {
  if (!isCommandAvailable("claude")) {
    throw new Error("Unable to find Claude Code CLI on PATH for global MCP install.");
  }

  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { windowsHide: true });
    let output = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Claude Code MCP command timed out."));
    }, CLAUDE_MCP_COMMAND_TIMEOUT_MS);

    child.stdout?.on("data", (data: Buffer) => {
      output += data.toString("utf8");
    });
    child.stderr?.on("data", (data: Buffer) => {
      output += data.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (options.allowFailure || code === 0) {
        resolve();
        return;
      }

      reject(new Error((output || "Claude Code MCP command failed.").trim()));
    });
  });
}

async function isClaudeAgentDeckMcpInstalled() {
  const config = asObject(await readJsonIfExistsSafe(getClaudeUserConfigPath()));
  const mcpServers = asObject(config.mcpServers);
  return "agentdeck" in mcpServers;
}

async function readJsonIfExistsSafe(filePath: string): Promise<unknown> {
  await assertSafeStatusFileTarget(filePath);
  return readJsonIfExists(filePath);
}

async function assertSafeStatusFileTarget(filePath: string): Promise<void> {
  await assertNoSymlinkedPathParts(dirname(filePath));

  try {
    const stats = await lstat(filePath);
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing to inspect symlinked config file: ${filePath}`);
    }

    if (!stats.isFile()) {
      throw new Error(`Config path is not a file: ${filePath}`);
    }
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return;
    }

    throw error;
  }
}

async function assertNoSymlinkedPathParts(path: string): Promise<void> {
  const root = parse(path).root;
  const pathParts: string[] = [];
  let currentPath = path;

  while (currentPath && currentPath !== root && currentPath !== dirname(currentPath)) {
    pathParts.unshift(currentPath);
    currentPath = dirname(currentPath);
  }

  for (const pathPart of pathParts) {
    try {
      const stats = await lstat(pathPart);
      if (stats.isSymbolicLink()) {
        throw new Error(`Refusing to inspect config in symlinked path: ${pathPart}`);
      }

      if (!stats.isDirectory()) {
        throw new Error(`Config parent path is not a directory: ${pathPart}`);
      }
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        throw error;
      }
    }
  }
}

async function fileContains(filePath: string, text: string): Promise<boolean> {
  try {
    await assertSafeStatusFileTarget(filePath);
    return (await readFile(filePath, "utf8")).includes(text);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return false;
    }

    throw error;
  }
}

async function readJsonIfExists(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return undefined;
    }

    throw new Error(`Unable to read JSON file: ${filePath}`);
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

function isFileNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
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

async function confirmGlobalMcpChange(event: IpcMainInvokeEvent, client: McpClient, action: "install" | "uninstall"): Promise<boolean> {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  const target = client === "opencode" ? getOpenCodeGlobalConfigPath(app.getPath("home")) : getClaudeUserConfigPath();
  const verb = action === "install" ? "Install" : "Uninstall";
  const options = {
    buttons: [`${verb} Global MCP`, "Cancel"],
    cancelId: 1,
    defaultId: 0,
    detail: `${verb}s the AgentDeck MCP server in user-level ${getMcpClientLabel(client)} configuration. Target: ${target}`,
    message: `${verb} global AgentDeck MCP for ${getMcpClientLabel(client)}?`,
    noLink: true,
    title: `${verb} AgentDeck MCP`,
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
    if (isCommandAvailable(candidate)) {
      return { args: [], file: candidate };
    }
  }

  return { args: [], file: "cmd.exe" };
}

function isCommandAvailable(command: string) {
  if (process.platform === "win32") {
    return spawnSync("where.exe", [command], { stdio: "ignore" }).status === 0;
  }

  return spawnSync("command", ["-v", command], { shell: true, stdio: "ignore" }).status === 0;
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
