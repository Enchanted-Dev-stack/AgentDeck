import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  buildAgentDeckServerSpec,
  createMcpInstructions,
  getClientConfigPath,
  getMcpInstructionsPath,
  getOpenCodeGlobalConfigPath,
  installMcpConfig,
  installMcpInstructions,
  removeMcpConfig,
  patchMcpConfig,
  uninstallMcpConfig,
} from "./mcpInstall.js";

describe("MCP client installers", () => {
  test("builds a reusable AgentDeck server spec", () => {
    expect(
      buildAgentDeckServerSpec({
        command: "agentdeck-mcp",
        stateFilePath: "/tmp/agentdeck/state.json",
      }),
    ).toEqual({
      name: "agentdeck",
      command: "agentdeck-mcp",
      args: ["--state-file", "/tmp/agentdeck/state.json"],
    });
  });

  test("supports wrapper command arguments before the state file flag", () => {
    expect(
      buildAgentDeckServerSpec({
        command: "node",
        commandArgs: ["/app/agentdeck-mcp.js"],
        stateFilePath: "/tmp/agentdeck/state.json",
      }),
    ).toEqual({
      name: "agentdeck",
      command: "node",
      args: ["/app/agentdeck-mcp.js", "--state-file", "/tmp/agentdeck/state.json"],
    });
  });

  test("patches OpenCode config without removing unrelated settings", () => {
    const config = patchMcpConfig(
      "opencode",
      {
        $schema: "https://opencode.ai/config.json",
        model: "anthropic/claude-sonnet-4-5",
        mcp: {
          existing: {
            type: "remote",
            url: "https://example.com/mcp",
          },
        },
      },
      buildAgentDeckServerSpec({
        command: "agentdeck-mcp",
        stateFilePath: "/state.json",
      }),
    );

    expect(config).toEqual({
      $schema: "https://opencode.ai/config.json",
      model: "anthropic/claude-sonnet-4-5",
      mcp: {
        existing: {
          type: "remote",
          url: "https://example.com/mcp",
        },
        agentdeck: {
          type: "local",
          command: ["agentdeck-mcp", "--state-file", "/state.json"],
          enabled: true,
        },
      },
    });
  });

  test("patches Claude Code project MCP config without removing unrelated servers", () => {
    const config = patchMcpConfig(
      "claude-code",
      {
        mcpServers: {
          github: {
            type: "http",
            url: "https://api.githubcopilot.com/mcp/",
          },
        },
      },
      buildAgentDeckServerSpec({
        command: "agentdeck-mcp",
        stateFilePath: "/state.json",
      }),
    );

    expect(config).toEqual({
      mcpServers: {
        github: {
          type: "http",
          url: "https://api.githubcopilot.com/mcp/",
        },
        agentdeck: {
          type: "stdio",
          command: "agentdeck-mcp",
          args: ["--state-file", "/state.json"],
          env: {},
        },
      },
    });
  });

  test("installs config idempotently and backs up existing files", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentdeck-install-"));
    const configPath = join(root, "opencode.json");
    await mkdir(root, { recursive: true });
    await writeJson(configPath, {
      mcp: { existing: { type: "remote", url: "https://example.com" } },
    });

    const first = await installMcpConfig({
      client: "opencode",
      configPath,
      server: buildAgentDeckServerSpec({
        command: "agentdeck-mcp",
        stateFilePath: join(root, "state.json"),
      }),
      backupSuffix: "test.bak",
    });
    const second = await installMcpConfig({
      client: "opencode",
      configPath,
      server: buildAgentDeckServerSpec({
        command: "agentdeck-mcp",
        stateFilePath: join(root, "state.json"),
      }),
      backupSuffix: "test2.bak",
    });

    expect(first.changed).toBe(true);
    expect(first.backupPath).toBe(`${configPath}.test.bak`);
    expect(second.changed).toBe(false);
    expect(second.backupPath).toBeUndefined();
    await expect(readJson(`${configPath}.test.bak`)).resolves.toEqual({
      mcp: { existing: { type: "remote", url: "https://example.com" } },
    });
    await expect(readJson(configPath)).resolves.toMatchObject({
      mcp: {
        existing: { type: "remote", url: "https://example.com" },
        agentdeck: { type: "local", enabled: true },
      },
    });
  });

  test("uninstalls only the AgentDeck MCP block", async () => {
    const config = uninstallMcpConfig("claude-code", {
      mcpServers: {
        github: { type: "http", url: "https://api.githubcopilot.com/mcp/" },
        agentdeck: {
          type: "stdio",
          command: "agentdeck-mcp",
          args: ["--state-file", "/state.json"],
        },
      },
    });

    expect(config).toEqual({
      mcpServers: {
        github: { type: "http", url: "https://api.githubcopilot.com/mcp/" },
      },
    });
  });

  test("uninstall is a no-op when AgentDeck is absent", async () => {
    const config = {
      model: "anthropic/claude-sonnet-4-5",
      mcp: { other: { type: "remote", url: "https://example.com" } },
    };

    expect(uninstallMcpConfig("opencode", config)).toEqual(config);
  });

  test("uninstall removes empty MCP containers", async () => {
    expect(
      uninstallMcpConfig("claude-code", {
        mcpServers: {
          agentdeck: {
            type: "stdio",
            command: "agentdeck-mcp",
            args: ["--state-file", "/state.json"],
          },
        },
      }),
    ).toEqual({});
  });

  test("remove is a no-op when the config file is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentdeck-remove-"));
    const configPath = join(root, "opencode.json");

    await expect(
      removeMcpConfig({ client: "opencode", configPath }),
    ).resolves.toEqual({
      configPath,
      changed: false,
    });
    await expect(readFile(configPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("backs up exact original bytes before install", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentdeck-backup-"));
    const configPath = join(root, ".mcp.json");
    const original =
      '{"mcpServers":{"github":{"type":"http","url":"https://example.com"}}}\n';
    await writeFile(configPath, original, "utf8");

    const result = await installMcpConfig({
      client: "claude-code",
      configPath,
      server: buildAgentDeckServerSpec({
        command: "agentdeck-mcp",
        stateFilePath: join(root, "state.json"),
      }),
      backupSuffix: "exact.bak",
    });

    expect(result.backupPath).toBe(`${configPath}.exact.bak`);
    await expect(readFile(`${configPath}.exact.bak`, "utf8")).resolves.toBe(
      original,
    );
  });

  test("rejects symlinked config files", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentdeck-symlink-"));
    const targetPath = join(root, "target.json");
    const configPath = join(root, "opencode.json");
    await writeJson(targetPath, {});

    try {
      await symlink(targetPath, configPath);
    } catch (error) {
      if (isWindowsPrivilegeError(error)) {
        return;
      }

      throw error;
    }

    await expect(
      installMcpConfig({
        client: "opencode",
        configPath,
        server: buildAgentDeckServerSpec({
          command: "agentdeck-mcp",
          stateFilePath: join(root, "state.json"),
        }),
      }),
    ).rejects.toThrow(/symlink/i);
  });

  test("rejects config files in symlinked directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentdeck-symlink-parent-"));
    const realProject = join(root, "real-project");
    const linkedProject = join(root, "linked-project");
    await mkdir(realProject);

    try {
      await symlink(realProject, linkedProject, "dir");
    } catch (error) {
      if (isWindowsPrivilegeError(error)) {
        return;
      }

      throw error;
    }

    await expect(
      installMcpConfig({
        client: "opencode",
        configPath: join(linkedProject, "opencode.json"),
        server: buildAgentDeckServerSpec({
          command: "agentdeck-mcp",
          stateFilePath: join(root, "state.json"),
        }),
      }),
    ).rejects.toThrow(/symlink/i);
  });

  test("rejects config files under symlinked ancestor directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentdeck-symlink-ancestor-"));
    const realRoot = join(root, "real-root");
    const linkedRoot = join(root, "linked-root");
    await mkdir(join(realRoot, "project"), { recursive: true });

    try {
      await symlink(realRoot, linkedRoot, "dir");
    } catch (error) {
      if (isWindowsPrivilegeError(error)) {
        return;
      }

      throw error;
    }

    await expect(
      installMcpConfig({
        client: "opencode",
        configPath: join(linkedRoot, "project", "opencode.json"),
        server: buildAgentDeckServerSpec({
          command: "agentdeck-mcp",
          stateFilePath: join(root, "state.json"),
        }),
      }),
    ).rejects.toThrow(/symlink/i);
  });

  test("preserves existing OpenCode global instruction content with a managed block", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "agentdeck-opencode-instruction-preserve-"));
    const instructionPath = getMcpInstructionsPath({
      client: "opencode",
      homeDir,
      scope: "global",
    });
    await mkdir(join(homeDir, ".config", "agentdeck"), { recursive: true });
    await writeFile(instructionPath, "# Personal Agent Notes\n\nKeep this line.\n", "utf8");

    await installMcpInstructions({
      client: "opencode",
      homeDir,
      scope: "global",
    });

    const nextContent = await readFile(instructionPath, "utf8");
    expect(nextContent).toContain("Keep this line.");
    expect(nextContent).toContain("<!-- agentdeck:start -->");
  });

  test("returns project-level config paths", () => {
    expect(
      getClientConfigPath("opencode", "D:/project").replace(/\\/g, "/"),
    ).toBe("D:/project/opencode.json");
    expect(
      getClientConfigPath("claude-code", "D:/project").replace(/\\/g, "/"),
    ).toBe("D:/project/.mcp.json");
  });

  test("creates repository instructions with a managed AgentDeck block", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentdeck-instructions-repo-"));
    const instructionsPath = join(root, "AGENTS.md");
    await writeFile(instructionsPath, "# Existing Rules\n\n- Keep this.\n", "utf8");

    const first = await installMcpInstructions({
      backupSuffix: "repo.bak",
      client: "opencode",
      homeDir: root,
      projectRoot: root,
      scope: "repo",
    });
    const second = await installMcpInstructions({
      backupSuffix: "repo2.bak",
      client: "opencode",
      homeDir: root,
      projectRoot: root,
      scope: "repo",
    });

    expect(first.changed).toBe(true);
    expect(first.backupPaths).toEqual([`${instructionsPath}.repo.bak`]);
    expect(second.changed).toBe(false);
    await expect(readFile(instructionsPath, "utf8")).resolves.toContain("<!-- agentdeck:start -->");
    await expect(readFile(instructionsPath, "utf8")).resolves.toContain("- Keep this.");
    await expect(readFile(`${instructionsPath}.repo.bak`, "utf8")).resolves.toBe("# Existing Rules\n\n- Keep this.\n");
  });

  test("installs Claude Code global instructions in user CLAUDE.md", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "agentdeck-claude-global-"));
    const result = await installMcpInstructions({
      client: "claude-code",
      homeDir,
      scope: "global",
    });

    const instructionsPath = getMcpInstructionsPath({
      client: "claude-code",
      homeDir,
      scope: "global",
    });
    expect(result.paths).toEqual([instructionsPath]);
    await expect(readFile(instructionsPath, "utf8")).resolves.toContain("For Claude Code, use the AgentDeck MCP server");
  });

  test("installs OpenCode global instructions and preserves existing global config", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "agentdeck-opencode-global-"));
    const configPath = getOpenCodeGlobalConfigPath(homeDir);
    await mkdir(join(homeDir, ".config", "opencode"), { recursive: true });
    await writeJson(configPath, {
      model: "anthropic/claude-sonnet-4-5",
      instructions: ["CONTRIBUTING.md"],
    });

    const result = await installMcpInstructions({
      backupSuffix: "global.bak",
      client: "opencode",
      homeDir,
      scope: "global",
    });
    const instructionPath = getMcpInstructionsPath({
      client: "opencode",
      homeDir,
      scope: "global",
    });

    expect(result.changed).toBe(true);
    expect(result.backupPaths).toEqual([`${configPath}.global.bak`]);
    await expect(readFile(instructionPath, "utf8")).resolves.toContain("For OpenCode, use the AgentDeck MCP server");
    await expect(readJson(configPath)).resolves.toMatchObject({
      model: "anthropic/claude-sonnet-4-5",
      instructions: ["CONTRIBUTING.md", instructionPath],
    });
  });

  test("copies generated instruction text without filesystem access", () => {
    expect(createMcpInstructions("opencode", "global")).toContain("At the start of a work session");
    expect(createMcpInstructions("claude-code", "repo")).toContain("This repository uses AgentDeck MCP");
  });
});

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function isWindowsPrivilegeError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error.code === "EPERM" || error.code === "EACCES"),
  );
}
