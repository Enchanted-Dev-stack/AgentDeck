import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { isTerminalCopyShortcut, isTerminalKeyboardPasteShortcut, isTerminalPasteShortcut } from "./terminalShortcuts.js";

const fitMock = vi.fn();
const contextLossDisposeMock = vi.fn();
const terminalDisposeMock = vi.fn();
const terminalFocusMock = vi.fn();
const terminalGetSelectionMock = vi.fn(() => "");
const terminalHasSelectionMock = vi.fn(() => false);
const terminalLoadAddonMock = vi.fn();
const terminalWriteMock = vi.fn();
const webglDisposeMock = vi.fn();
let terminalConstructorOptions: unknown[] = [];
let terminalOptionsUpdates: unknown[] = [];
let customKeyHandler: ((event: KeyboardEvent) => boolean) | undefined;
let contextLossHandler: (() => void) | undefined;

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn(() => ({ fit: fitMock })),
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: vi.fn(() => ({
    dispose: webglDisposeMock,
    onContextLoss: vi.fn((handler: () => void) => {
      contextLossHandler = handler;
      return { dispose: contextLossDisposeMock };
    }),
  })),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn((options: unknown) => {
    terminalConstructorOptions.push(options);
    const terminal = {
      attachCustomKeyEventHandler: (handler: (event: KeyboardEvent) => boolean) => {
        customKeyHandler = handler;
      },
      cols: 80,
      dispose: terminalDisposeMock,
      focus: terminalFocusMock,
      getSelection: terminalGetSelectionMock,
      hasSelection: terminalHasSelectionMock,
      loadAddon: terminalLoadAddonMock,
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      open: vi.fn(),
      rows: 24,
      write: terminalWriteMock,
      writeln: vi.fn(),
    };
    Object.defineProperty(terminal, "options", {
      set: (options) => terminalOptionsUpdates.push(options),
    });
    return terminal;
  }),
}));

import { requestTerminalRenderDiagnostic, TerminalEmulator, updateTerminalRenderOptions } from "./TerminalEmulator.js";

