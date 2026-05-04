import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Memory, Note, Todo, Workspace } from "@agentdeck/core";
import type { AppSettings, SettingsBridge, SharedStateBridge } from "../terminal/bridge.js";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("./TerminalEmulator.js", () => ({
  TerminalEmulator: ({ cwd, onCwdChange, paneId }: { cwd?: string; onCwdChange?: (cwd: string) => void; paneId: string }) => <div data-cwd={cwd} data-testid={`terminal-emulator-${paneId}`} onClick={() => onCwdChange?.(`D:\\${paneId}`)} />,
}));

import { App, canInsertTerminalOnSide, getClampedContextMenuPosition, getTerminalRange, initialSplitLayout, insertTerminal, insertTerminalOnSide, removeTerminalFromLayout, resizeAdjacentSizes, resizeSplitGroup } from "./App.js";

afterEach(() => cleanup());
afterEach(() => {
  delete window.agentDeck;
});

describe("App", () => {
  test("renders a zero-gap terminal workspace shell", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain("Primary navigation");
    expect(markup).toContain("Workspace content");
    expect(markup).toContain("Workspace panes");
    expect(markup).toContain("OpenCode terminal");
    expect(markup).toContain("Resize root panes");
    expect(markup).not.toContain("Split OpenCode right");
    expect(markup).not.toContain("Close OpenCode");
    expect(markup).not.toContain("Dynamic Pane Canvas");
    expect(markup).not.toContain("Pane layout presets");
    expect(markup).not.toContain("Drag pane headers");
  });

  test("defines attached split groups instead of dashboard coordinates", () => {
    expect(initialSplitLayout.type).toBe("split");

    if (initialSplitLayout.type !== "split") {
      throw new Error("Expected split layout");
    }

    expect(initialSplitLayout.direction).toBe("row");
    expect(initialSplitLayout.sizes).toEqual([0.5, 0.5]);
    expect(countTerminals(initialSplitLayout)).toBe(2);
  });

  test("resizes one pane by shrinking the adjacent attached pane", () => {
    expect(resizeAdjacentSizes([0.62, 0.38], 0, 100, 1000, 220)).toEqual([0.72, 0.28]);
    expect(resizeAdjacentSizes([0.62, 0.38], 0, 900, 1000, 220)).toEqual([0.78, 0.21999999999999997]);
    expect(resizeAdjacentSizes([0.62, 0.38], 0, -900, 1000, 220)).toEqual([0.22, 0.78]);
    expect(resizeAdjacentSizes([0.5, 0.5], 0, 300, 1000, 220, 440)).toEqual([0.56, 0.43999999999999995]);
  });

  test("updates only the targeted split group", () => {
    const nextLayout = resizeSplitGroup(initialSplitLayout, "root", 0, 80, 1000, 220);

    if (nextLayout.type !== "split") {
      throw new Error("Expected split layout");
    }

    expect(nextLayout.sizes).toEqual([0.58, 0.42000000000000004]);
    expect(findSplitSizes(nextLayout, "missing")).toBeUndefined();
  });

  test("adds and removes terminals in the split tree", () => {
    const expandedLayout = insertTerminal(initialSplitLayout, "term-1", "term-3", "row");
    expect(countTerminals(expandedLayout)).toBe(3);

    if (expandedLayout.type !== "split") {
      throw new Error("Expected split layout");
    }

    expect(expandedLayout.children).toHaveLength(3);
    expect(expandedLayout.sizes).toEqual([0.33333333333333337, 0.3333333333333333, 0.33333333333333337]);

    const removedLayout = removeTerminalFromLayout(expandedLayout, "term-3");
    expect(removedLayout).not.toBeNull();
    expect(countTerminals(removedLayout ?? initialSplitLayout)).toBe(2);

    if (removedLayout?.type !== "split") {
      throw new Error("Expected split layout after removal");
    }

    expect(removedLayout.sizes).toEqual([0.5, 0.5]);
  });

  test("adds terminals around adjacent selected panes", () => {
    const expandedLayout = insertTerminalOnSide(initialSplitLayout, ["term-1", "term-2"], "term-3", "right");
    const rootSizes = findSplitSizes(expandedLayout, "root");

    expect(countTerminals(expandedLayout)).toBe(3);
    expect(rootSizes).toEqual([0.33333333333333337, 0.33333333333333337, 0.3333333333333333]);
  });

  test("validates contiguous selections before side insertion", () => {
    const expandedLayout = insertTerminalOnSide(initialSplitLayout, ["term-2"], "term-3", "right");
    expect(getTerminalRange(expandedLayout, "term-1", "term-2")).toEqual(["term-1", "term-2"]);
    expect(canInsertTerminalOnSide(expandedLayout, ["term-1", "term-2"])).toBe(true);
    expect(canInsertTerminalOnSide(expandedLayout, ["term-1", "term-3"])).toBe(false);
    expect(insertTerminalOnSide(expandedLayout, ["term-1", "term-3"], "term-4", "right")).toBe(expandedLayout);
  });

  test("keeps terminal context menus inside the viewport", () => {
    expect(getClampedContextMenuPosition(790, 590, 190, 236, 800, 600)).toEqual({ x: 602, y: 356 });
    expect(getClampedContextMenuPosition(-20, -12, 190, 236, 800, 600)).toEqual({ x: 8, y: 8 });
  });

  test("inserts terminals to the requested side", () => {
    const expandedLayout = insertTerminalOnSide(initialSplitLayout, ["term-1"], "term-3", "left");

    if (expandedLayout.type !== "split") {
      throw new Error("Expected split layout");
    }

    expect(expandedLayout.children[0]).toEqual({ type: "terminal", id: "term-3" });
    expect(expandedLayout.sizes).toEqual([0.3333333333333333, 0.33333333333333337, 0.33333333333333337]);
  });

  test("preserves sibling size ratios when adding terminals", () => {
    const layout = { ...initialSplitLayout, sizes: [0.6, 0.4] };
    const expandedLayout = insertTerminalOnSide(layout, ["term-1"], "term-3", "right");

    if (expandedLayout.type !== "split") {
      throw new Error("Expected split layout");
    }

    expect(expandedLayout.sizes).toEqual([0.4, 0.3333333333333333, 0.2666666666666667]);

    const removedLayout = removeTerminalFromLayout(expandedLayout, "term-3");
    if (removedLayout?.type !== "split") {
      throw new Error("Expected split layout after removal");
    }

    expect(removedLayout.sizes).toEqual([0.6, 0.4]);
  });

  test("opens a context menu to add and remove terminal panes", async () => {
    render(<App />);

    fireEvent.contextMenu(screen.getByLabelText("OpenCode terminal"), { clientX: 24, clientY: 30 });
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Right" }));
    expect(screen.getByLabelText("Terminal 3 terminal")).toBeTruthy();

    fireEvent.contextMenu(screen.getByLabelText("Terminal 3 terminal"), { clientX: 24, clientY: 30 });
    const closeSession = vi.fn(() => Promise.resolve(true));
    window.agentDeck = createFakeBridge({ closeSession });
    fireEvent.click(screen.getByRole("menuitem", { name: "Close selected" }));
    expect(screen.queryByLabelText("Terminal 3 terminal")).toBeNull();
    expect(closeSession).toHaveBeenCalledWith("term-3");
  });

  test("renames a terminal from the context menu", () => {
    render(<App />);

    fireEvent.contextMenu(screen.getByLabelText("OpenCode terminal"), { clientX: 24, clientY: 30 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    fireEvent.change(screen.getByRole("textbox", { name: "Rename terminal" }), { target: { value: "Builder" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByLabelText("Builder terminal")).toBeTruthy();
  });

  test("saves the current workspace through the bridge", async () => {
    const savedDocuments: unknown[] = [];
    const saveWorkspace = vi.fn((document: unknown) => {
      savedDocuments.push(document);
      return Promise.resolve(true);
    });
    window.agentDeck = createFakeBridge({ workspace: { autoLoadWorkspace: () => Promise.resolve(null), autoSaveWorkspace: () => Promise.resolve(true), importWorkspace: () => Promise.resolve(null), saveWorkspace } });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Save workspace" }));

    await waitFor(() => expect(saveWorkspace).toHaveBeenCalled());
    expect(savedDocuments[0]).toMatchObject({ activeTabId: "tab-1", name: "AgentDeck Workspace", nextTabIndex: 2, version: 3, nextTerminalIndex: 3, settings: { sharedContextEnabled: true, terminalAppearance: { borders: true, dividers: true, font: "jetbrains", shape: "rounded", spacing: "comfort" } } });
    expect((savedDocuments[0] as { tabs: unknown[] }).tabs).toHaveLength(1);
  });

  test("imports a workspace and closes existing sessions", async () => {
    const closeSession = vi.fn(() => Promise.resolve(true));
    window.agentDeck = createFakeBridge({
      closeSession,
      workspace: {
        autoLoadWorkspace: () => Promise.resolve(null),
        autoSaveWorkspace: () => Promise.resolve(true),
        importWorkspace: () =>
          Promise.resolve({
            activeTabId: "tab-9",
            name: "Imported",
            nextTabIndex: 10,
            nextTerminalIndex: 10,
            settings: { sharedContextEnabled: false, terminalAppearance: { borders: false, dividers: false, font: "consolas", shape: "boxy", spacing: "roomy" }, terminalDefaultCwd: "D:\\imported-default" },
            tabs: [
              {
                id: "tab-9",
                layout: { id: "term-9", type: "terminal" },
                panes: {
                  "term-9": { command: "shell", cwd: "D:\\imported", detail: "imported", id: "term-9", status: "ready", title: "Imported Shell", tone: "neutral" },
                },
                title: "Imported Tab",
              },
            ],
            version: 3,
          }),
        saveWorkspace: () => Promise.resolve(true),
      },
    });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Import workspace" }));

    await waitFor(() => expect(screen.getByLabelText("Imported Shell terminal")).toBeTruthy());
    expect(screen.queryByLabelText("OpenCode terminal")).toBeNull();
    expect(closeSession).toHaveBeenCalledWith("term-1");
    expect(closeSession).toHaveBeenCalledWith("term-2");
    expect(screen.getByLabelText("Workspace panes").className).toContain("terminal-workspace--boxy");
    expect(screen.getByLabelText("Workspace panes").className).toContain("terminal-workspace--font-consolas");
    expect(screen.getByLabelText("Workspace panes").className).toContain("terminal-workspace--spacing-roomy");
    expect(screen.getByLabelText("Workspace panes").className).toContain("terminal-workspace--no-borders");
    expect(screen.getByLabelText("Workspace panes").className).toContain("terminal-workspace--no-dividers");
    await userEvent.setup().click(screen.getByRole("button", { name: "Settings" }));
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });

  test("loads an autosaved workspace on startup", async () => {
    const updateSettings = vi.fn((settings: Partial<AppSettings>) => Promise.resolve({ sharedContextEnabled: settings.sharedContextEnabled ?? true }));
    window.agentDeck = createFakeBridge({
      settings: createFakeSettingsBridge({ update: updateSettings }),
      workspace: {
        autoLoadWorkspace: () =>
          Promise.resolve({
            activeTabId: "tab-9",
            name: "Autosaved",
            nextTabIndex: 10,
            nextTerminalIndex: 10,
            settings: { sharedContextEnabled: true, terminalAppearance: { borders: false, dividers: true, font: "system", shape: "boxy", spacing: "compact" }, terminalDefaultCwd: "D:\\autosaved-default" },
            tabs: [
              {
                id: "tab-9",
                layout: { id: "term-9", type: "terminal" },
                panes: {
                  "term-9": { command: "shell", cwd: "D:\\autosaved", detail: "autosaved", id: "term-9", status: "ready", title: "Restored Shell", tone: "neutral" },
                },
                title: "Restored Tab",
              },
            ],
            version: 3,
          }),
        autoSaveWorkspace: () => Promise.resolve(true),
        importWorkspace: () => Promise.resolve(null),
        saveWorkspace: () => Promise.resolve(true),
      },
    });

    render(<App />);

    await waitFor(() => expect(screen.getByLabelText("Restored Shell terminal")).toBeTruthy());
    expect(updateSettings).toHaveBeenCalledWith({ sharedContextEnabled: true });
    expect(screen.queryByLabelText("OpenCode terminal")).toBeNull();
    expect(screen.getByLabelText("Workspace panes").className).toContain("terminal-workspace--font-system");
    expect(screen.getByLabelText("Workspace panes").className).toContain("terminal-workspace--spacing-compact");
  });

  test("autosaves terminal workspace changes", async () => {
    const autoSaveWorkspace = vi.fn(() => Promise.resolve(true));
    window.agentDeck = createFakeBridge({ workspace: { autoLoadWorkspace: () => Promise.resolve(null), autoSaveWorkspace, importWorkspace: () => Promise.resolve(null), saveWorkspace: () => Promise.resolve(true) } });
    render(<App />);

    fireEvent.contextMenu(screen.getByLabelText("OpenCode terminal"), { clientX: 24, clientY: 30 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Right" }));

    await waitFor(() => expect(autoSaveWorkspace).toHaveBeenCalled());
    expect(autoSaveWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({ nextTerminalIndex: 4 }));
  });

  test("autosaves automatically tracked terminal cwd", async () => {
    const autoLoadWorkspace = vi.fn(() => Promise.resolve(null));
    const autoSaveWorkspace = vi.fn(() => Promise.resolve(true));
    window.agentDeck = createFakeBridge({ workspace: { autoLoadWorkspace, autoSaveWorkspace, importWorkspace: () => Promise.resolve(null), saveWorkspace: () => Promise.resolve(true) } });
    render(<App />);

    await waitFor(() => expect(autoLoadWorkspace).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("terminal-emulator-term-1"));

    await waitFor(() => expect(autoSaveWorkspace).toHaveBeenCalled());
    expect(autoSaveWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({ tabs: [expect.objectContaining({ panes: expect.objectContaining({ "term-1": expect.objectContaining({ cwd: "D:\\term-1" }) }) })] }));
  });

  test("updates terminal appearance from the floating control", async () => {
    const user = userEvent.setup();
    render(<App />);

    const workspace = screen.getByLabelText("Workspace panes");
    expect(workspace.className).toContain("terminal-workspace--rounded");
    expect(workspace.className).toContain("terminal-workspace--spacing-comfort");

    await user.click(screen.getByRole("button", { name: "Terminal appearance" }));
    await user.click(screen.getByRole("button", { name: "Consolas" }));
    await user.click(screen.getByRole("button", { name: "Boxy" }));
    await user.click(screen.getByRole("button", { name: "Roomy" }));
    await user.click(screen.getByRole("button", { name: "No dividers" }));
    await user.click(screen.getByRole("button", { name: "No borders" }));

    expect(workspace.className).toContain("terminal-workspace--boxy");
    expect(workspace.className).toContain("terminal-workspace--font-consolas");
    expect(workspace.className).toContain("terminal-workspace--spacing-roomy");
    expect(workspace.className).toContain("terminal-workspace--no-dividers");
    expect(workspace.className).toContain("terminal-workspace--no-borders");
  });

  test("saves terminal appearance with the workspace", async () => {
    const savedDocuments: unknown[] = [];
    const saveWorkspace = vi.fn((document: unknown) => {
      savedDocuments.push(document);
      return Promise.resolve(true);
    });
    window.agentDeck = createFakeBridge({ workspace: { autoLoadWorkspace: () => Promise.resolve(null), autoSaveWorkspace: () => Promise.resolve(true), importWorkspace: () => Promise.resolve(null), saveWorkspace } });
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Terminal appearance" }));
    await user.click(screen.getByRole("button", { name: "Consolas" }));
    await user.click(screen.getByRole("button", { name: "Boxy" }));
    await user.click(screen.getByRole("button", { name: "Roomy" }));
    await user.click(screen.getByRole("button", { name: "No dividers" }));
    await user.click(screen.getByRole("button", { name: "No borders" }));
    fireEvent.click(screen.getByRole("button", { name: "Save workspace" }));

    await waitFor(() => expect(saveWorkspace).toHaveBeenCalled());
    expect(savedDocuments[0]).toMatchObject({ settings: { terminalAppearance: { borders: false, dividers: false, font: "consolas", shape: "boxy", spacing: "roomy" } } });
  });

  test("uses the configured default path for newly spawned terminals", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByLabelText("OpenCode terminal")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Terminal appearance" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Default path" }), { target: { value: "D:\\projects\\AgentDeck" } });
    fireEvent.contextMenu(screen.getByLabelText("OpenCode terminal"), { clientX: 24, clientY: 30 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Right" }));

    expect(screen.getByTestId("terminal-emulator-term-3").getAttribute("data-cwd")).toBe("D:\\projects\\AgentDeck");
    expect(screen.getByTestId("terminal-emulator-term-1").getAttribute("data-cwd")).toBe("");
  });

  test("selects the terminal default path with a folder picker", async () => {
    const selectFolder = vi.fn(() => Promise.resolve("D:\\picked"));
    window.agentDeck = createFakeBridge({ workspace: { autoLoadWorkspace: () => Promise.resolve(null), autoSaveWorkspace: () => Promise.resolve(true), importWorkspace: () => Promise.resolve(null), saveWorkspace: () => Promise.resolve(true), selectFolder } });
    render(<App />);

    await waitFor(() => expect(screen.getByLabelText("OpenCode terminal")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Terminal appearance" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose default terminal folder" }));

    await waitFor(() => expect(screen.getByRole("textbox", { name: "Default path" })).toHaveProperty("value", "D:\\picked"));
    expect(selectFolder).toHaveBeenCalled();
  });

  test("creates and switches terminal tabs", () => {
    render(<App />);

    expect(screen.getByRole("tab", { name: /Main/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "New terminal tab" }));

    expect(screen.getByRole("tab", { name: /Tab 2/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("Terminal 3 terminal")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /Main/ }));
    expect(screen.getByRole("tab", { name: /Main/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("OpenCode terminal")).toBeTruthy();
  });

  test("renames a terminal tab", () => {
    render(<App />);

    fireEvent.doubleClick(screen.getByRole("tab", { name: /Main/ }));

    fireEvent.change(screen.getByRole("textbox", { name: "Rename tab" }), { target: { value: "Build" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("tab", { name: /Build/ })).toBeTruthy();
  });

  test("closes a terminal tab and its sessions", () => {
    const closeSession = vi.fn(() => Promise.resolve(true));
    window.agentDeck = createFakeBridge({ closeSession });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "New terminal tab" }));
    fireEvent.click(screen.getByLabelText("Close Tab 2 tab"));

    expect(closeSession).toHaveBeenCalledWith("term-3");
    expect(screen.queryByRole("tab", { name: /Tab 2/ })).toBeNull();
    expect(screen.getByRole("tab", { name: /Main/ }).getAttribute("aria-selected")).toBe("true");
  });

  test("opens and dismisses the terminal menu from the keyboard", () => {
    render(<App />);

    fireEvent.keyDown(screen.getByLabelText("OpenCode terminal"), { key: "F10", shiftKey: true });

    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  test("does not intercept spaces typed inside terminal content", () => {
    render(<App />);

    const terminalContent = screen.getByTestId("terminal-emulator-term-1");
    const spaceEvent = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: " " });

    terminalContent.dispatchEvent(spaceEvent);

    expect(spaceEvent.defaultPrevented).toBe(false);
  });

  test("creates unique terminals across repeated adds", async () => {
    render(<App />);

    fireEvent.contextMenu(screen.getByLabelText("OpenCode terminal"), { clientX: 24, clientY: 30 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Right" }));
    fireEvent.contextMenu(screen.getByLabelText("OpenCode terminal"), { clientX: 24, clientY: 30 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Right" }));

    expect(screen.getByLabelText("Terminal 3 terminal")).toBeTruthy();
    expect(screen.getByLabelText("Terminal 4 terminal")).toBeTruthy();
  });

  test("shift-selects adjacent terminals before adding to a side", () => {
    render(<App />);

    fireEvent.click(screen.getByLabelText("OpenCode terminal"));
    fireEvent.click(screen.getByLabelText("Scratch terminal"), { shiftKey: true });
    fireEvent.contextMenu(screen.getByLabelText("Scratch terminal"), { clientX: 24, clientY: 30 });

    expect(screen.getByText("Add terminal beside 2 terminals")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Right" }));
    expect(screen.getByLabelText("Terminal 3 terminal")).toBeTruthy();
  });

  test("closes multiple selected terminals", () => {
    render(<App />);

    fireEvent.click(screen.getByLabelText("OpenCode terminal"));
    fireEvent.click(screen.getByLabelText("Scratch terminal"), { shiftKey: true });
    fireEvent.contextMenu(screen.getByLabelText("Scratch terminal"), { clientX: 24, clientY: 30 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Close selected" }));

    expect(screen.queryByLabelText("OpenCode terminal")).toBeNull();
    expect(screen.queryByLabelText("Scratch terminal")).toBeNull();
  });

  test("exposes resize sashes as oriented separators", () => {
    render(<App />);

    const separators = screen.getAllByRole("separator");
    expect(separators).toHaveLength(1);
    expect(separators.map((separator) => separator.getAttribute("aria-orientation"))).toEqual(["vertical"]);
    expect(separators.map((separator) => separator.getAttribute("aria-label"))).toEqual(["Resize root panes"]);
  });

  test("moves shared context to separate pages", async () => {
    const user = userEvent.setup();
    window.agentDeck = createFakeBridge();
    render(<App />);

    expect(screen.getAllByLabelText("Workspace panes")).not.toHaveLength(0);
    expect(screen.queryByText("Shared project work that stays available to humans and local agents.")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Todos" }));

    expect(screen.getByText("Shared project work that stays available to humans and local agents.")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("No shared todos yet.")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Todos" }).getAttribute("aria-pressed")).toBe("true");
  });

  test("creates updates and deletes todos through shared state", async () => {
    const user = userEvent.setup();
    const todos = [createTodo({ title: "Wire real shared state" })];
    const listTodos = vi.fn(() => Promise.resolve([...todos]));
    const createTodoMock = vi.fn((input) => {
      const todo = createTodo({ title: input.title, description: input.description, priority: input.priority });
      todos.push(todo);
      return Promise.resolve(todo);
    });
    const updateTodo = vi.fn((todoId, input) => {
      const index = todos.findIndex((todo) => todo.id === todoId);
      todos[index] = { ...todos[index]!, ...input, updatedAt: new Date().toISOString() };
      return Promise.resolve(todos[index]!);
    });
    const deleteTodo = vi.fn((todoId) => {
      const index = todos.findIndex((todo) => todo.id === todoId);
      const [deleted] = todos.splice(index, 1);
      return Promise.resolve(deleted!);
    });
    window.agentDeck = createFakeBridge({ shared: createFakeSharedBridge({ createTodo: createTodoMock, deleteTodo, listTodos, updateTodo }) });
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Todos" }));
    await screen.findByText("Wire real shared state");

    await user.click(screen.getByRole("button", { name: "Add Todo" }));
    const todoDialog = screen.getByRole("dialog", { name: "Add Todo" });
    await user.type(within(todoDialog as HTMLElement).getByLabelText("Todo title"), "Add UI CRUD");
    await user.click(within(todoDialog as HTMLElement).getByRole("button", { name: "Add Todo" }));
    await waitFor(() => expect(createTodoMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Add UI CRUD", workspaceId: testWorkspace.id })));
    await screen.findByText("Add UI CRUD");

    await user.click(screen.getAllByRole("button", { name: "Start" })[0]!);
    await waitFor(() => expect(updateTodo).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ status: "in_progress" })));

    await user.click(screen.getAllByRole("button", { name: "Delete" })[0]!);
    await waitFor(() => expect(deleteTodo).toHaveBeenCalledWith(expect.any(String)));
  });

  test("shows notes and memory tabs backed by shared state", async () => {
    const user = userEvent.setup();
    const notes = [createNote({ title: "Decision log", body: "Use local-first shared state." })];
    const memories = [createMemory({ content: "Use stdio MCP first.", type: "decision" })];
    const createNoteMock = vi.fn((input) => {
      const note = createNote({ title: input.title, body: input.body });
      notes.push(note);
      return Promise.resolve(note);
    });
    const storeMemory = vi.fn((input) => {
      const memory = createMemory({ content: input.content, type: input.type });
      memories.push(memory);
      return Promise.resolve(memory);
    });
    window.agentDeck = createFakeBridge({ shared: createFakeSharedBridge({ createNote: createNoteMock, listMemories: () => Promise.resolve([...memories]), listNotes: () => Promise.resolve([...notes]), searchMemory: (_workspaceId, query) => Promise.resolve(memories.filter((memory) => memory.content.includes(query))), storeMemory }) });
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Memory" }));
    await screen.findByText("Decision log");
    await user.click(screen.getByRole("button", { name: "Add Note" }));
    const noteDialog = screen.getByRole("dialog", { name: "Add Note" });
    await user.type(within(noteDialog as HTMLElement).getByLabelText("Note title"), "Handoff note");
    await user.type(within(noteDialog as HTMLElement).getByLabelText("Note body"), "Continue with Docs next.");
    await user.click(within(noteDialog as HTMLElement).getByRole("button", { name: "Add Note" }));
    await waitFor(() => expect(createNoteMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Handoff note", workspaceId: testWorkspace.id })));

    await user.click(screen.getByRole("tab", { name: "Memory entries" }));
    await screen.findByText("Use stdio MCP first.");
    await user.click(screen.getByRole("button", { name: "Store Memory" }));
    const memoryDialog = screen.getByRole("dialog", { name: "Store Memory" });
    await user.type(within(memoryDialog as HTMLElement).getByLabelText("Memory content"), "Docs read from workspace docs folder.");
    await user.click(within(memoryDialog as HTMLElement).getByRole("button", { name: "Store Memory" }));
    await waitFor(() => expect(storeMemory).toHaveBeenCalledWith(expect.objectContaining({ content: "Docs read from workspace docs folder.", workspaceId: testWorkspace.id })));
  });

  test("lists and reads workspace docs through shared state", async () => {
    const user = userEvent.setup();
    const readDoc = vi.fn(() => Promise.resolve({ path: "MCP_CONTRACT.md", size: 42, text: "# MCP Contract\nTools are shared.", updatedAt: "2026-05-03T00:00:00.000Z" }));
    window.agentDeck = createFakeBridge({ shared: createFakeSharedBridge({ listDocs: () => Promise.resolve([{ path: "MCP_CONTRACT.md", size: 42, updatedAt: "2026-05-03T00:00:00.000Z" }]), readDoc }) });
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Docs" }));
    await user.click(await screen.findByRole("button", { name: /MCP_CONTRACT\.md/ }));

    await waitFor(() => expect(readDoc).toHaveBeenCalledWith(testWorkspace.id, "MCP_CONTRACT.md"));
    expect(screen.getByRole("complementary", { name: "Doc preview" })).toBeTruthy();
    expect(await screen.findByText(/# MCP Contract/)).toBeTruthy();
  });

  test("hides terminal tabs when switching to a resource page", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: "Memory" }));

    expect(screen.getByRole("button", { name: "Memory" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("region", { name: "Memory" })).toBeTruthy();
    expect(container.querySelector(".terminal-page")?.hasAttribute("hidden")).toBe(true);
  });

  test("opens settings from the sidebar", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByRole("region", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Enable Shared Context" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "OpenCode" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Claude Code" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Install Global MCP" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Repair Global MCP" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Uninstall" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Copy Config" })).toHaveLength(2);
  });

  test("disables shared context without uninstalling MCP integrations", async () => {
    const user = userEvent.setup();
    const settings = { sharedContextEnabled: true };
    const update = vi.fn((input: Partial<AppSettings>) => {
      Object.assign(settings, input);
      return Promise.resolve({ ...settings });
    });
    window.agentDeck = createFakeBridge({ settings: createFakeSettingsBridge({ get: () => Promise.resolve({ ...settings }), update }) });
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(await screen.findByRole("checkbox"));

    await waitFor(() => expect(update).toHaveBeenCalledWith({ sharedContextEnabled: false }));
    expect(screen.queryByRole("button", { name: "Docs" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Todos" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Memory" })).toBeNull();
    expect(screen.getByRole("heading", { name: "OpenCode" })).toBeTruthy();
  });

  test("runs MCP integration actions through the bridge", async () => {
    const user = userEvent.setup();
    const install = vi.fn(() => Promise.resolve({ changed: true, ok: true, message: "Installed AgentDeck MCP config", status: "installed" as const }));
    const uninstall = vi.fn(() => Promise.resolve({ changed: true, ok: true, message: "Uninstalled AgentDeck MCP config", status: "not_installed" as const }));
    const copyConfig = vi.fn(() => Promise.resolve({ changed: false, ok: true, message: "Copied config", status: "manual" as const }));
    const copyInstructions = vi.fn(() => Promise.resolve({ changed: false, ok: true, message: "Copied instructions", status: "manual" as const }));
    const installInstructions = vi.fn(() => Promise.resolve({ changed: true, ok: true, message: "Installed instructions", status: "installed" as const }));
    window.agentDeck = createFakeBridge({ mcp: { copyConfig, copyInstructions, getStatus: createMcpStatus, install, installInstructions, uninstall } });
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getAllByRole("button", { name: "Install Global MCP" })[0]!);
    await waitFor(() => expect(install).toHaveBeenCalledWith("opencode"));
    expect(screen.getByText(/Installed AgentDeck MCP config/)).toBeTruthy();

    await user.click(screen.getAllByRole("button", { name: "Copy Config" })[0]!);
    await waitFor(() => expect(copyConfig).toHaveBeenCalledWith("opencode"));
    expect(screen.getByText("Copied config")).toBeTruthy();

    await user.click(screen.getAllByRole("button", { name: "Uninstall" })[0]!);
    await waitFor(() => expect(uninstall).toHaveBeenCalledWith("opencode"));
    expect(screen.getByText("Uninstalled AgentDeck MCP config")).toBeTruthy();

    await user.click(screen.getAllByRole("button", { name: "Install Global Instructions" })[0]!);
    await waitFor(() => expect(installInstructions).toHaveBeenCalledWith("opencode", "global"));
    expect(screen.getByText("Installed instructions")).toBeTruthy();

    await user.click(screen.getAllByRole("button", { name: "Generate Repo Instructions" })[0]!);
    await waitFor(() => expect(installInstructions).toHaveBeenCalledWith("opencode", "repo"));

    await user.click(screen.getAllByRole("button", { name: "Copy Instructions" })[0]!);
    await waitFor(() => expect(copyInstructions).toHaveBeenCalledWith("opencode", "global"));
  });

  test("shows instruction notice when MCP is installed without instructions", async () => {
    const user = userEvent.setup();
    const installInstructions = vi.fn(() => Promise.resolve({ changed: true, ok: true, message: "Installed instructions", status: "installed" as const }));
    window.agentDeck = createFakeBridge({
      mcp: {
        copyConfig: () => Promise.resolve({ changed: false, ok: true, message: "Copied config", status: "manual" as const }),
        copyInstructions: () => Promise.resolve({ changed: false, ok: true, message: "Copied instructions", status: "manual" as const }),
        getStatus: () => Promise.resolve({
          "claude-code": { instructionsInstalled: false, mcpInstalled: false },
          opencode: { instructionsInstalled: false, mcpInstalled: true },
        }),
        install: () => Promise.resolve({ changed: true, ok: true, message: "Installed", status: "installed" as const }),
        installInstructions,
        uninstall: () => Promise.resolve({ changed: true, ok: true, message: "Uninstalled", status: "not_installed" as const }),
      },
    });
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await waitFor(() => expect(screen.getByText("Instructions recommended")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Install Instructions" }));
    await waitFor(() => expect(installInstructions).toHaveBeenCalledWith("opencode", "global"));
  });

  test("prompts for instructions after successful MCP install", async () => {
    const user = userEvent.setup();
    const installInstructions = vi.fn(() => Promise.resolve({ changed: true, ok: true, message: "Installed instructions", status: "installed" as const }));
    window.agentDeck = createFakeBridge({
      mcp: {
        copyConfig: () => Promise.resolve({ changed: false, ok: true, message: "Copied config", status: "manual" as const }),
        copyInstructions: () => Promise.resolve({ changed: false, ok: true, message: "Copied instructions", status: "manual" as const }),
        getStatus: () => Promise.resolve({
          "claude-code": { instructionsInstalled: true, mcpInstalled: false },
          opencode: { instructionsInstalled: false, mcpInstalled: true },
        }),
        install: () => Promise.resolve({ changed: true, ok: true, message: "Installed", status: "installed" as const }),
        installInstructions,
        uninstall: () => Promise.resolve({ changed: true, ok: true, message: "Uninstalled", status: "not_installed" as const }),
      },
    });
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getAllByRole("button", { name: "Install Global MCP" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "AgentDeck instruction recommendation" });
    expect(container.querySelector(".instruction-dialog-backdrop")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(within(dialog as HTMLElement).getByRole("button", { name: "Install Instructions" })));
    await user.click(within(dialog as HTMLElement).getByRole("button", { name: "Install Instructions" }));
    await waitFor(() => expect(installInstructions).toHaveBeenCalledWith("opencode", "global"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "AgentDeck instruction recommendation" })).toBeNull());
  });

  test("closes instruction prompt before waiting for status refresh", async () => {
    const user = userEvent.setup();
    type McpStatus = Awaited<ReturnType<NonNullable<Window["agentDeck"]>["mcp"]["getStatus"]>>;
    const statusAfterInstructions = createDeferred<McpStatus>();
    const getStatus = vi.fn()
      .mockResolvedValueOnce({
        "claude-code": { instructionsInstalled: true, mcpInstalled: false },
        opencode: { instructionsInstalled: false, mcpInstalled: true },
      })
      .mockResolvedValueOnce({
        "claude-code": { instructionsInstalled: true, mcpInstalled: false },
        opencode: { instructionsInstalled: false, mcpInstalled: true },
      })
      .mockReturnValueOnce(statusAfterInstructions.promise);
    window.agentDeck = createFakeBridge({
      mcp: {
        copyConfig: () => Promise.resolve({ changed: false, ok: true, message: "Copied config", status: "manual" as const }),
        copyInstructions: () => Promise.resolve({ changed: false, ok: true, message: "Copied instructions", status: "manual" as const }),
        getStatus,
        install: () => Promise.resolve({ changed: true, ok: true, message: "Installed", status: "installed" as const }),
        installInstructions: () => Promise.resolve({ changed: true, ok: true, message: "Installed instructions", status: "installed" as const }),
        uninstall: () => Promise.resolve({ changed: true, ok: true, message: "Uninstalled", status: "not_installed" as const }),
      },
    });
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getAllByRole("button", { name: "Install Global MCP" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "AgentDeck instruction recommendation" });
    await user.click(within(dialog as HTMLElement).getByRole("button", { name: "Install Instructions" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "AgentDeck instruction recommendation" })).toBeNull());
  });

  test("ignores stale MCP status responses after installing instructions", async () => {
    const user = userEvent.setup();
    type McpStatus = Awaited<ReturnType<NonNullable<Window["agentDeck"]>["mcp"]["getStatus"]>>;
    const initialStatus = createDeferred<McpStatus>();
    const installStatus = createDeferred<McpStatus>();
    const instructionsStatus = createDeferred<McpStatus>();
    const getStatus = vi.fn()
      .mockReturnValueOnce(initialStatus.promise)
      .mockReturnValueOnce(installStatus.promise)
      .mockReturnValueOnce(instructionsStatus.promise);
    window.agentDeck = createFakeBridge({
      mcp: {
        copyConfig: () => Promise.resolve({ changed: false, ok: true, message: "Copied config", status: "manual" as const }),
        copyInstructions: () => Promise.resolve({ changed: false, ok: true, message: "Copied instructions", status: "manual" as const }),
        getStatus,
        install: () => Promise.resolve({ changed: true, ok: true, message: "Installed", status: "installed" as const }),
        installInstructions: () => Promise.resolve({ changed: true, ok: true, message: "Installed instructions", status: "installed" as const }),
        uninstall: () => Promise.resolve({ changed: true, ok: true, message: "Uninstalled", status: "not_installed" as const }),
      },
    });
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getAllByRole("button", { name: "Install Global MCP" })[0]!);
    await waitFor(() => expect(getStatus).toHaveBeenCalledTimes(2));
    installStatus.resolve({
      "claude-code": { instructionsInstalled: true, mcpInstalled: false },
      opencode: { instructionsInstalled: false, mcpInstalled: true },
    });
    const dialog = await screen.findByRole("dialog", { name: "AgentDeck instruction recommendation" });

    await user.click(within(dialog as HTMLElement).getByRole("button", { name: "Install Instructions" }));
    await waitFor(() => expect(getStatus).toHaveBeenCalledTimes(3));
    instructionsStatus.resolve({
      "claude-code": { instructionsInstalled: true, mcpInstalled: false },
      opencode: { instructionsInstalled: true, mcpInstalled: true },
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "AgentDeck instruction recommendation" })).toBeNull());

    initialStatus.resolve({
      "claude-code": { instructionsInstalled: true, mcpInstalled: false },
      opencode: { instructionsInstalled: false, mcpInstalled: true },
    });
    await waitFor(() => expect(screen.queryByLabelText("MCP setup notifications")).toBeNull());
  });

  test("tracks pending MCP actions independently per client", async () => {
    const user = userEvent.setup();
    const resolveInstallByClient: Partial<Record<"opencode" | "claude-code", (value: { changed: boolean; ok: boolean; message: string; status: "installed" }) => void>> = {};
    const install = vi.fn(
      (client: "opencode" | "claude-code") =>
        new Promise<{ changed: boolean; ok: boolean; message: string; status: "installed" }>((resolve) => {
          resolveInstallByClient[client] = resolve;
        }),
    );
    window.agentDeck = createFakeBridge({
      mcp: {
        copyConfig: () => Promise.resolve({ changed: false, ok: true, message: "Copied config", status: "manual" as const }),
        copyInstructions: () => Promise.resolve({ changed: false, ok: true, message: "Copied instructions", status: "manual" as const }),
        getStatus: createMcpStatus,
        install,
        installInstructions: () => Promise.resolve({ changed: true, ok: true, message: "Installed instructions", status: "installed" as const }),
        uninstall: () => Promise.resolve({ changed: true, ok: true, message: "Uninstalled", status: "not_installed" as const }),
      },
    });
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    const opencodeCard = screen.getByRole("heading", { name: "OpenCode" }).closest(".integration-card");
    if (!opencodeCard) {
      throw new Error("Expected OpenCode integration card");
    }
    const claudeCard = screen.getByRole("heading", { name: "Claude Code" }).closest(".integration-card");
    if (!claudeCard) {
      throw new Error("Expected Claude Code integration card");
    }

    await user.click(within(opencodeCard as HTMLElement).getByRole("button", { name: "Install Global MCP" }));
    await user.click(within(claudeCard as HTMLElement).getByRole("button", { name: "Install Global MCP" }));

    expect((within(opencodeCard as HTMLElement).getByRole("button", { name: "Install Global MCP" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(opencodeCard as HTMLElement).getByRole("button", { name: "Repair Global MCP" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(opencodeCard as HTMLElement).getByRole("button", { name: "Uninstall" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(opencodeCard as HTMLElement).getByRole("button", { name: "Copy Config" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(opencodeCard as HTMLElement).getByRole("button", { name: "Install Global Instructions" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(claudeCard as HTMLElement).getByRole("button", { name: "Install Global MCP" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(claudeCard as HTMLElement).getByRole("button", { name: "Repair Global MCP" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(claudeCard as HTMLElement).getByRole("button", { name: "Uninstall" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(claudeCard as HTMLElement).getByRole("button", { name: "Copy Config" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(claudeCard as HTMLElement).getByRole("button", { name: "Install Global Instructions" }) as HTMLButtonElement).disabled).toBe(true);

    resolveInstallByClient.opencode?.({ changed: true, ok: true, message: "Installed", status: "installed" });
    await waitFor(() => expect((within(opencodeCard as HTMLElement).getByRole("button", { name: "Install Global MCP" }) as HTMLButtonElement).disabled).toBe(false));
    expect((within(claudeCard as HTMLElement).getByRole("button", { name: "Install Global MCP" }) as HTMLButtonElement).disabled).toBe(true);

    resolveInstallByClient["claude-code"]?.({ changed: true, ok: true, message: "Installed", status: "installed" });
    await waitFor(() => expect((within(claudeCard as HTMLElement).getByRole("button", { name: "Install Global MCP" }) as HTMLButtonElement).disabled).toBe(false));
  });
});

function countTerminals(node: typeof initialSplitLayout): number {
  if (node.type === "terminal") {
    return 1;
  }

  return node.children.reduce((count, child) => count + countTerminals(child), 0);
}

function findSplitSizes(node: typeof initialSplitLayout, id: string): number[] | undefined {
  if (node.type === "terminal") {
    return undefined;
  }

  if (node.id === id) {
    return node.sizes;
  }

  for (const child of node.children) {
    const match = findSplitSizes(child, id);
    if (match) {
      return match;
    }
  }

  return undefined;
}

function createMcpStatus() {
  return Promise.resolve({
    "claude-code": { instructionsInstalled: true, mcpInstalled: false },
    opencode: { instructionsInstalled: true, mcpInstalled: false },
  });
}

function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

const testWorkspace: Workspace = {
  createdAt: "2026-05-03T00:00:00.000Z",
  description: "Test workspace",
  id: "11111111-1111-4111-8111-111111111111",
  name: "Test Workspace",
  rootPath: "D:\\projects\\test-workspace",
  updatedAt: "2026-05-03T00:00:00.000Z",
};

type EntityOverrides<T> = { [K in keyof T]?: T[K] | undefined };

function withoutUndefined<T extends object>(overrides: EntityOverrides<T>): Partial<T> {
  return Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function createTodo(overrides: EntityOverrides<Todo> = {}): Todo {
  return {
    createdAt: "2026-05-03T00:00:00.000Z",
    description: "",
    id: crypto.randomUUID(),
    priority: "medium" as const,
    status: "todo" as const,
    tags: [],
    title: "Test todo",
    updatedAt: "2026-05-03T00:00:00.000Z",
    workspaceId: testWorkspace.id,
    ...withoutUndefined(overrides),
  };
}

function createNote(overrides: EntityOverrides<Note> = {}): Note {
  return {
    body: "",
    createdAt: "2026-05-03T00:00:00.000Z",
    id: crypto.randomUUID(),
    source: "human" as const,
    tags: [],
    title: "Test note",
    updatedAt: "2026-05-03T00:00:00.000Z",
    workspaceId: testWorkspace.id,
    ...withoutUndefined(overrides),
  };
}

function createMemory(overrides: EntityOverrides<Memory> = {}): Memory {
  return {
    content: "Test memory",
    createdAt: "2026-05-03T00:00:00.000Z",
    id: crypto.randomUUID(),
    source: "human",
    tags: [],
    type: "fact" as const,
    updatedAt: "2026-05-03T00:00:00.000Z",
    workspaceId: testWorkspace.id,
    ...withoutUndefined(overrides),
  };
}

function createFakeSharedBridge(overrides: Partial<SharedStateBridge> = {}): SharedStateBridge {
  return {
    bootstrapWorkspace: () => Promise.resolve(testWorkspace),
    createNote: (input) => Promise.resolve(createNote(input)),
    createTodo: (input) => Promise.resolve(createTodo(input)),
    deleteNote: (noteId) => Promise.resolve(createNote({ id: noteId })),
    deleteTodo: (todoId) => Promise.resolve(createTodo({ id: todoId })),
    listDocs: () => Promise.resolve([]),
    listMemories: () => Promise.resolve([]),
    listNotes: () => Promise.resolve([]),
    listTodos: () => Promise.resolve([]),
    readDoc: (_workspaceId, path) => Promise.resolve({ path, size: 0, text: "", updatedAt: "2026-05-03T00:00:00.000Z" }),
    searchMemory: () => Promise.resolve([]),
    selectWorkspaceRoot: () => Promise.resolve(testWorkspace),
    storeMemory: (input) => Promise.resolve(createMemory(input)),
    updateNote: (noteId, input) => Promise.resolve(createNote({ id: noteId, ...input })),
    updateTodo: (todoId, input) => Promise.resolve(createTodo({ id: todoId, ...input })),
    ...overrides,
  };
}

function createFakeSettingsBridge(overrides: Partial<SettingsBridge> = {}): SettingsBridge {
  return {
    get: () => Promise.resolve({ sharedContextEnabled: true }),
    update: (settings) => Promise.resolve({ sharedContextEnabled: settings.sharedContextEnabled ?? true }),
    ...overrides,
  };
}

function createFakeBridge(overrides: Partial<NonNullable<Window["agentDeck"]>["terminal"]> & { mcp?: NonNullable<Window["agentDeck"]>["mcp"]; settings?: NonNullable<Window["agentDeck"]>["settings"]; shared?: NonNullable<Window["agentDeck"]>["shared"]; workspace?: Partial<NonNullable<Window["agentDeck"]>["workspace"]> } = {}): NonNullable<Window["agentDeck"]> {
  const { mcp, settings, shared, workspace, ...terminalOverrides } = overrides;
  return {
    mcp: mcp ?? {
      copyConfig: () => Promise.resolve({ changed: false, ok: true, message: "Copied config", status: "manual" }),
      copyInstructions: () => Promise.resolve({ changed: false, ok: true, message: "Copied instructions", status: "manual" }),
      getStatus: createMcpStatus,
      install: () => Promise.resolve({ changed: true, ok: true, message: "Installed", status: "installed" }),
      installInstructions: () => Promise.resolve({ changed: true, ok: true, message: "Installed instructions", status: "installed" }),
      uninstall: () => Promise.resolve({ changed: true, ok: true, message: "Uninstalled", status: "not_installed" }),
    },
    settings: settings ?? createFakeSettingsBridge(),
    shared: shared ?? createFakeSharedBridge(),
    terminal: {
      closeSession: () => Promise.resolve(true),
      createSession: () => Promise.resolve(true),
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
      ...workspace,
    },
  };
}
