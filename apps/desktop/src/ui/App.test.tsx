import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("./TerminalEmulator.js", () => ({
  TerminalEmulator: ({ paneId }: { paneId: string }) => <div data-testid={`terminal-emulator-${paneId}`} />,
}));

import { App, canInsertTerminalOnSide, getTerminalRange, initialSplitLayout, insertTerminal, insertTerminalOnSide, removeTerminalFromLayout, resizeAdjacentSizes, resizeSplitGroup } from "./App.js";

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
    expect(countTerminals(initialSplitLayout)).toBe(4);
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
    expect(findSplitSizes(nextLayout, "bottom-row")).toEqual([0.5, 0.5]);
  });

  test("adds and removes terminals in the split tree", () => {
    const expandedLayout = insertTerminal(initialSplitLayout, "term-1", "term-5", "row");
    expect(countTerminals(expandedLayout)).toBe(5);

    if (expandedLayout.type !== "split") {
      throw new Error("Expected split layout");
    }

    expect(expandedLayout.children).toHaveLength(3);
    expect(expandedLayout.sizes).toEqual([0.25, 0.25, 0.5]);

    const removedLayout = removeTerminalFromLayout(expandedLayout, "term-5");
    expect(removedLayout).not.toBeNull();
    expect(countTerminals(removedLayout ?? initialSplitLayout)).toBe(4);

    if (removedLayout?.type !== "split") {
      throw new Error("Expected split layout after removal");
    }

    expect(removedLayout.sizes).toEqual([0.5, 0.5]);
  });

  test("adds terminals around adjacent selected panes", () => {
    const expandedLayout = insertTerminalOnSide(initialSplitLayout, ["term-3", "term-4"], "term-5", "right");
    const bottomRowSizes = findSplitSizes(expandedLayout, "bottom-row");

    expect(countTerminals(expandedLayout)).toBe(5);
    expect(bottomRowSizes).toEqual([0.33333333333333337, 0.33333333333333337, 0.3333333333333333]);
  });

  test("validates contiguous selections before side insertion", () => {
    expect(getTerminalRange(initialSplitLayout, "term-2", "term-3")).toEqual(["term-2", "term-3"]);
    expect(canInsertTerminalOnSide(initialSplitLayout, ["term-3", "term-4"])).toBe(true);
    expect(canInsertTerminalOnSide(initialSplitLayout, ["term-2", "term-3"])).toBe(false);
    expect(insertTerminalOnSide(initialSplitLayout, ["term-2", "term-3"], "term-5", "right")).toBe(initialSplitLayout);
  });

  test("inserts terminals to the requested side", () => {
    const expandedLayout = insertTerminalOnSide(initialSplitLayout, ["term-1"], "term-5", "left");

    if (expandedLayout.type !== "split") {
      throw new Error("Expected split layout");
    }

    expect(expandedLayout.children[0]).toEqual({ type: "terminal", id: "term-5" });
    expect(expandedLayout.sizes).toEqual([0.25, 0.25, 0.5]);
  });

  test("opens a context menu to add and remove terminal panes", async () => {
    render(<App />);

    fireEvent.contextMenu(screen.getByLabelText("OpenCode terminal"), { clientX: 24, clientY: 30 });
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Right" }));
    expect(screen.getByLabelText("Terminal 5 terminal")).toBeTruthy();

    fireEvent.contextMenu(screen.getByLabelText("Terminal 5 terminal"), { clientX: 24, clientY: 30 });
    const closeSession = vi.fn(() => Promise.resolve(true));
    window.agentDeck = createFakeBridge({ closeSession });
    fireEvent.click(screen.getByRole("menuitem", { name: "Close selected" }));
    expect(screen.queryByLabelText("Terminal 5 terminal")).toBeNull();
    expect(closeSession).toHaveBeenCalledWith("term-5");
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
    window.agentDeck = createFakeBridge({ workspace: { importWorkspace: () => Promise.resolve(null), saveWorkspace } });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Save workspace" }));

    await waitFor(() => expect(saveWorkspace).toHaveBeenCalled());
    expect(savedDocuments[0]).toMatchObject({ activeTabId: "tab-1", name: "AgentDeck Workspace", nextTabIndex: 2, version: 2, nextTerminalIndex: 5 });
    expect((savedDocuments[0] as { tabs: unknown[] }).tabs).toHaveLength(1);
  });

  test("imports a workspace and closes existing sessions", async () => {
    const closeSession = vi.fn(() => Promise.resolve(true));
    window.agentDeck = createFakeBridge({
      closeSession,
      workspace: {
        importWorkspace: () =>
          Promise.resolve({
            activeTabId: "tab-9",
            name: "Imported",
            nextTabIndex: 10,
            nextTerminalIndex: 10,
            tabs: [
              {
                id: "tab-9",
                layout: { id: "term-9", type: "terminal" },
                panes: {
                  "term-9": { command: "shell", detail: "imported", id: "term-9", status: "ready", title: "Imported Shell", tone: "neutral" },
                },
                title: "Imported Tab",
              },
            ],
            version: 2,
          }),
        saveWorkspace: () => Promise.resolve(true),
      },
    });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Import workspace" }));

    await waitFor(() => expect(screen.getByLabelText("Imported Shell terminal")).toBeTruthy());
    expect(screen.queryByLabelText("OpenCode terminal")).toBeNull();
    expect(closeSession).toHaveBeenCalledWith("term-1");
    expect(closeSession).toHaveBeenCalledWith("term-4");
  });

  test("creates and switches terminal tabs", () => {
    render(<App />);

    expect(screen.getByRole("tab", { name: /Main/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "New terminal tab" }));

    expect(screen.getByRole("tab", { name: /Tab 2/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("Terminal 5 terminal")).toBeTruthy();

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

    expect(closeSession).toHaveBeenCalledWith("term-5");
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

  test("creates unique terminals across repeated adds", async () => {
    render(<App />);

    fireEvent.contextMenu(screen.getByLabelText("OpenCode terminal"), { clientX: 24, clientY: 30 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Right" }));
    fireEvent.contextMenu(screen.getByLabelText("OpenCode terminal"), { clientX: 24, clientY: 30 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Right" }));

    expect(screen.getByLabelText("Terminal 5 terminal")).toBeTruthy();
    expect(screen.getByLabelText("Terminal 6 terminal")).toBeTruthy();
  });

  test("shift-selects adjacent terminals before adding to a side", () => {
    render(<App />);

    fireEvent.click(screen.getByLabelText("Tests terminal"), { shiftKey: true });
    fireEvent.click(screen.getByLabelText("Scratch terminal"), { shiftKey: true });
    fireEvent.contextMenu(screen.getByLabelText("Scratch terminal"), { clientX: 24, clientY: 30 });

    expect(screen.getByText("Add terminal beside 2 terminals")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Right" }));
    expect(screen.getByLabelText("Terminal 5 terminal")).toBeTruthy();
  });

  test("disables side insertion for non-group selections", () => {
    render(<App />);

    fireEvent.click(screen.getByLabelText("Dev server terminal"));
    fireEvent.click(screen.getByLabelText("Tests terminal"), { shiftKey: true });
    fireEvent.contextMenu(screen.getByLabelText("Tests terminal"), { clientX: 24, clientY: 30 });

    expect(screen.getByText("Select one attached pane group")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Right" }).getAttribute("disabled")).not.toBeNull();
  });

  test("closes multiple selected terminals", () => {
    render(<App />);

    fireEvent.click(screen.getByLabelText("Tests terminal"));
    fireEvent.click(screen.getByLabelText("Scratch terminal"), { shiftKey: true });
    fireEvent.contextMenu(screen.getByLabelText("Scratch terminal"), { clientX: 24, clientY: 30 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Close selected" }));

    expect(screen.queryByLabelText("Tests terminal")).toBeNull();
    expect(screen.queryByLabelText("Scratch terminal")).toBeNull();
    expect(screen.getByLabelText("OpenCode terminal")).toBeTruthy();
    expect(screen.getByLabelText("Dev server terminal")).toBeTruthy();
  });

  test("exposes resize sashes as oriented separators", () => {
    render(<App />);

    const separators = screen.getAllByRole("separator");
    expect(separators).toHaveLength(3);
    expect(separators.map((separator) => separator.getAttribute("aria-orientation"))).toEqual(["vertical", "horizontal", "vertical"]);
    expect(separators.map((separator) => separator.getAttribute("aria-label"))).toEqual(["Resize root panes", "Resize right-stack panes", "Resize bottom-row panes"]);
  });

  test("moves shared context to separate pages", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getAllByLabelText("Workspace panes")).not.toHaveLength(0);
    expect(screen.queryByText("Shared project work that stays available to humans and local agents.")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Todos" }));

    expect(screen.getByText("Shared project work that stays available to humans and local agents.")).toBeTruthy();
    expect(screen.getByText("Wire MCP tool contract tests")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Todos" }).getAttribute("aria-pressed")).toBe("true");
  });

  test("hides terminal tabs when switching to a resource page", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: "Memory" }));

    expect(screen.getByRole("button", { name: "Memory" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("region", { name: "Memory" })).toBeTruthy();
    expect(container.querySelector(".terminal-page")?.hasAttribute("hidden")).toBe(true);
  });

  test("opens MCP integrations from the sidebar", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "MCP Integrations" }));

    expect(screen.getByRole("region", { name: "MCP Integrations" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "OpenCode" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Claude Code" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Install" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Repair" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Uninstall" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Copy Config" })).toHaveLength(2);
  });

  test("runs MCP integration actions through the bridge", async () => {
    const user = userEvent.setup();
    const install = vi.fn(() => Promise.resolve({ changed: true, ok: true, message: "Installed AgentDeck MCP config", status: "installed" as const }));
    const uninstall = vi.fn(() => Promise.resolve({ changed: true, ok: true, message: "Uninstalled AgentDeck MCP config", status: "not_installed" as const }));
    const copyConfig = vi.fn(() => Promise.resolve({ changed: false, ok: true, message: "Copied config", status: "manual" as const }));
    window.agentDeck = createFakeBridge({ mcp: { copyConfig, install, uninstall } });
    render(<App />);

    await user.click(screen.getByRole("button", { name: "MCP Integrations" }));
    await user.click(screen.getAllByRole("button", { name: "Install" })[0]!);
    await waitFor(() => expect(install).toHaveBeenCalledWith("opencode"));
    expect(screen.getByText("Installed AgentDeck MCP config")).toBeTruthy();

    await user.click(screen.getAllByRole("button", { name: "Copy Config" })[0]!);
    await waitFor(() => expect(copyConfig).toHaveBeenCalledWith("opencode"));
    expect(screen.getByText("Copied config")).toBeTruthy();

    await user.click(screen.getAllByRole("button", { name: "Uninstall" })[0]!);
    await waitFor(() => expect(uninstall).toHaveBeenCalledWith("opencode"));
    expect(screen.getByText("Uninstalled AgentDeck MCP config")).toBeTruthy();
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
        install,
        uninstall: () => Promise.resolve({ changed: true, ok: true, message: "Uninstalled", status: "not_installed" as const }),
      },
    });
    render(<App />);

    await user.click(screen.getByRole("button", { name: "MCP Integrations" }));
    const opencodeCard = screen.getByRole("heading", { name: "OpenCode" }).closest(".integration-card");
    if (!opencodeCard) {
      throw new Error("Expected OpenCode integration card");
    }
    const claudeCard = screen.getByRole("heading", { name: "Claude Code" }).closest(".integration-card");
    if (!claudeCard) {
      throw new Error("Expected Claude Code integration card");
    }

    await user.click(within(opencodeCard as HTMLElement).getByRole("button", { name: "Install" }));
    await user.click(within(claudeCard as HTMLElement).getByRole("button", { name: "Install" }));

    expect((within(opencodeCard as HTMLElement).getByRole("button", { name: "Install" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(opencodeCard as HTMLElement).getByRole("button", { name: "Repair" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(opencodeCard as HTMLElement).getByRole("button", { name: "Uninstall" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(opencodeCard as HTMLElement).getByRole("button", { name: "Copy Config" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(claudeCard as HTMLElement).getByRole("button", { name: "Install" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(claudeCard as HTMLElement).getByRole("button", { name: "Repair" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(claudeCard as HTMLElement).getByRole("button", { name: "Uninstall" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(claudeCard as HTMLElement).getByRole("button", { name: "Copy Config" }) as HTMLButtonElement).disabled).toBe(true);

    resolveInstallByClient.opencode?.({ changed: true, ok: true, message: "Installed", status: "installed" });
    await waitFor(() => expect((within(opencodeCard as HTMLElement).getByRole("button", { name: "Install" }) as HTMLButtonElement).disabled).toBe(false));
    expect((within(claudeCard as HTMLElement).getByRole("button", { name: "Install" }) as HTMLButtonElement).disabled).toBe(true);

    resolveInstallByClient["claude-code"]?.({ changed: true, ok: true, message: "Installed", status: "installed" });
    await waitFor(() => expect((within(claudeCard as HTMLElement).getByRole("button", { name: "Install" }) as HTMLButtonElement).disabled).toBe(false));
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

function createFakeBridge(overrides: Partial<NonNullable<Window["agentDeck"]>["terminal"]> & { mcp?: NonNullable<Window["agentDeck"]>["mcp"]; workspace?: NonNullable<Window["agentDeck"]>["workspace"] } = {}): NonNullable<Window["agentDeck"]> {
  const { mcp, workspace, ...terminalOverrides } = overrides;
  return {
    mcp: mcp ?? {
      copyConfig: () => Promise.resolve({ changed: false, ok: true, message: "Copied config", status: "manual" }),
      install: () => Promise.resolve({ changed: true, ok: true, message: "Installed", status: "installed" }),
      uninstall: () => Promise.resolve({ changed: true, ok: true, message: "Uninstalled", status: "not_installed" }),
    },
    terminal: {
      closeSession: () => Promise.resolve(true),
      createSession: () => Promise.resolve(true),
      onData: () => () => undefined,
      onExit: () => () => undefined,
      resize: () => Promise.resolve(true),
      write: () => Promise.resolve(true),
      ...terminalOverrides,
    },
    workspace: workspace ?? {
      importWorkspace: () => Promise.resolve(null),
      saveWorkspace: () => Promise.resolve(true),
    },
  };
}
