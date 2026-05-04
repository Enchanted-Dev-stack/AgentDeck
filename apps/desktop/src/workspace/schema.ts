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
  activeTabId: string;
  name: string;
  nextTabIndex: number;
  nextTerminalIndex: number;
  settings: WorkspaceSettings;
  tabs: WorkspaceTab[];
  version: 3;
}

export interface WorkspaceSettings {
  sharedContextEnabled: boolean;
  terminalAppearance: WorkspaceTerminalAppearance;
}

export interface WorkspaceTerminalAppearance {
  borders: boolean;
  dividers: boolean;
  font: WorkspaceTerminalFont;
  shape: WorkspaceTerminalShape;
  spacing: WorkspaceTerminalSpacing;
}

export type WorkspaceTerminalFont = "jetbrains" | "cascadia" | "consolas" | "system";
export type WorkspaceTerminalShape = "rounded" | "boxy";
export type WorkspaceTerminalSpacing = "compact" | "comfort" | "roomy";

export interface LegacyWorkspaceDocument {
  layout: WorkspaceSplitNode | null;
  name: string;
  nextTerminalIndex: number;
  panes: Record<string, WorkspaceTerminalPane>;
  version: 1;
}

export interface WorkspaceTab {
  id: string;
  layout: WorkspaceSplitNode | null;
  panes: Record<string, WorkspaceTerminalPane>;
  title: string;
}

export interface WorkspaceDocumentInput {
  activeTabId: string;
  name: string;
  nextTabIndex: number;
  nextTerminalIndex: number;
  settings?: Partial<WorkspaceSettings>;
  tabs: WorkspaceTab[];
}

const DEFAULT_TERMINAL_APPEARANCE: WorkspaceTerminalAppearance = { borders: true, dividers: true, font: "jetbrains", shape: "rounded", spacing: "comfort" };
const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = { sharedContextEnabled: true, terminalAppearance: DEFAULT_TERMINAL_APPEARANCE };

const MAX_WORKSPACE_ID_LENGTH = 80;
const MAX_WORKSPACE_TABS = 24;
const MAX_WORKSPACE_TERMINALS = 128;
const RESERVED_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function createWorkspaceDocument(input: WorkspaceDocumentInput): WorkspaceDocument {
  const tabs = input.tabs.map((tab, index) => ({
    ...tab,
    title: tab.title.trim() || `Tab ${index + 1}`,
  }));
  const activeTabId = tabs.some((tab) => tab.id === input.activeTabId) ? input.activeTabId : (tabs[0]?.id ?? "tab-1");

  return {
    activeTabId,
    name: input.name.trim() || "Untitled Workspace",
    nextTabIndex: Math.max(1, Math.floor(input.nextTabIndex), getHighestGeneratedIndex(tabs.map((tab) => tab.id), "tab-") + 1),
    nextTerminalIndex: Math.max(1, Math.floor(input.nextTerminalIndex), getHighestGeneratedIndex(tabs.flatMap((tab) => Object.keys(tab.panes)), "term-") + 1),
    settings: parseWorkspaceSettings(input.settings),
    tabs,
    version: 3,
  };
}

