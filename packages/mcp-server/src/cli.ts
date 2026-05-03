#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runStdioServer } from "./index.js";
import {
  type McpClient,
  buildAgentDeckServerSpec,
  createManualConfigSnippet,
  getClientConfigPath,
  installMcpConfig,
  removeMcpConfig,
} from "./mcpInstall.js";

interface ServeCliOptions {
  command: "serve";
  stateFilePath: string;
}

interface InstallCliOptions {
  command: "install";
  client: McpClient;
  projectRoot: string;
  stateFilePath: string;
  mcpCommand: string;
  backup: boolean;
}

interface UninstallCliOptions {
  command: "uninstall";
  client: McpClient;
  projectRoot: string;
  backup: boolean;
}

interface PrintConfigCliOptions {
  command: "print-config";
  client: McpClient;
  stateFilePath: string;
  mcpCommand: string;
}

interface HelpCliOptions {
  command: "help";
}

type CliOptions =
  | ServeCliOptions
  | InstallCliOptions
  | UninstallCliOptions
  | PrintConfigCliOptions
  | HelpCliOptions;

export function parseCliArgs(args: string[]): CliOptions {
  const [first, ...rest] = args;

  if (first === "--help" || first === "-h" || first === "help") {
    return { command: "help" };
  }

  if (first === "install") {
    const flags = parseFlags(rest);
    return {
      command: "install",
      client: parseClient(requireFlag(flags, "client")),
      projectRoot: resolve(requireFlag(flags, "project-root")),
      stateFilePath: resolve(requireFlag(flags, "state-file")),
      mcpCommand: flags.command ?? "agentdeck-mcp",
      backup: flags.backup !== "false",
    };
  }

  if (first === "uninstall") {
    const flags = parseFlags(rest);
    return {
      command: "uninstall",
      client: parseClient(requireFlag(flags, "client")),
      projectRoot: resolve(requireFlag(flags, "project-root")),
      backup: flags.backup !== "false",
    };
  }

  if (first === "print-config") {
    const flags = parseFlags(rest);
    return {
      command: "print-config",
      client: parseClient(requireFlag(flags, "client")),
      stateFilePath: resolve(requireFlag(flags, "state-file")),
      mcpCommand: flags.command ?? "agentdeck-mcp",
    };
  }

  const flags = parseFlags(args);
  return {
    command: "serve",
    stateFilePath: resolve(requireFlag(flags, "state-file")),
  };
}

export async function runCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliArgs(args);

  switch (options.command) {
    case "help":
      process.stdout.write(getHelpText());
      return;
    case "serve":
      await runStdioServer({ stateFilePath: options.stateFilePath });
      return;
    case "install": {
      const result = await installMcpConfig({
        client: options.client,
        configPath: getClientConfigPath(options.client, options.projectRoot),
        server: buildAgentDeckServerSpec({
          command: options.mcpCommand,
          stateFilePath: options.stateFilePath,
        }),
        backup: options.backup,
      });
      process.stdout.write(formatInstallResult("Installed", result));
      return;
    }
    case "uninstall": {
      const result = await removeMcpConfig({
        client: options.client,
        configPath: getClientConfigPath(options.client, options.projectRoot),
        backup: options.backup,
      });
      process.stdout.write(formatInstallResult("Uninstalled", result));
      return;
    }
    case "print-config":
      process.stdout.write(
        createManualConfigSnippet(
          options.client,
          buildAgentDeckServerSpec({
            command: options.mcpCommand,
            stateFilePath: options.stateFilePath,
          }),
        ),
      );
      return;
  }
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--no-backup") {
      flags.backup = "false";
      continue;
    }

    if (!arg?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const name = arg.slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}`);
    }

    flags[name] = value;
    index += 1;
  }

  return flags;
}

function requireFlag(flags: Record<string, string>, name: string): string {
  const value = flags[name];
  if (!value) {
    throw new Error(`Missing required --${name} option.`);
  }

  return value;
}

function parseClient(value: string): McpClient {
  if (value === "opencode" || value === "claude-code") {
    return value;
  }

  throw new Error(`Unsupported MCP client: ${value}`);
}

function formatInstallResult(
  action: string,
  result: {
    configPath: string;
    changed: boolean;
    backupPath?: string | undefined;
  },
): string {
  const lines = [
    `${action} AgentDeck MCP config: ${result.configPath}`,
    `Changed: ${result.changed ? "yes" : "no"}`,
  ];
  if (result.backupPath) {
    lines.push(`Backup: ${result.backupPath}`);
  }

  return `${lines.join("\n")}\n`;
}

function getHelpText(): string {
  return [
    "Usage:",
    "  agentdeck-mcp --state-file <path>",
    "  agentdeck-mcp install --client <opencode|claude-code> --project-root <path> --state-file <path> [--command agentdeck-mcp] [--no-backup]",
    "  agentdeck-mcp uninstall --client <opencode|claude-code> --project-root <path> [--no-backup]",
    "  agentdeck-mcp print-config --client <opencode|claude-code> --state-file <path> [--command agentdeck-mcp]",
    "",
  ].join("\n");
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  runCli().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
