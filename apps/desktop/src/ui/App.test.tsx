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
  });

  test("moves a dragged pane before the drop target", () => {
    const panes = [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }];

    expect(moveItemBefore(panes, "A", "C").map((pane) => pane.id)).toEqual(["B", "A", "C", "D"]);
    expect(moveItemBefore(panes, "D", "B").map((pane) => pane.id)).toEqual(["A", "D", "B", "C"]);
  });
});
