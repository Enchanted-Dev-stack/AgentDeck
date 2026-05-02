import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { App, moveItemBefore } from "./App.js";

describe("App", () => {
  test("renders the primary operations shell regions", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain("Saved workspaces");
    expect(markup).toContain("Workspace panes");
    expect(markup).toContain("Shared context deck");
    expect(markup).toContain("MCP: STDIO READY");
    expect(markup).toContain("Pane layout presets");
    expect(markup).toContain("data-layout=\"quad\"");
    expect(markup).toContain("Presets keep panes inside the grid");
    expect(markup).toContain("LAYOUT: QUAD / MANAGED GRID");
  });

  test("moves a dragged pane before the drop target", () => {
    const panes = [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }];

    expect(moveItemBefore(panes, "A", "C").map((pane) => pane.id)).toEqual(["B", "A", "C", "D"]);
    expect(moveItemBefore(panes, "D", "B").map((pane) => pane.id)).toEqual(["A", "D", "B", "C"]);
  });

  test("switches managed pane layout presets", async () => {
    const user = userEvent.setup();
    render(<App />);

    const paneGrid = screen.getByLabelText("Workspace panes");
    expect(paneGrid.getAttribute("data-layout")).toBe("quad");

    await user.click(screen.getByRole("button", { name: "Columns" }));

    expect(paneGrid.getAttribute("data-layout")).toBe("columns");
    expect(screen.getByRole("button", { name: "Columns" }).getAttribute("aria-pressed")).toBe("true");
  });
});
