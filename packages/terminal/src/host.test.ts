import { describe, expect, test, vi } from "vitest";
import { resolveDefaultShell, TerminalSessionHost, type PtyAdapter, type TerminalPty } from "./index.js";

class FakePty implements TerminalPty {
  dataHandlers: Array<(data: string) => void> = [];
  exitHandlers: Array<(event: { exitCode: number; signal?: number }) => void> = [];
  killed = false;
  resizes: Array<{ cols: number; rows: number }> = [];
  writes: string[] = [];

  kill() {
    this.killed = true;
  }

  onData(handler: (data: string) => void) {
    this.dataHandlers.push(handler);
    return { dispose: () => (this.dataHandlers = this.dataHandlers.filter((candidate) => candidate !== handler)) };
  }

  onExit(handler: (event: { exitCode: number; signal?: number }) => void) {
    this.exitHandlers.push(handler);
    return { dispose: () => (this.exitHandlers = this.exitHandlers.filter((candidate) => candidate !== handler)) };
  }

  resize(cols: number, rows: number) {
    this.resizes.push({ cols, rows });
  }

  write(data: string) {
    this.writes.push(data);
  }
}

describe("TerminalSessionHost", () => {
  test("creates a shell session and forwards PTY data", () => {
    const pty = new FakePty();
    const adapter: PtyAdapter = { spawn: vi.fn(() => pty) };
    const onData = vi.fn();
    const host = new TerminalSessionHost(adapter, { onData });

    host.createSession({ id: "term-1", cols: 100, rows: 30 });
    pty.dataHandlers[0]?.("hello");

    expect(adapter.spawn).toHaveBeenCalledWith(expect.objectContaining({ id: "term-1", cols: 100, rows: 30 }));
    expect(onData).toHaveBeenCalledWith({ id: "term-1", data: "hello" });
    expect(host.getSessionIds()).toEqual(["term-1"]);
  });

  test("writes, resizes, and closes existing sessions", () => {
    const pty = new FakePty();
    const host = new TerminalSessionHost({ spawn: () => pty });

    host.createSession({ id: "term-1" });

    expect(host.write("term-1", "ls\r")).toBe(true);
    expect(host.resize("term-1", 120, 40)).toBe(true);
    expect(host.closeSession("term-1")).toBe(true);

    expect(pty.writes).toEqual(["ls\r"]);
    expect(pty.resizes).toEqual([{ cols: 120, rows: 40 }]);
    expect(pty.killed).toBe(true);
    expect(host.getSessionIds()).toEqual([]);
  });

  test("removes sessions when the PTY exits", () => {
    const pty = new FakePty();
    const onExit = vi.fn();
    const host = new TerminalSessionHost({ spawn: () => pty }, { onExit });

    host.createSession({ id: "term-1" });
    pty.exitHandlers[0]?.({ exitCode: 0 });

    expect(onExit).toHaveBeenCalledWith({ id: "term-1", exitCode: 0 });
    expect(host.getSessionIds()).toEqual([]);
  });

  test("rejects duplicate session ids", () => {
    const host = new TerminalSessionHost({ spawn: () => new FakePty() });

    host.createSession({ id: "term-1" });

    expect(() => host.createSession({ id: "term-1" })).toThrow("already exists");
  });

  test("ignores missing sessions for write, resize, and close", () => {
    const host = new TerminalSessionHost({ spawn: () => new FakePty() });

    expect(host.write("missing", "input")).toBe(false);
    expect(host.resize("missing", 80, 24)).toBe(false);
    expect(host.closeSession("missing")).toBe(false);
  });
});

describe("resolveDefaultShell", () => {
  test("uses ComSpec on Windows by default", () => {
    expect(resolveDefaultShell("win32", { ComSpec: "C:\\Windows\\System32\\cmd.exe" })).toEqual({ file: "C:\\Windows\\System32\\cmd.exe", args: [] });
  });

  test("uses SHELL on POSIX platforms", () => {
    expect(resolveDefaultShell("linux", { SHELL: "/bin/zsh" })).toEqual({ file: "/bin/zsh", args: [] });
  });

  test("allows an explicit shell override", () => {
    expect(resolveDefaultShell("linux", { AGENTDECK_SHELL: "/custom/shell" })).toEqual({ file: "/custom/shell", args: [] });
  });
});
