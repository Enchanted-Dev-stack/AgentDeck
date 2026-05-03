import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { parseCliArgs } from "./cli.js";

describe("agentdeck-mcp CLI", () => {
  test("parses stdio server options", () => {
    expect(parseCliArgs(["--state-file", "/tmp/state.json"])).toEqual({
      command: "serve",
      stateFilePath: resolve("/tmp/state.json"),
    });
  });

  test("parses install command", () => {
    expect(
      parseCliArgs([
        "install",
        "--client",
        "opencode",
        "--project-root",
        "/repo",
        "--state-file",
        "/tmp/state.json",
        "--command",
        "agentdeck-mcp",
        "--no-backup",
      ]),
    ).toEqual({
      command: "install",
      client: "opencode",
      projectRoot: resolve("/repo"),
      stateFilePath: resolve("/tmp/state.json"),
      mcpCommand: "agentdeck-mcp",
      backup: false,
    });
  });

  test("requires state file", () => {
    expect(() => parseCliArgs([])).toThrow(/state-file/i);
  });
});
