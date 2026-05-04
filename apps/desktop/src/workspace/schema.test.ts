import { describe, expect, test } from "vitest";
import { createWorkspaceDocument, parseWorkspaceDocument, type LegacyWorkspaceDocument, type WorkspaceDocument } from "./schema.js";

const tab = {
  id: "tab-1",
  layout: {
    children: [{ id: "term-1", type: "terminal" as const }],
    direction: "row" as const,
    id: "root",
    sizes: [1],
    type: "split" as const,
  },
  panes: {
    "term-1": {
      command: "shell",
      cwd: "D:\\projects\\AgentDeck",
      detail: "restored shell",
      id: "term-1",
      status: "ready",
      title: "OpenCode",
      tone: "neutral" as const,
    },
  },
  title: "Main",
};

const validDocument: WorkspaceDocument = {
  activeTabId: "tab-1",
  name: "BridgeMind",
  nextTabIndex: 2,
  nextTerminalIndex: 2,
  settings: { sharedContextEnabled: true, terminalAppearance: { borders: true, dividers: true, font: "cascadia", fontSize: 12, shape: "rounded", spacing: "comfort" }, terminalDefaultCwd: "" },
  tabs: [tab],
  version: 3,
};

const legacyDocument: LegacyWorkspaceDocument = {
  layout: tab.layout,
  name: "BridgeMind",
  nextTerminalIndex: 2,
  panes: tab.panes,
  version: 1,
};

