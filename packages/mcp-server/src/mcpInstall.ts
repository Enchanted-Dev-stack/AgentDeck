import { copyFile, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, parse } from "node:path";

export type McpClient = "opencode" | "claude-code";
export type McpInstructionScope = "global" | "repo";

export interface AgentDeckServerSpec {
  name: "agentdeck";
  command: string;
  args: string[];
}

export interface BuildServerSpecInput {
  command: string;
  commandArgs?: string[] | undefined;
  stateFilePath: string;
}

export interface InstallMcpConfigInput {
  client: McpClient;
  configPath: string;
  server: AgentDeckServerSpec;
  backup?: boolean | undefined;
  backupSuffix?: string | undefined;
}

export interface InstallMcpConfigResult {
  configPath: string;
  changed: boolean;
  backupPath?: string | undefined;
}

export interface InstallMcpInstructionsInput {
  agentDeckConfigDir?: string | undefined;
  backup?: boolean | undefined;
  backupSuffix?: string | undefined;
  client: McpClient;
  homeDir: string;
  projectRoot?: string | undefined;
  scope: McpInstructionScope;
}

export interface InstallMcpInstructionsResult {
  backupPaths: string[];
  changed: boolean;
  paths: string[];
}

const agentDeckInstructionStart = "<!-- agentdeck:start -->";
const agentDeckInstructionEnd = "<!-- agentdeck:end -->";

export function buildAgentDeckServerSpec(
  input: BuildServerSpecInput,
): AgentDeckServerSpec {
  return {
    name: "agentdeck",
    command: input.command,
    args: [...(input.commandArgs ?? []), "--state-file", input.stateFilePath],
  };
}

export function getClientConfigPath(
  client: McpClient,
  projectRoot: string,
): string {
  switch (client) {
    case "opencode":
      return join(projectRoot, "opencode.json");
    case "claude-code":
      return join(projectRoot, ".mcp.json");
  }
}

export function patchMcpConfig(
  client: McpClient,
  currentConfig: unknown,
  server: AgentDeckServerSpec,
): Record<string, unknown> {
  const config = asObject(currentConfig);

  switch (client) {
    case "opencode": {
      const mcp = asObject(config.mcp);
      return {
        ...config,
        $schema:
          typeof config.$schema === "string"
            ? config.$schema
            : "https://opencode.ai/config.json",
        mcp: {
          ...mcp,
          [server.name]: {
            type: "local",
            command: [server.command, ...server.args],
            enabled: true,
          },
        },
      };
    }
    case "claude-code": {
      const mcpServers = asObject(config.mcpServers);
      return {
        ...config,
        mcpServers: {
          ...mcpServers,
          [server.name]: {
            type: "stdio",
            command: server.command,
            args: server.args,
            env: {},
          },
        },
      };
    }
  }
}

export function uninstallMcpConfig(
  client: McpClient,
  currentConfig: unknown,
): Record<string, unknown> {
  const config = asObject(currentConfig);

  switch (client) {
    case "opencode": {
      const mcp = asObject(config.mcp);
      if (!("agentdeck" in mcp)) {
        return config;
      }

      const { agentdeck: _agentdeck, ...remainingMcp } = mcp;
      return withOptionalObject(config, "mcp", remainingMcp);
    }
    case "claude-code": {
      const mcpServers = asObject(config.mcpServers);
      if (!("agentdeck" in mcpServers)) {
        return config;
      }

      const { agentdeck: _agentdeck, ...remainingServers } = mcpServers;
      return withOptionalObject(config, "mcpServers", remainingServers);
    }
  }
}

