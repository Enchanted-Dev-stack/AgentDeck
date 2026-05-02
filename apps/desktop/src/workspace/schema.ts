export type WorkspaceSplitDirection = "row" | "column";
export type WorkspacePaneTone = "success" | "neutral" | "warn";
export type WorkspaceSplitNode = WorkspaceTerminalNode | WorkspaceSplitGroup;

export interface WorkspaceTerminalNode {
  id: string;
  type: "terminal";
}

export interface WorkspaceSplitGroup {
  children: WorkspaceSplitNode[];
  direction: WorkspaceSplitDirection;
  id: string;
  sizes: number[];
  type: "split";
}

export interface WorkspaceTerminalPane {
  command: string;
  detail: string;
  id: string;
  status: string;
  title: string;
  tone: WorkspacePaneTone;
}

export interface WorkspaceDocument {
  layout: WorkspaceSplitNode | null;
  name: string;
  nextTerminalIndex: number;
  panes: Record<string, WorkspaceTerminalPane>;
  version: 1;
}

export interface WorkspaceDocumentInput {
  layout: WorkspaceSplitNode | null;
  name: string;
  nextTerminalIndex: number;
  panes: Record<string, WorkspaceTerminalPane>;
}

const MAX_WORKSPACE_ID_LENGTH = 80;
const RESERVED_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function createWorkspaceDocument(input: WorkspaceDocumentInput): WorkspaceDocument {
  return {
    layout: input.layout,
    name: input.name.trim() || "Untitled Workspace",
    nextTerminalIndex: Math.max(1, Math.floor(input.nextTerminalIndex)),
    panes: input.panes,
    version: 1,
  };
}

export function parseWorkspaceDocument(payload: unknown): WorkspaceDocument | null {
  if (!isObject(payload) || payload.version !== 1 || typeof payload.name !== "string" || typeof payload.nextTerminalIndex !== "number" || !Number.isInteger(payload.nextTerminalIndex) || !isObject(payload.panes)) {
    return null;
  }

  const nextTerminalIndex = payload.nextTerminalIndex;
  const panes = parsePanes(payload.panes);
  if (!panes) {
    return null;
  }

  const terminalIds = new Set<string>();
  const layout = parseLayout(payload.layout, terminalIds);
  if (payload.layout !== null && !layout) {
    return null;
  }

  for (const terminalId of terminalIds) {
    if (!panes[terminalId]) {
      return null;
    }
  }
  if (Object.keys(panes).some((paneId) => !terminalIds.has(paneId)) || (layout === null && Object.keys(panes).length > 0)) {
    return null;
  }

  return createWorkspaceDocument({
    layout,
    name: payload.name,
    nextTerminalIndex,
    panes,
  });
}

function parsePanes(payload: Record<string, unknown>) {
  const panes: Record<string, WorkspaceTerminalPane> = {};
  for (const [paneId, panePayload] of Object.entries(payload)) {
    if (!isValidWorkspaceId(paneId) || !isObject(panePayload) || panePayload.id !== paneId || typeof panePayload.title !== "string" || typeof panePayload.detail !== "string" || typeof panePayload.status !== "string" || typeof panePayload.command !== "string" || !isPaneTone(panePayload.tone)) {
      return null;
    }

    panes[paneId] = {
      command: panePayload.command,
      detail: panePayload.detail,
      id: paneId,
      status: panePayload.status,
      title: panePayload.title.trim() || paneId,
      tone: panePayload.tone,
    };
  }

  return panes;
}

function parseLayout(payload: unknown, terminalIds: Set<string>): WorkspaceSplitNode | null {
  if (payload === null) {
    return null;
  }

  if (!isObject(payload) || !isValidWorkspaceId(payload.id)) {
    return null;
  }

  if (payload.type === "terminal") {
    if (terminalIds.has(payload.id)) {
      return null;
    }

    terminalIds.add(payload.id);
    return { id: payload.id, type: "terminal" };
  }

  if (payload.type !== "split" || !isSplitDirection(payload.direction) || !Array.isArray(payload.children) || !Array.isArray(payload.sizes) || payload.children.length === 0 || payload.children.length !== payload.sizes.length || payload.sizes.some((size) => typeof size !== "number" || !Number.isFinite(size) || size <= 0)) {
    return null;
  }

  const children = payload.children.map((child) => parseLayout(child, terminalIds));
  if (children.some((child) => child === null)) {
    return null;
  }

  return {
    children: children as WorkspaceSplitNode[],
    direction: payload.direction,
    id: payload.id,
    sizes: payload.sizes,
    type: "split",
  };
}

function isObject(payload: unknown): payload is Record<string, unknown> {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload);
}

function isPaneTone(payload: unknown): payload is WorkspacePaneTone {
  return payload === "success" || payload === "neutral" || payload === "warn";
}

function isSplitDirection(payload: unknown): payload is WorkspaceSplitDirection {
  return payload === "row" || payload === "column";
}

function isValidWorkspaceId(payload: unknown): payload is string {
  return typeof payload === "string" && payload.length > 0 && payload.length <= MAX_WORKSPACE_ID_LENGTH && /^[a-zA-Z0-9_-]+$/.test(payload) && !RESERVED_OBJECT_KEYS.has(payload);
}