describe("TerminalEmulator", () => {
  beforeEach(() => {
    customKeyHandler = undefined;
    contextLossHandler = undefined;
    terminalConstructorOptions = [];
    terminalOptionsUpdates = [];
    terminalGetSelectionMock.mockReturnValue("");
    terminalHasSelectionMock.mockReturnValue(false);
    window.agentDeck = createFakeBridge();
  });

  afterEach(() => {
    cleanup();
    delete window.agentDeck;
    vi.clearAllMocks();
  });

  test("detects terminal paste shortcuts", () => {
    expect(isTerminalCopyShortcut({ ctrlKey: true, key: "c", metaKey: false })).toBe(true);
    expect(isTerminalCopyShortcut({ ctrlKey: false, key: "C", metaKey: true })).toBe(true);
    expect(isTerminalCopyShortcut({ ctrlKey: false, key: "c", metaKey: false })).toBe(false);
    expect(isTerminalPasteShortcut({ ctrlKey: true, key: "v", metaKey: false, shiftKey: false })).toBe(true);
    expect(isTerminalPasteShortcut({ ctrlKey: false, key: "V", metaKey: true, shiftKey: false })).toBe(true);
    expect(isTerminalPasteShortcut({ ctrlKey: false, key: "Insert", metaKey: false, shiftKey: true })).toBe(true);
    expect(isTerminalPasteShortcut({ ctrlKey: true, key: "c", metaKey: false, shiftKey: false })).toBe(false);
    expect(isTerminalKeyboardPasteShortcut({ key: "Insert", shiftKey: true })).toBe(true);
    expect(isTerminalKeyboardPasteShortcut({ key: "v", shiftKey: false })).toBe(false);
  });

  test("lets Ctrl+V fall through to the DOM paste event", async () => {
    const paste = vi.fn(() => Promise.resolve(true));
    const write = vi.fn(() => Promise.resolve(true));
    window.agentDeck = createFakeBridge({ paste, write });

    render(<TerminalEmulator cwd="" onCwdChange={() => undefined} paneId="term-1" />);

    await waitFor(() => expect(window.agentDeck?.terminal.createSession).toHaveBeenCalled());
    const handled = customKeyHandler?.(new KeyboardEvent("keydown", { ctrlKey: true, key: "v" }));

    expect(handled).toBe(true);
    expect(paste).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  test("routes Shift+Insert through the terminal paste bridge", async () => {
    const paste = vi.fn(() => Promise.resolve(true));
    const write = vi.fn(() => Promise.resolve(true));
    window.agentDeck = createFakeBridge({ paste, write });

    render(<TerminalEmulator cwd="" onCwdChange={() => undefined} paneId="term-1" />);

    await waitFor(() => expect(window.agentDeck?.terminal.createSession).toHaveBeenCalled());
    const handled = customKeyHandler?.(new KeyboardEvent("keydown", { key: "Insert", shiftKey: true }));

    expect(handled).toBe(false);
    expect(paste).toHaveBeenCalledWith("term-1");
    expect(write).not.toHaveBeenCalled();
  });

  test("copies terminal selection through the terminal copy bridge", async () => {
    const copySelection = vi.fn(() => Promise.resolve(true));
    const write = vi.fn(() => Promise.resolve(true));
    terminalHasSelectionMock.mockReturnValue(true);
    terminalGetSelectionMock.mockReturnValue("selected terminal text");
    window.agentDeck = createFakeBridge({ copySelection, write });

    render(<TerminalEmulator cwd="" onCwdChange={() => undefined} paneId="term-1" />);

    await waitFor(() => expect(window.agentDeck?.terminal.createSession).toHaveBeenCalled());
    const handled = customKeyHandler?.(new KeyboardEvent("keydown", { ctrlKey: true, key: "c" }));

    expect(handled).toBe(false);
    expect(copySelection).toHaveBeenCalledWith("term-1", "selected terminal text");
    expect(write).not.toHaveBeenCalled();
  });

  test("lets Ctrl+C reach the shell when there is no terminal selection", async () => {
    const copySelection = vi.fn(() => Promise.resolve(true));
    window.agentDeck = createFakeBridge({ copySelection });

    render(<TerminalEmulator cwd="" onCwdChange={() => undefined} paneId="term-1" />);

    await waitFor(() => expect(window.agentDeck?.terminal.createSession).toHaveBeenCalled());
    const handled = customKeyHandler?.(new KeyboardEvent("keydown", { ctrlKey: true, key: "c" }));

    expect(handled).toBe(true);
    expect(copySelection).not.toHaveBeenCalled();
  });

  test("routes DOM paste events through the terminal paste bridge", async () => {
    const paste = vi.fn(() => Promise.resolve(true));
    const write = vi.fn(() => Promise.resolve(true));
    window.agentDeck = createFakeBridge({ paste, write });

    const { container } = render(<TerminalEmulator cwd="" onCwdChange={() => undefined} paneId="term-1" />);
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });

    await waitFor(() => expect(window.agentDeck?.terminal.createSession).toHaveBeenCalled());
    container.firstElementChild?.dispatchEvent(pasteEvent);

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(paste).toHaveBeenCalledWith("term-1");
    expect(write).not.toHaveBeenCalled();
  });

  test("applies configured terminal font size and reports Ctrl wheel zoom", async () => {
    const onFontSizeChange = vi.fn();
    const { container } = render(<TerminalEmulator cwd="" fontSize={13} onCwdChange={() => undefined} onFontSizeChange={onFontSizeChange} paneId="term-1" />);

    await waitFor(() => expect(window.agentDeck?.terminal.createSession).toHaveBeenCalled());
    expect(terminalConstructorOptions).toContainEqual(expect.objectContaining({ fontSize: 13 }));

    const wheelEvent = new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 });
    container.firstElementChild?.dispatchEvent(wheelEvent);

    expect(wheelEvent.defaultPrevented).toBe(true);
    expect(onFontSizeChange).toHaveBeenCalledWith(14);
  });

  test("applies consecutive Ctrl wheel font zoom steps before rerender", async () => {
    const onFontSizeChange = vi.fn();
    const { container } = render(<TerminalEmulator cwd="" fontSize={13} onCwdChange={() => undefined} onFontSizeChange={onFontSizeChange} paneId="term-1" />);

    await waitFor(() => expect(window.agentDeck?.terminal.createSession).toHaveBeenCalled());
    container.firstElementChild?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 }));
    container.firstElementChild?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 }));

    expect(onFontSizeChange).toHaveBeenNthCalledWith(1, 14);
    expect(onFontSizeChange).toHaveBeenNthCalledWith(2, 15);
    expect(terminalOptionsUpdates).toContainEqual({ fontSize: 14 });
    expect(terminalOptionsUpdates).toContainEqual({ fontSize: 15 });
  });

  test("updates terminal font size without recreating the session", async () => {
    const { rerender } = render(<TerminalEmulator cwd="" fontSize={12} onCwdChange={() => undefined} paneId="term-1" />);

    await waitFor(() => expect(window.agentDeck?.terminal.createSession).toHaveBeenCalledTimes(1));
    rerender(<TerminalEmulator cwd="" fontSize={16} onCwdChange={() => undefined} paneId="term-1" />);

    expect(terminalOptionsUpdates).toContainEqual({ fontSize: 16 });
    expect(window.agentDeck?.terminal.createSession).toHaveBeenCalledTimes(1);
  });

  test("writes the direct xterm render diagnostic sample", async () => {
    render(<TerminalEmulator cwd="" onCwdChange={() => undefined} paneId="term-1" />);

    await waitFor(() => expect(window.agentDeck?.terminal.createSession).toHaveBeenCalled());
    requestTerminalRenderDiagnostic("term-1");

    expect(terminalWriteMock).toHaveBeenCalledWith(expect.stringContaining("AgentDeck xterm render diagnostic"));
    expect(terminalWriteMock).toHaveBeenCalledWith(expect.stringContaining("background cells"));
  });

  test("applies runtime render diagnostic options", async () => {
    render(<TerminalEmulator cwd="" onCwdChange={() => undefined} paneId="term-1" />);

    await waitFor(() => expect(window.agentDeck?.terminal.createSession).toHaveBeenCalled());
    updateTerminalRenderOptions({ customGlyphs: false, fontSize: 13, paneId: "term-1" });

    expect(terminalOptionsUpdates).toContainEqual({ customGlyphs: false, fontSize: 13 });
  });

  test("cleans up the WebGL renderer listener and addon", async () => {
    const { unmount } = render(<TerminalEmulator cwd="" onCwdChange={() => undefined} paneId="term-1" />);

    await waitFor(() => expect(window.agentDeck?.terminal.createSession).toHaveBeenCalled());
    expect(terminalLoadAddonMock).toHaveBeenCalled();

    contextLossHandler?.();
    expect(webglDisposeMock).toHaveBeenCalled();

    unmount();
    expect(contextLossDisposeMock).toHaveBeenCalled();
  });
});