export function parseWorkspaceDocument(payload: unknown): WorkspaceDocument | null {
  if (!isObject(payload)) {
    return null;
  }

  if (payload.version === 1) {
    return parseLegacyWorkspaceDocument(payload);
  }

  if ((payload.version !== 2 && payload.version !== 3) || typeof payload.name !== "string" || !isValidWorkspaceId(payload.activeTabId) || typeof payload.nextTabIndex !== "number" || !Number.isInteger(payload.nextTabIndex) || typeof payload.nextTerminalIndex !== "number" || !Number.isInteger(payload.nextTerminalIndex) || !Array.isArray(payload.tabs) || payload.tabs.length === 0 || payload.tabs.length > MAX_WORKSPACE_TABS) {
    return null;
  }

  const tabIds = new Set<string>();
  const terminalIds = new Set<string>();
  const tabs = payload.tabs.map((tabPayload) => parseWorkspaceTab(tabPayload));
  if (tabs.some((tab) => tab === null)) {
    return null;
  }

  for (const tab of tabs) {
    if (!tab || tabIds.has(tab.id)) {
      return null;
    }

    tabIds.add(tab.id);
    for (const terminalId of Object.keys(tab.panes)) {
      if (terminalIds.has(terminalId)) {
        return null;
      }

      terminalIds.add(terminalId);
    }
  }

  if (!tabIds.has(payload.activeTabId) || terminalIds.size > MAX_WORKSPACE_TERMINALS) {
    return null;
  }

  return createWorkspaceDocument({
    activeTabId: payload.activeTabId,
    name: payload.name,
    nextTabIndex: payload.nextTabIndex,
    nextTerminalIndex: payload.nextTerminalIndex,
    settings: payload.version === 3 ? parseWorkspaceSettings(payload.settings) : DEFAULT_WORKSPACE_SETTINGS,
    tabs: tabs as WorkspaceTab[],
  });
}

function parseLegacyWorkspaceDocument(payload: Record<string, unknown>): WorkspaceDocument | null {
  if (typeof payload.name !== "string" || typeof payload.nextTerminalIndex !== "number" || !Number.isInteger(payload.nextTerminalIndex) || !isObject(payload.panes)) {
    return null;
  }

  const nextTerminalIndex = payload.nextTerminalIndex;
  const tab = parseWorkspaceTab({ id: "tab-1", layout: payload.layout, panes: payload.panes, title: "Main" });
  if (!tab) {
    return null;
  }

  return createWorkspaceDocument({
    activeTabId: "tab-1",
    name: payload.name,
    nextTabIndex: 2,
    nextTerminalIndex,
    settings: DEFAULT_WORKSPACE_SETTINGS,
    tabs: [tab],
  });
}

function parseWorkspaceSettings(payload: unknown): WorkspaceSettings {
  if (!isObject(payload)) {
    return DEFAULT_WORKSPACE_SETTINGS;
  }

  return {
    sharedContextEnabled: typeof payload.sharedContextEnabled === "boolean" ? payload.sharedContextEnabled : DEFAULT_WORKSPACE_SETTINGS.sharedContextEnabled,
    terminalAppearance: parseTerminalAppearance(payload.terminalAppearance),
  };
}

function parseTerminalAppearance(payload: unknown): WorkspaceTerminalAppearance {
  if (!isObject(payload)) {
    return DEFAULT_TERMINAL_APPEARANCE;
  }

  return {
    borders: typeof payload.borders === "boolean" ? payload.borders : DEFAULT_TERMINAL_APPEARANCE.borders,
    dividers: typeof payload.dividers === "boolean" ? payload.dividers : DEFAULT_TERMINAL_APPEARANCE.dividers,
    font: payload.font === "jetbrains" || payload.font === "cascadia" || payload.font === "consolas" || payload.font === "system" ? payload.font : DEFAULT_TERMINAL_APPEARANCE.font,
    shape: payload.shape === "boxy" || payload.shape === "rounded" ? payload.shape : DEFAULT_TERMINAL_APPEARANCE.shape,
    spacing: payload.spacing === "compact" || payload.spacing === "comfort" || payload.spacing === "roomy" ? payload.spacing : DEFAULT_TERMINAL_APPEARANCE.spacing,
  };
}

function parseWorkspaceTab(payload: unknown): WorkspaceTab | null {
  if (!isObject(payload) || !isValidWorkspaceId(payload.id) || typeof payload.title !== "string" || !isObject(payload.panes)) {
    return null;
  }

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

  return {
    id: payload.id,
    layout,
    panes,
    title: payload.title.trim() || payload.id,
  };
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

function getHighestGeneratedIndex(ids: string[], prefix: string) {
  return ids.reduce((highest, id) => {
    if (!id.startsWith(prefix)) {
      return highest;
    }

    const index = Number(id.slice(prefix.length));
    return Number.isInteger(index) && index > highest ? index : highest;
  }, 0);
}