export async function installMcpConfig(
  input: InstallMcpConfigInput,
): Promise<InstallMcpConfigResult> {
  await assertSafeConfigTarget(input.configPath);
  const currentConfig = await readJsonIfExists(input.configPath);
  const patchedConfig = patchMcpConfig(
    input.client,
    currentConfig,
    input.server,
  );

  if (stableJson(currentConfig) === stableJson(patchedConfig)) {
    return { configPath: input.configPath, changed: false };
  }

  await mkdir(dirname(input.configPath), { recursive: true });
  const shouldBackup = input.backup ?? true;
  let backupPath: string | undefined;

  if (shouldBackup && currentConfig !== undefined) {
    backupPath = `${input.configPath}.${input.backupSuffix ?? createBackupSuffix()}`;
    await copyFile(input.configPath, backupPath);
  }

  await writeJson(input.configPath, patchedConfig);
  return { configPath: input.configPath, changed: true, backupPath };
}

export async function removeMcpConfig(
  input: Omit<InstallMcpConfigInput, "server">,
): Promise<InstallMcpConfigResult> {
  await assertSafeConfigTarget(input.configPath);
  const currentConfig = await readJsonIfExists(input.configPath);
  if (currentConfig === undefined) {
    return { configPath: input.configPath, changed: false };
  }

  const patchedConfig = uninstallMcpConfig(input.client, currentConfig);

  if (stableJson(currentConfig) === stableJson(patchedConfig)) {
    return { configPath: input.configPath, changed: false };
  }

  await mkdir(dirname(input.configPath), { recursive: true });
  const shouldBackup = input.backup ?? true;
  let backupPath: string | undefined;

  if (shouldBackup && currentConfig !== undefined) {
    backupPath = `${input.configPath}.${input.backupSuffix ?? createBackupSuffix()}`;
    await copyFile(input.configPath, backupPath);
  }

  await writeJson(input.configPath, patchedConfig);
  return { configPath: input.configPath, changed: true, backupPath };
}

export function createManualConfigSnippet(
  client: McpClient,
  server: AgentDeckServerSpec,
): string {
  return `${JSON.stringify(patchMcpConfig(client, {}, server), null, 2)}\n`;
}

export async function installMcpInstructions(
  input: InstallMcpInstructionsInput,
): Promise<InstallMcpInstructionsResult> {
  if (input.scope === "repo" && !input.projectRoot) {
    throw new Error("Project root is required for repository instructions.");
  }

  if (input.scope === "global" && input.client === "opencode") {
    return installOpenCodeGlobalInstructions(input);
  }

  const filePath = getMcpInstructionsPath(input);
  const result = await installMarkedInstructionBlock({
    backup: input.backup,
    backupSuffix: input.backupSuffix,
    filePath,
    instructionText: createMcpInstructions(input.client, input.scope),
  });
  return {
    backupPaths: result.backupPath ? [result.backupPath] : [],
    changed: result.changed,
    paths: [filePath],
  };
}

export function createMcpInstructions(
  client: McpClient,
  scope: McpInstructionScope,
): string {
  const clientName = client === "opencode" ? "OpenCode" : "Claude Code";
  const scopeLine =
    scope === "global"
      ? "These instructions apply whenever an AgentDeck MCP server is configured for the current project."
      : "This repository uses AgentDeck MCP for shared local project context.";

  return [
    "## AgentDeck MCP",
    "",
    scopeLine,
    "",
    `For ${clientName}, use the AgentDeck MCP server named \`agentdeck\` when it is available. MCP config only exposes the server; these instructions define when to use it.`,
    "",
    "At the start of a work session:",
    "- Find or read the current AgentDeck workspace context.",
    "- Check open todos before starting implementation work.",
    "- List and read relevant docs before editing related code.",
    "",
    "During work:",
    "- Use AgentDeck todos for shared, durable work items.",
    "- Use AgentDeck notes for handoffs, investigation notes, and useful context that should survive the chat.",
    "- Use AgentDeck memory only for durable facts, decisions, conventions, risks, setup notes, and handoffs.",
    "- Keep AgentDeck updates concise, factual, and useful to another agent or human.",
    "",
    "Do not store secrets, credentials, tokens, API keys, private keys, or temporary chain-of-thought in AgentDeck.",
    "Prefer AgentDeck shared context over ad-hoc local notes when the information should be visible to other agents working in the same workspace.",
    "",
  ].join("\n");
}

