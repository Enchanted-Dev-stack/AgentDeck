import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { App } from "./App.js";

describe("App", () => {
  test("renders the primary operations shell regions", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain("Saved workspaces");
    expect(markup).toContain("Workspace panes");
    expect(markup).toContain("Shared context deck");
    expect(markup).toContain("MCP: STDIO READY");
  });
});
