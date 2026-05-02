import { describe, expect, test } from "vitest";
import { createWorkspaceDocument, parseWorkspaceDocument, type WorkspaceDocument } from "./schema.js";

const validDocument: WorkspaceDocument = {
  layout: {
    children: [{ id: "term-1", type: "terminal" }],
    direction: "row",
    id: "root",
    sizes: [1],
    type: "split",
  },
  name: "BridgeMind",
  nextTerminalIndex: 2,
  panes: {
    "term-1": {
      command: "shell",
      detail: "restored shell",
      id: "term-1",
      status: "ready",
      title: "OpenCode",
      tone: "neutral",
    },
  },
  version: 1,
};

describe("workspace schema", () => {
  test("parses a valid workspace document", () => {
    expect(parseWorkspaceDocument(validDocument)).toEqual(validDocument);
  });

  test("rejects unknown workspace versions", () => {
    expect(parseWorkspaceDocument({ ...validDocument, version: 999 })).toBeNull();
  });

  test("rejects layout terminals without pane metadata", () => {
    expect(parseWorkspaceDocument({ ...validDocument, panes: {} })).toBeNull();
  });

  test("rejects pane metadata outside the layout", () => {
    expect(
      parseWorkspaceDocument({
        ...validDocument,
        panes: {
          ...validDocument.panes,
          "term-2": { ...validDocument.panes["term-1"], id: "term-2" },
        },
      }),
    ).toBeNull();
    expect(parseWorkspaceDocument({ ...validDocument, layout: null })).toBeNull();
  });

  test("rejects invalid terminal ids", () => {
    expect(
      parseWorkspaceDocument({
        ...validDocument,
        layout: { id: "bad/id", type: "terminal" },
        panes: {
          "bad/id": { ...validDocument.panes["term-1"], id: "bad/id" },
        },
      }),
    ).toBeNull();
    expect(
      parseWorkspaceDocument({
        ...validDocument,
        layout: { id: "__proto__", type: "terminal" },
        panes: {
          __proto__: { ...validDocument.panes["term-1"], id: "__proto__" },
        },
      }),
    ).toBeNull();
  });

  test("rejects duplicate terminal ids in a layout", () => {
    expect(
      parseWorkspaceDocument({
        ...validDocument,
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
      }),
    ).toBeNull();
  });

  test("creates a sanitized workspace document", () => {
    expect(createWorkspaceDocument({ layout: validDocument.layout, name: "  ", nextTerminalIndex: 2, panes: validDocument.panes })).toEqual({
      ...validDocument,
      name: "Untitled Workspace",
    });
  });
});
