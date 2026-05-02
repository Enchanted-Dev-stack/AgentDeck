import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test } from "vitest";
import { App, initialSplitLayout, insertTerminal, removeTerminalFromLayout, resizeAdjacentSizes, resizeSplitGroup } from "./App.js";

afterEach(() => cleanup());

describe("App", () => {
  test("renders a zero-gap terminal workspace shell", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain("Primary navigation");
    expect(markup).toContain("Workspace content");
    expect(markup).toContain("Workspace panes");
    expect(markup).toContain("OpenCode terminal");
    expect(markup).toContain("Resize root panes");
    expect(markup).toContain("Split OpenCode right");
    expect(markup).toContain("Close OpenCode");
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

  test("lets users add and remove terminal panes", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Split OpenCode right" }));
    expect(screen.getByLabelText("Terminal 5 terminal")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Close Terminal 5" }));
    expect(screen.queryByLabelText("Terminal 5 terminal")).toBeNull();
  });

  test("creates unique terminals across repeated adds", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Split OpenCode right" }));
    await user.click(screen.getByRole("button", { name: "Split OpenCode right" }));

    expect(screen.getByLabelText("Terminal 5 terminal")).toBeTruthy();
    expect(screen.getByLabelText("Terminal 6 terminal")).toBeTruthy();
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
