import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { App, initialTerminalLayouts, nudgePaneInLayouts } from "./App.js";

describe("App", () => {
  test("renders the primary operations shell regions", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain("Primary navigation");
    expect(markup).toContain("Workspace content");
    expect(markup).toContain("Workspace panes");
    expect(markup).toContain("Dynamic Pane Canvas");
    expect(markup).toContain("Drag pane headers and pull resize handles");
    expect(markup).not.toContain("Pane layout presets");
    expect(markup).not.toContain("Shared context deck");
  });

  test("defines non-overlapping initial terminal panes", () => {
    expect(initialTerminalLayouts.desktop).toHaveLength(4);
    expect(initialTerminalLayouts.mobile?.every((item) => item.w === 1)).toBe(true);
    expect(initialTerminalLayouts.desktop?.every((item) => item.minW && item.minH)).toBe(true);
    expect(initialTerminalLayouts.desktop?.map((item) => item.i)).toEqual(["TERM-01", "TERM-02", "TERM-03", "TERM-04"]);
    expect(hasLayoutCollisions(initialTerminalLayouts.desktop ?? [])).toBe(false);
    expect(hasLayoutCollisions(initialTerminalLayouts.tablet ?? [])).toBe(false);
    expect(hasLayoutCollisions(initialTerminalLayouts.mobile ?? [])).toBe(false);
  });

  test("nudges pane layouts for keyboard-accessible movement", () => {
    const nudgedLayouts = nudgePaneInLayouts(initialTerminalLayouts, "TERM-03", -1, 1);

    expect(nudgedLayouts.desktop?.find((item) => item.i === "TERM-03")?.x).toBe(5);
    expect(nudgedLayouts.desktop?.find((item) => item.i === "TERM-03")?.y).toBe(5);
    expect(nudgedLayouts.mobile?.find((item) => item.i === "TERM-03")?.x).toBe(0);
  });

  test("moves shared context to separate pages", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole("heading", { name: "Terminals" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Todos" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Todos" }));

    expect(screen.getByRole("heading", { name: "Todos" })).toBeTruthy();
    expect(screen.getByText("Wire MCP tool contract tests")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Todos" }).getAttribute("aria-pressed")).toBe("true");
  });
});

function hasLayoutCollisions(layout: NonNullable<typeof initialTerminalLayouts.desktop>) {
  return layout.some((item, index) =>
    layout.slice(index + 1).some((otherItem) =>
      item.x < otherItem.x + otherItem.w && item.x + item.w > otherItem.x && item.y < otherItem.y + otherItem.h && item.y + item.h > otherItem.y,
    ),
  );
}
