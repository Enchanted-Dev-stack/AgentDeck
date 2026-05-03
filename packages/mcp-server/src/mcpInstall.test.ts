import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  buildAgentDeckServerSpec,
  getClientConfigPath,
  installMcpConfig,
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

  test("returns project-level config paths", () => {
    expect(
      getClientConfigPath("opencode", "D:/project").replace(/\\/g, "/"),
    ).toBe("D:/project/opencode.json");
    expect(
      getClientConfigPath("claude-code", "D:/project").replace(/\\/g, "/"),
    ).toBe("D:/project/.mcp.json");
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