function createFakeBridge(terminalOverrides: Partial<NonNullable<Window["agentDeck"]>["terminal"]> = {}): NonNullable<Window["agentDeck"]> {
  return {
    mcp: {
      copyConfig: () => Promise.resolve({ changed: false, ok: true, message: "Copied config", status: "manual" }),
      copyInstructions: () => Promise.resolve({ changed: false, ok: true, message: "Copied instructions", status: "manual" }),
      getStatus: () => Promise.resolve({ "claude-code": { instructionsInstalled: false, mcpInstalled: false }, opencode: { instructionsInstalled: false, mcpInstalled: false } }),
      install: () => Promise.resolve({ changed: true, ok: true, message: "Installed", status: "installed" }),
      installInstructions: () => Promise.resolve({ changed: true, ok: true, message: "Installed instructions", status: "installed" }),
      uninstall: () => Promise.resolve({ changed: true, ok: true, message: "Uninstalled", status: "not_installed" }),
    },
    settings: {
      get: () => Promise.resolve({ sharedContextEnabled: true }),
      update: (settings) => Promise.resolve({ sharedContextEnabled: settings.sharedContextEnabled ?? true }),
    },
    shared: {
      bootstrapWorkspace: () => Promise.resolve(null),
      createNote: () => Promise.reject(new Error("not implemented")),
      createTodo: () => Promise.reject(new Error("not implemented")),
      deleteNote: () => Promise.reject(new Error("not implemented")),
      deleteTodo: () => Promise.reject(new Error("not implemented")),
      listDocs: () => Promise.resolve([]),
      listMemories: () => Promise.resolve([]),
      listNotes: () => Promise.resolve([]),
      listTodos: () => Promise.resolve([]),
      readDoc: () => Promise.reject(new Error("not implemented")),
      searchMemory: () => Promise.resolve([]),
      selectWorkspaceRoot: () => Promise.resolve(null),
      storeMemory: () => Promise.reject(new Error("not implemented")),
      updateNote: () => Promise.reject(new Error("not implemented")),
      updateTodo: () => Promise.reject(new Error("not implemented")),
    },
    terminal: {
      closeSession: () => Promise.resolve(true),
      copySelection: () => Promise.resolve(true),
      createSession: vi.fn(() => Promise.resolve(true)),
      onCwd: () => () => undefined,
      onData: () => () => undefined,
      onExit: () => () => undefined,
      paste: () => Promise.resolve(true),
      resize: () => Promise.resolve(true),
      write: () => Promise.resolve(true),
      ...terminalOverrides,
    },
    workspace: {
      autoLoadWorkspace: () => Promise.resolve(null),
      autoSaveWorkspace: () => Promise.resolve(true),
      importWorkspace: () => Promise.resolve(null),
      saveWorkspace: () => Promise.resolve(true),
      selectFolder: () => Promise.resolve(null),
    },
  };
}