describe("workspace schema", () => {
  test("parses a valid tabbed workspace document", () => {
    expect(parseWorkspaceDocument(validDocument)).toEqual(validDocument);
  });

  test("converts a legacy workspace document into one tab", () => {
    expect(parseWorkspaceDocument(legacyDocument)).toEqual(validDocument);
  });

  test("converts a v2 workspace document with default settings", () => {
    const { settings: _settings, version: _version, ...v2Document } = validDocument;
    expect(parseWorkspaceDocument({ ...v2Document, version: 2 })).toEqual(validDocument);
  });

  test("preserves workspace shared context settings", () => {
    expect(parseWorkspaceDocument({ ...validDocument, settings: { sharedContextEnabled: false } })).toEqual({
      ...validDocument,
      settings: { sharedContextEnabled: false, terminalAppearance: { borders: true, dividers: true, font: "cascadia", fontSize: 12, shape: "rounded", spacing: "comfort" }, terminalDefaultCwd: "" },
    });
  });

  test("preserves terminal appearance settings", () => {
    expect(parseWorkspaceDocument({ ...validDocument, settings: { sharedContextEnabled: true, terminalAppearance: { borders: false, dividers: false, font: "consolas", fontSize: 15, shape: "boxy", spacing: "roomy" } } })).toEqual({
      ...validDocument,
      settings: { sharedContextEnabled: true, terminalAppearance: { borders: false, dividers: false, font: "consolas", fontSize: 15, shape: "boxy", spacing: "roomy" }, terminalDefaultCwd: "" },
    });
  });

  test("defaults and clamps terminal font size settings", () => {
    expect(parseWorkspaceDocument({ ...validDocument, settings: { sharedContextEnabled: true, terminalAppearance: { fontSize: 100 } } })).toMatchObject({
      settings: { terminalAppearance: { fontSize: 22 } },
    });
    expect(parseWorkspaceDocument({ ...validDocument, settings: { sharedContextEnabled: true, terminalAppearance: { fontSize: 4 } } })).toMatchObject({
      settings: { terminalAppearance: { fontSize: 9 } },
    });
    expect(parseWorkspaceDocument({ ...validDocument, settings: { sharedContextEnabled: true, terminalAppearance: {} } })).toMatchObject({
      settings: { terminalAppearance: { fontSize: 12 } },
    });
  });

  test("preserves terminal default cwd settings", () => {
    expect(parseWorkspaceDocument({ ...validDocument, settings: { sharedContextEnabled: true, terminalDefaultCwd: "D:\\projects\\AgentDeck" } })).toEqual({
      ...validDocument,
      settings: { sharedContextEnabled: true, terminalAppearance: { borders: true, dividers: true, font: "cascadia", fontSize: 12, shape: "rounded", spacing: "comfort" }, terminalDefaultCwd: "D:\\projects\\AgentDeck" },
    });
  });

  test("defaults invalid terminal appearance settings", () => {
    expect(parseWorkspaceDocument({ ...validDocument, settings: { sharedContextEnabled: true, terminalAppearance: { font: "comic", shape: "soft", spacing: "wide" } } })).toEqual(validDocument);
  });

  test("rejects unknown workspace versions", () => {
    expect(parseWorkspaceDocument({ ...validDocument, version: 999 })).toBeNull();
  });

  test("rejects layout terminals without pane metadata", () => {
    expect(parseWorkspaceDocument({ ...validDocument, tabs: [{ ...tab, panes: {} }] })).toBeNull();
  });

  test("rejects pane metadata outside the layout", () => {
    expect(
      parseWorkspaceDocument({
        ...validDocument,
        tabs: [
          {
            ...tab,
            panes: {
              ...tab.panes,
              "term-2": { ...tab.panes["term-1"], id: "term-2" },
            },
          },
        ],
      }),
    ).toBeNull();
    expect(parseWorkspaceDocument({ ...validDocument, tabs: [{ ...tab, layout: null }] })).toBeNull();
  });

  test("rejects invalid terminal and tab ids", () => {
    expect(
      parseWorkspaceDocument({
        ...validDocument,
        tabs: [
          {
            ...tab,
            layout: { id: "bad/id", type: "terminal" },
            panes: {
              "bad/id": { ...tab.panes["term-1"], id: "bad/id" },
            },
          },
        ],
      }),
    ).toBeNull();
    expect(parseWorkspaceDocument({ ...validDocument, activeTabId: "bad/id" })).toBeNull();
    expect(parseWorkspaceDocument({ ...validDocument, tabs: [{ ...tab, id: "__proto__" }] })).toBeNull();
  });

  test("rejects duplicate ids", () => {
    expect(parseWorkspaceDocument({ ...validDocument, tabs: [tab, tab] })).toBeNull();
    expect(
      parseWorkspaceDocument({
        ...validDocument,
        activeTabId: "tab-1",
        tabs: [tab, { ...tab, id: "tab-2", title: "Second" }],
      }),
    ).toBeNull();
    expect(
      parseWorkspaceDocument({
        ...validDocument,
        tabs: [
          {
            ...tab,
            layout: {
              children: [
                { id: "term-1", type: "terminal" },
                { id: "term-1", type: "terminal" },
              ],
              direction: "row",
              id: "root",
              sizes: [0.5, 0.5],
              type: "split",
            },
          },
        ],
      }),
    ).toBeNull();
  });

  test("normalizes stale next indexes after import", () => {
    expect(parseWorkspaceDocument({ ...validDocument, nextTabIndex: 1, nextTerminalIndex: 1 })).toMatchObject({
      nextTabIndex: 2,
      nextTerminalIndex: 2,
    });
    expect(
      parseWorkspaceDocument({
        ...validDocument,
        activeTabId: "tab-12",
        tabs: [
          {
            ...tab,
            id: "tab-12",
            layout: { id: "term-20", type: "terminal" },
            panes: {
              "term-20": { ...tab.panes["term-1"], id: "term-20" },
            },
          },
        ],
      }),
    ).toMatchObject({ nextTabIndex: 13, nextTerminalIndex: 21 });
  });

  test("rejects excessively large workspaces", () => {
    expect(
      parseWorkspaceDocument({
        ...validDocument,
        activeTabId: "tab-1",
        tabs: Array.from({ length: 25 }, (_, index) => ({
          ...tab,
          id: `tab-${index + 1}`,
          layout: { id: `term-${index + 1}`, type: "terminal" },
          panes: {
            [`term-${index + 1}`]: { ...tab.panes["term-1"], id: `term-${index + 1}` },
          },
        })),
      }),
    ).toBeNull();
  });

  test("creates a sanitized workspace document", () => {
    expect(createWorkspaceDocument({ activeTabId: "missing", name: "  ", nextTabIndex: 2, nextTerminalIndex: 2, tabs: [{ ...tab, title: "" }] })).toEqual({
      ...validDocument,
      name: "Untitled Workspace",
      tabs: [{ ...tab, title: "Tab 1" }],
    });
  });
});
