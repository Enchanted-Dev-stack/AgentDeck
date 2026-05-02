import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

function createFakeBridge(overrides: Partial<NonNullable<Window["agentDeck"]>["terminal"]> = {}): NonNullable<Window["agentDeck"]> {
  return {
    terminal: {
      closeSession: () => Promise.resolve(true),
      createSession: () => Promise.resolve(true),
      onData: () => () => undefined,
      onExit: () => () => undefined,
      resize: () => Promise.resolve(true),
      write: () => Promise.resolve(true),
      ...overrides,
    },
  };
}
