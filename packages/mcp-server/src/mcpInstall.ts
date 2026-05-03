import { copyFile, lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export type McpClient = "opencode" | "claude-code";

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

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
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