export function getMcpInstructionsPath(
  input: Pick<InstallMcpInstructionsInput, "agentDeckConfigDir" | "client" | "homeDir" | "projectRoot" | "scope">,
): string {
  if (input.scope === "repo") {
    if (!input.projectRoot) {
      throw new Error("Project root is required for repository instructions.");
    }

    return join(
      input.projectRoot,
      input.client === "opencode" ? "AGENTS.md" : "CLAUDE.md",
    );
  }

  if (input.client === "claude-code") {
    return join(input.homeDir, ".claude", "CLAUDE.md");
  }

  return join(getAgentDeckConfigDir(input.homeDir, input.agentDeckConfigDir), "AGENTDECK.md");
}

export function getOpenCodeGlobalConfigPath(homeDir: string): string {
  return join(homeDir, ".config", "opencode", "opencode.json");
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

async function installOpenCodeGlobalInstructions(
  input: InstallMcpInstructionsInput,
): Promise<InstallMcpInstructionsResult> {
  const instructionPath = getMcpInstructionsPath(input);
  const previousInstructionContent = await readTextIfExists(instructionPath);
  const instructionResult = await installMarkedInstructionBlock({
    backup: input.backup,
    backupSuffix: input.backupSuffix,
    filePath: instructionPath,
    instructionText: createMcpInstructions(input.client, input.scope),
  });
  const configPath = getOpenCodeGlobalConfigPath(input.homeDir);
  const currentConfig = await readJsonIfExists(configPath);
  const patchedConfig = patchOpenCodeGlobalInstructions(
    currentConfig,
    instructionPath,
  );
  const configChanged = stableJson(currentConfig) !== stableJson(patchedConfig);
  let configBackupPath: string | undefined;

  try {
    if (configChanged) {
      await assertSafeConfigTarget(configPath);
      await mkdir(dirname(configPath), { recursive: true });
      if ((input.backup ?? true) && currentConfig !== undefined) {
        configBackupPath = `${configPath}.${input.backupSuffix ?? createBackupSuffix()}`;
        await copyFile(configPath, configBackupPath);
      }
      await writeJson(configPath, patchedConfig);
    }
  } catch (error) {
    if (instructionResult.changed) {
      if (previousInstructionContent === undefined) {
        await unlink(instructionPath).catch(() => undefined);
      } else {
        await writeTextAtomic(instructionPath, previousInstructionContent);
      }
    }

    throw error;
  }

  return {
    backupPaths: [instructionResult.backupPath, configBackupPath].filter(
      Boolean,
    ) as string[],
    changed: instructionResult.changed || configChanged,
    paths: [instructionPath, configPath],
  };
}

function patchOpenCodeGlobalInstructions(
  currentConfig: unknown,
  instructionPath: string,
): Record<string, unknown> {
  const config = asObject(currentConfig);
  const currentInstructions = Array.isArray(config.instructions)
    ? config.instructions
    : [];
  if (currentInstructions.includes(instructionPath)) {
    return config;
  }

  return {
    ...config,
    $schema:
      typeof config.$schema === "string"
        ? config.$schema
        : "https://opencode.ai/config.json",
    instructions: [...currentInstructions, instructionPath],
  };
}

async function installMarkedInstructionBlock(input: {
  backup?: boolean | undefined;
  backupSuffix?: string | undefined;
  filePath: string;
  instructionText: string;
}): Promise<{ backupPath?: string | undefined; changed: boolean }> {
  const currentContent = await readTextIfExists(input.filePath);
  const nextContent = patchMarkedInstructionBlock(
    currentContent ?? "",
    input.instructionText,
  );
  return writeInstructionFileIfChanged({
    backup: input.backup,
    backupSuffix: input.backupSuffix,
    filePath: input.filePath,
    nextContent,
  });
}

function patchMarkedInstructionBlock(
  currentContent: string,
  instructionText: string,
): string {
  const block = `${agentDeckInstructionStart}\n${instructionText.trim()}\n${agentDeckInstructionEnd}`;
  const pattern = new RegExp(
    `${escapeRegExp(agentDeckInstructionStart)}[\\s\\S]*?${escapeRegExp(agentDeckInstructionEnd)}`,
  );

  if (pattern.test(currentContent)) {
    return `${currentContent.replace(pattern, block).trimEnd()}\n`;
  }

  const prefix = currentContent.trimEnd();
  return `${prefix ? `${prefix}\n\n` : ""}${block}\n`;
}

async function writeInstructionFileIfChanged(input: {
  backup?: boolean | undefined;
  backupSuffix?: string | undefined;
  filePath: string;
  nextContent: string;
}): Promise<{ backupPath?: string | undefined; changed: boolean }> {
  await assertSafeConfigTarget(input.filePath);
  const currentContent = await readTextIfExists(input.filePath);
  if (currentContent === input.nextContent) {
    return { changed: false };
  }

  await mkdir(dirname(input.filePath), { recursive: true });
  let backupPath: string | undefined;
  if ((input.backup ?? true) && currentContent !== undefined) {
    backupPath = `${input.filePath}.${input.backupSuffix ?? createBackupSuffix()}`;
    await copyFile(input.filePath, backupPath);
  }

  await writeTextAtomic(input.filePath, input.nextContent);
  return { backupPath, changed: true };
}

async function writeTextAtomic(filePath: string, content: string): Promise<void> {
  const tempPath = join(dirname(filePath), `.agentdeck-${basename(filePath)}-${process.pid}-${Date.now()}.tmp`);
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, filePath);
}

async function readTextIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return undefined;
    }

    throw error;
  }
}

function getAgentDeckConfigDir(
  homeDir: string,
  agentDeckConfigDir: string | undefined,
): string {
  return agentDeckConfigDir ?? join(homeDir, ".config", "agentdeck");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function withOptionalObject(
  config: Record<string, unknown>,
  key: string,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const { [key]: _removed, ...rest } = config;
  return Object.keys(value).length > 0 ? { ...rest, [key]: value } : rest;
}

async function assertSafeConfigTarget(filePath: string): Promise<void> {
  await assertSafeParentDirectory(dirname(filePath));

  try {
    const stats = await lstat(filePath);
    if (stats.isSymbolicLink()) {
      throw new Error(
        `Refusing to modify symlinked MCP client config: ${filePath}`,
      );
    }

    if (!stats.isFile()) {
      throw new Error(`MCP client config path is not a file: ${filePath}`);
    }
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return;
    }

    throw error;
  }
}

async function assertSafeParentDirectory(directoryPath: string): Promise<void> {
  await assertNoSymlinkedPathParts(directoryPath);

  try {
    const stats = await lstat(directoryPath);
    if (stats.isSymbolicLink()) {
      throw new Error(
        `Refusing to modify MCP client config in symlinked directory: ${directoryPath}`,
      );
    }

    if (!stats.isDirectory()) {
      throw new Error(`MCP client config parent is not a directory: ${directoryPath}`);
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
        throw new Error(`Refusing to modify MCP client config in symlinked path: ${pathPart}`);
      }

      if (!stats.isDirectory()) {
        throw new Error(`MCP client config path parent is not a directory: ${pathPart}`);
      }
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        throw error;
      }
    }
  }
}

async function readJsonIfExists(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return undefined;
    }

    throw new Error(`Unable to read MCP client config as JSON: ${filePath}`);
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  const tempPath = join(dirname(filePath), `.agentdeck-${basename(filePath)}-${process.pid}-${Date.now()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function stableJson(data: unknown): string {
  return JSON.stringify(data ?? {});
}

function createBackupSuffix(): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
}

function isFileNotFoundError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT",
  );
}
