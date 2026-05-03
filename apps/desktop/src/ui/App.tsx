import { type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { Memory, MemoryType, Note, Priority, Todo, TodoStatus, Workspace } from "@agentdeck/core";
import { getMcpBridge, getSharedStateBridge, getTerminalBridge, getWorkspaceBridge, type McpActionResult, type McpClient, type McpSetupStatus, type WorkspaceDoc, type WorkspaceDocContent } from "../terminal/bridge.js";
import { createWorkspaceDocument } from "../workspace/schema.js";
import { AgentDeckIcon, type AgentDeckIconName } from "./Icon.js";
import { TerminalEmulator } from "./TerminalEmulator.js";

type Page = "terminal" | "docs" | "todos" | "memory" | "integrations";
type McpUiAction = "copy" | "copy-global-instructions" | "install" | "install-global-instructions" | "install-repo-instructions" | "uninstall";
type MemoryPageTab = "notes" | "memory";
type SplitDirection = "row" | "column";
type TerminalSide = "left" | "right" | "top" | "bottom";
type SplitNode = TerminalNode | SplitGroup;

interface TerminalNode {
  type: "terminal";
  id: string;
}

interface SplitGroup {
  type: "split";
  id: string;
  direction: SplitDirection;
  sizes: number[];
  children: SplitNode[];
}

interface TerminalPane {
  id: string;
  title: string;
  detail: string;
  status: string;
  tone: "success" | "neutral" | "warn";
  command: string;
}

interface TerminalTab {
  id: string;
  layout: SplitNode | null;
  panes: Record<string, TerminalPane>;
  title: string;
}

interface ContextMenuState {
  terminalId: string;
  x: number;
  y: number;
}

interface MenuPosition {
  x: number;
  y: number;
}

interface RenameDialogState {
  id: string;
  kind: "tab" | "terminal";
  title: string;
  value: string;
}

const MIN_PANE_WIDTH = 220;
const MIN_PANE_HEIGHT = 140;
const MAX_PANE_TITLE_LENGTH = 80;

const navItems: Array<{ id: Page; label: string; icon: AgentDeckIconName }> = [
  { id: "terminal", label: "Terminal", icon: "terminal" },
  { id: "docs", label: "Docs", icon: "note" },
  { id: "todos", label: "Todos", icon: "task" },
  { id: "memory", label: "Memory", icon: "brain" },
];

const mcpClients: Array<{ id: McpClient; label: string; description: string; configFile: string }> = [
  {
    id: "opencode",
    label: "OpenCode",
    description: "Global local MCP entry in OpenCode config.",
    configFile: "~/.config/opencode/opencode.json",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    description: "User-scoped stdio MCP entry available across Claude Code projects.",
    configFile: "~/.claude.json",
  },
];

const initialTerminalPanes: Record<string, TerminalPane> = {
  "term-1": { id: "term-1", title: "OpenCode", detail: "agent shell · shared MCP armed", status: "running", tone: "success", command: "opencode ." },
  "term-2": { id: "term-2", title: "Dev server", detail: "Vite desktop preview", status: "idle", tone: "neutral", command: "pnpm --filter @agentdeck/desktop dev" },
  "term-3": { id: "term-3", title: "Tests", detail: "workspace verification", status: "exit 0", tone: "success", command: "pnpm -r test" },
  "term-4": { id: "term-4", title: "Scratch", detail: "permissioned local commands", status: "ready", tone: "warn", command: "git status --short" },
};

export const initialSplitLayout: SplitNode = {
  type: "split",
  id: "root",
  direction: "row",
  sizes: [0.5, 0.5],
  children: [
    { type: "terminal", id: "term-1" },
    {
      type: "split",
      id: "right-stack",
      direction: "column",
      sizes: [0.45, 0.55],
      children: [
        { type: "terminal", id: "term-2" },
        {
          type: "split",
          id: "bottom-row",
          direction: "row",
          sizes: [0.5, 0.5],
          children: [{ type: "terminal", id: "term-3" }, { type: "terminal", id: "term-4" }],
        },
      ],
    },
  ],
};

const initialTerminalTabs: TerminalTab[] = [
  {
    id: "tab-1",
    layout: initialSplitLayout,
    panes: initialTerminalPanes,
    title: "Main",
  },
];

export function App() {
  const [activePage, setActivePage] = useState<Page>("terminal");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renameDialog, setRenameDialog] = useState<RenameDialogState | null>(null);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [selectedTerminalIds, setSelectedTerminalIds] = useState<Set<string>>(new Set());
  const [mcpMessages, setMcpMessages] = useState<Record<McpClient, string>>({
    "claude-code": "Install AgentDeck MCP globally for Claude Code, then add instructions so it knows when to use shared context.",
    opencode: "Install AgentDeck MCP globally for OpenCode, then add instructions so it knows when to use shared context.",
  });
  const [mcpSetupStatus, setMcpSetupStatus] = useState<McpSetupStatus | null>(null);
  const [pendingMcpClients, setPendingMcpClients] = useState<Record<McpClient, boolean>>({
    "claude-code": false,
    opencode: false,
  });
  const [workspaceName, setWorkspaceName] = useState("AgentDeck Workspace");
  const [dismissedInstructionPrompts, setDismissedInstructionPrompts] = useState<Set<McpClient>>(new Set());
  const [instructionPromptClient, setInstructionPromptClient] = useState<McpClient | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const mcpStatusRequestId = useRef(0);
  const [terminalState, setTerminalState] = useState({
    activeTabId: "tab-1",
    nextTabIndex: 2,
    nextTerminalIndex: 5,
    tabs: initialTerminalTabs,
  });
  const activeTab = terminalState.tabs.find((tab) => tab.id === terminalState.activeTabId) ?? terminalState.tabs[0] ?? createTerminalTab("tab-1", 1, 1);

  useEffect(() => {
    void refreshMcpStatus();
    void bootstrapSharedWorkspace();
  }, []);

  useEffect(() => {
    if (!mcpSetupStatus) {
      return;
    }

    setDismissedInstructionPrompts((current) => {
      let changed = false;
      const next = new Set<McpClient>();
      for (const client of current) {
        const status = mcpSetupStatus[client];
        if (status?.mcpInstalled && !status.instructionsInstalled) {
          next.add(client);
        } else {
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [mcpSetupStatus]);

  function addTerminal(targetId: string | undefined, side: TerminalSide = "right") {
    addTerminalToSide(targetId ? [targetId] : [], side);
  }

  function addTerminalToSide(targetIds: string[], side: TerminalSide) {
    setTerminalState((currentState) => {
      const currentTab = getActiveTab(currentState.tabs, currentState.activeTabId);
      if (!currentTab || (currentTab.layout && !canInsertTerminalOnSide(currentTab.layout, targetIds))) {
        return currentState;
      }

      const terminalIndex = currentState.nextTerminalIndex;
      const terminalId = `term-${terminalIndex}`;
      const nextTab = {
        ...currentTab,
        layout: insertTerminalOnSide(currentTab.layout, targetIds, terminalId, side),
        panes: {
          ...currentTab.panes,
          [terminalId]: createTerminalPane(terminalId, terminalIndex),
        },
      };

      return {
        ...currentState,
        nextTerminalIndex: terminalIndex + 1,
        tabs: replaceTab(currentState.tabs, nextTab),
      };
    });
    clearTerminalSelection();
  }

  function removeTerminals(terminalIds: string[]) {
    const terminalIdSet = new Set(terminalIds);
    setTerminalState((currentState) => {
      const currentTab = getActiveTab(currentState.tabs, currentState.activeTabId);
      if (!currentTab) {
        return currentState;
      }
      const remainingPanes = Object.fromEntries(Object.entries(currentTab.panes).filter(([paneId]) => !terminalIdSet.has(paneId)));

      return {
        ...currentState,
        tabs: replaceTab(currentState.tabs, {
          ...currentTab,
          layout: terminalIds.reduce((layout, terminalId) => removeTerminalFromLayout(layout, terminalId), currentTab.layout),
          panes: remainingPanes,
        }),
      };
    });
    closeTerminalSessions(terminalIds);
    clearTerminalSelection();
  }

  function renameTerminal(terminalId: string) {
    const currentTitle = activeTab.panes[terminalId]?.title ?? terminalId;
    setContextMenu(null);
    setRenameDialog({ id: terminalId, kind: "terminal", title: "Rename terminal", value: currentTitle });
  }

  function addTab() {
    setTerminalState((currentState) => {
      const tabIndex = currentState.nextTabIndex;
      const terminalIndex = currentState.nextTerminalIndex;
      const tab = createTerminalTab(`tab-${tabIndex}`, tabIndex, terminalIndex);

      return {
        ...currentState,
        activeTabId: tab.id,
        nextTabIndex: tabIndex + 1,
        nextTerminalIndex: terminalIndex + 1,
        tabs: [...currentState.tabs, tab],
      };
    });
    clearTerminalSelection();
    setActivePage("terminal");
  }

  function closeTab(tabId: string) {
    const closingTab = terminalState.tabs.find((tab) => tab.id === tabId);
    if (closingTab) {
      closeTerminalSessions(Object.keys(closingTab.panes));
    }

    setTerminalState((currentState) => {
      if (!currentState.tabs.some((tab) => tab.id === tabId)) {
        return currentState;
      }

      const remainingTabs = currentState.tabs.filter((tab) => tab.id !== tabId);
      if (remainingTabs.length === 0) {
        const tab = createTerminalTab("tab-1", 1, currentState.nextTerminalIndex);
        return {
          ...currentState,
          activeTabId: tab.id,
          nextTabIndex: 2,
          nextTerminalIndex: currentState.nextTerminalIndex + 1,
          tabs: [tab],
        };
      }

      const closingIndex = currentState.tabs.findIndex((tab) => tab.id === tabId);
      const nextActiveTabId = currentState.activeTabId === tabId ? (remainingTabs[Math.min(closingIndex, remainingTabs.length - 1)]?.id ?? remainingTabs[0]?.id ?? currentState.activeTabId) : currentState.activeTabId;

      return {
        ...currentState,
        activeTabId: nextActiveTabId,
        tabs: remainingTabs,
      };
    });
    clearTerminalSelection();
  }

  function renameTab(tabId: string) {
    const currentTitle = terminalState.tabs.find((tab) => tab.id === tabId)?.title ?? tabId;
    setRenameDialog({ id: tabId, kind: "tab", title: "Rename tab", value: currentTitle });
  }

  function updateRenameValue(value: string) {
    setRenameDialog((currentDialog) => (currentDialog ? { ...currentDialog, value: value.slice(0, MAX_PANE_TITLE_LENGTH) } : currentDialog));
  }

  function submitRename() {
    if (!renameDialog) {
      return;
    }

    const nextTitle = renameDialog.value.trim().slice(0, MAX_PANE_TITLE_LENGTH);
    if (!nextTitle) {
      setRenameDialog(null);
      return;
    }

    if (renameDialog.kind === "tab") {
      const tabId = renameDialog.id;
      setTerminalState((currentState) => ({
        ...currentState,
        tabs: currentState.tabs.map((tab) => (tab.id === tabId ? { ...tab, title: nextTitle } : tab)),
      }));
    } else {
      const terminalId = renameDialog.id;
      setTerminalState((currentState) => ({
        ...currentState,
        tabs: currentState.tabs.map((tab) =>
          tab.id === currentState.activeTabId
            ? {
                ...tab,
                panes: {
                  ...tab.panes,
                  [terminalId]: {
                    ...(tab.panes[terminalId] ?? createTerminalPane(terminalId, currentState.nextTerminalIndex)),
                    title: nextTitle,
                  },
                },
              }
            : tab,
        ),
      }));
    }

    setRenameDialog(null);
  }

  function selectTab(tabId: string) {
    setTerminalState((currentState) => ({
      ...currentState,
      activeTabId: currentState.tabs.some((tab) => tab.id === tabId) ? tabId : currentState.activeTabId,
    }));
    clearTerminalSelection();
  }

  function clearTerminalSelection() {
    setContextMenu(null);
    setSelectedTerminalIds(new Set());
    setSelectionAnchorId(null);
  }

  function closeTerminalSessions(terminalIds: string[]) {
    const bridge = getTerminalBridge();
    for (const terminalId of terminalIds) {
      void bridge?.closeSession(terminalId);
    }
  }

  async function closeTerminalSessionsForTabs(tabs: TerminalTab[]) {
    const bridge = getTerminalBridge();
    await Promise.all(tabs.flatMap((tab) => Object.keys(tab.panes).map((terminalId) => bridge?.closeSession(terminalId) ?? Promise.resolve(false))));
  }

  async function saveWorkspace() {
    await getWorkspaceBridge()?.saveWorkspace(createWorkspaceDocument({ activeTabId: terminalState.activeTabId, name: workspaceName, nextTabIndex: terminalState.nextTabIndex, nextTerminalIndex: terminalState.nextTerminalIndex, tabs: terminalState.tabs }));
  }

  async function importWorkspace() {
    const document = await getWorkspaceBridge()?.importWorkspace();
    if (!document) {
      return;
    }

    await closeTerminalSessionsForTabs(terminalState.tabs);

    setWorkspaceName(document.name);
    setTerminalState({ activeTabId: document.activeTabId, nextTabIndex: document.nextTabIndex, nextTerminalIndex: document.nextTerminalIndex, tabs: document.tabs });
    clearTerminalSelection();
    setActivePage("terminal");
  }

  async function bootstrapSharedWorkspace() {
    const bridge = getSharedStateBridge();
    if (!bridge) {
      setWorkspaceLoading(false);
      setWorkspaceError("Shared state is available only in the Electron desktop app.");
      return;
    }

    setWorkspaceLoading(true);
    setWorkspaceError(null);
    try {
      setActiveWorkspace(await bridge.bootstrapWorkspace());
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Unable to load shared workspace.");
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function selectSharedWorkspaceRoot() {
    const bridge = getSharedStateBridge();
    if (!bridge) {
      setWorkspaceError("Shared state is available only in the Electron desktop app.");
      return;
    }

    setWorkspaceLoading(true);
    setWorkspaceError(null);
    try {
      const workspace = await bridge.selectWorkspaceRoot();
      if (workspace) {
        setActiveWorkspace(workspace);
      }
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Unable to select workspace root.");
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function refreshMcpStatus() {
    const bridge = getMcpBridge();
    if (!bridge) {
      return null;
    }

    try {
      const requestId = ++mcpStatusRequestId.current;
      const status = await bridge.getStatus();
      if (requestId !== mcpStatusRequestId.current) {
        return null;
      }

      setMcpSetupStatus(status);
      return status;
    } catch {
      return null;
    }
  }

  async function runMcpAction(client: McpClient, action: McpUiAction) {
    const bridge = getMcpBridge();
    if (!bridge) {
      setMcpMessages((messages) => ({ ...messages, [client]: "AgentDeck MCP installer is available only in the Electron desktop app." }));
      return;
    }

    setPendingMcpClients((clients) => ({ ...clients, [client]: true }));

    try {
      const result = await runMcpBridgeAction(bridge, client, action);
      if (action === "install-global-instructions" && result.ok) {
        setInstructionPromptClient(null);
      }

      const status = await refreshMcpStatus();
      const clientStatus = status?.[client];
      const needsInstructions = clientStatus ? !clientStatus.instructionsInstalled : false;
      const message = action === "install" && result.ok && needsInstructions ? `${formatMcpResult(result)} Instructions recommended: install AgentDeck instructions so this agent knows when to read shared docs, todos, notes, and memory.` : formatMcpResult(result);
      setMcpMessages((messages) => ({ ...messages, [client]: message }));
      if (action === "install" && result.ok && needsInstructions) {
        setInstructionPromptClient(client);
      }
    } catch (error) {
      setMcpMessages((messages) => ({ ...messages, [client]: error instanceof Error ? error.message : "MCP action failed." }));
    } finally {
      setPendingMcpClients((clients) => ({ ...clients, [client]: false }));
    }
  }

  function dismissInstructionPrompt(client: McpClient) {
    setDismissedInstructionPrompts((current) => new Set(current).add(client));
    setInstructionPromptClient(null);
  }

  function updateLayout(layout: SplitNode) {
    setTerminalState((currentState) => ({
      ...currentState,
      tabs: currentState.tabs.map((tab) => (tab.id === currentState.activeTabId ? { ...tab, layout } : tab)),
    }));
  }

  function selectTerminal(terminalId: string, rangeSelect: boolean) {
    if (!rangeSelect || !selectionAnchorId) {
      setSelectionAnchorId(terminalId);
      setSelectedTerminalIds(new Set([terminalId]));
      return;
    }

    setSelectedTerminalIds(new Set(getTerminalRange(activeTab.layout, selectionAnchorId, terminalId)));
  }

  function openTerminalMenu(terminalId: string, position: MenuPosition) {
    if (!selectedTerminalIds.has(terminalId)) {
      setSelectedTerminalIds(new Set([terminalId]));
    }

    setContextMenu({ terminalId, x: position.x, y: position.y });
  }

  function getContextTargets() {
    if (!contextMenu) {
      return [];
    }

    return selectedTerminalIds.has(contextMenu.terminalId) ? [...selectedTerminalIds] : [contextMenu.terminalId];
  }

  const contextTargets = getContextTargets();
  const canAddToContextTargets = canInsertTerminalOnSide(activeTab.layout, contextTargets);

  return (
    <main className="app-shell" aria-label="AgentDeck">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="sidebar__brand" aria-label="AgentDeck">
          <AgentDeckIcon name="sparkles" size={20} />
        </div>
        <nav className="sidebar__nav" aria-label="Workspace pages">
          {navItems.map((item) => (
            <button
              aria-label={item.label}
              aria-pressed={activePage === item.id}
              className="sidebar__button"
              key={item.id}
              onClick={() => setActivePage(item.id)}
              title={item.label}
              type="button"
            >
              <AgentDeckIcon name={item.icon} size={19} />
            </button>
          ))}
        </nav>
        <div className="sidebar__workspace-actions">
          <button aria-label="Save workspace" className="sidebar__button" onClick={saveWorkspace} title="Save workspace" type="button">
            <AgentDeckIcon name="database" size={18} />
          </button>
          <button aria-label="Import workspace" className="sidebar__button" onClick={importWorkspace} title="Import workspace" type="button">
            <AgentDeckIcon name="folder" size={18} />
          </button>
          <button aria-label="MCP Integrations" aria-pressed={activePage === "integrations"} className="sidebar__button" onClick={() => setActivePage("integrations")} title="MCP Integrations" type="button">
            <AgentDeckIcon name="settings" size={18} />
          </button>
        </div>
      </aside>

      <section className="workspace" aria-label="Workspace content">
        <section className="terminal-page" hidden={activePage !== "terminal"}>
          <TabStrip activeTabId={terminalState.activeTabId} onAddTab={addTab} onCloseTab={closeTab} onRenameTab={renameTab} onSelectTab={selectTab} tabs={terminalState.tabs} />
          <div className="terminal-tab-panels">
            {terminalState.tabs.map((tab) => {
              const isActiveTab = tab.id === terminalState.activeTabId;
              return (
                <TerminalWorkspace
                  contextMenu={isActiveTab ? contextMenu : null}
                  canAddToContextTargets={isActiveTab ? canAddToContextTargets : false}
                  contextTargets={isActiveTab ? contextTargets : []}
                  hidden={!isActiveTab}
                  key={tab.id}
                  layout={tab.layout}
                  onAddTerminal={addTerminal}
                  onAddTerminalToSide={addTerminalToSide}
                  onCloseContextMenu={() => setContextMenu(null)}
                  onLayoutChange={updateLayout}
                  onOpenTerminalMenu={openTerminalMenu}
                  onRenameTerminal={renameTerminal}
                  onRemoveTerminals={removeTerminals}
                  onSelectTerminal={selectTerminal}
                  panes={tab.panes}
                  selectedTerminalIds={isActiveTab ? selectedTerminalIds : new Set()}
                />
              );
            })}
          </div>
        </section>
        {activePage !== "terminal" ? <ResourcePage activeWorkspace={activeWorkspace} dismissedInstructionPrompts={dismissedInstructionPrompts} mcpMessages={mcpMessages} mcpSetupStatus={mcpSetupStatus} onDismissInstructionPrompt={dismissInstructionPrompt} onMcpAction={runMcpAction} onSelectWorkspaceRoot={selectSharedWorkspaceRoot} page={activePage} pendingMcpClients={pendingMcpClients} workspaceError={workspaceError} workspaceLoading={workspaceLoading} /> : null}
      </section>
      {instructionPromptClient ? <InstructionPrompt client={instructionPromptClient} onDismiss={() => dismissInstructionPrompt(instructionPromptClient)} onInstall={() => runMcpAction(instructionPromptClient, "install-global-instructions")} /> : null}
      {renameDialog ? <RenameDialog dialog={renameDialog} onCancel={() => setRenameDialog(null)} onChange={updateRenameValue} onSubmit={submitRename} /> : null}
    </main>
  );
}

async function runMcpBridgeAction(bridge: NonNullable<ReturnType<typeof getMcpBridge>>, client: McpClient, action: McpUiAction) {
  switch (action) {
    case "copy":
      return bridge.copyConfig(client);
    case "copy-global-instructions":
      return bridge.copyInstructions(client, "global");
    case "install":
      return bridge.install(client);
    case "install-global-instructions":
      return bridge.installInstructions(client, "global");
    case "install-repo-instructions":
      return bridge.installInstructions(client, "repo");
    case "uninstall":
      return bridge.uninstall(client);
  }
}

function formatMcpResult(result: McpActionResult): string {
  const details = [result.message];
  if (result.configPath) {
    details.push(`Config: ${result.configPath}`);
  }

  if (result.backupPath) {
    details.push(`Backup: ${result.backupPath}`);
  }

  return details.join(" ");
}

function RenameDialog({ dialog, onCancel, onChange, onSubmit }: { dialog: RenameDialogState; onCancel: () => void; onChange: (value: string) => void; onSubmit: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <div className="rename-dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <form aria-label={dialog.title} className="rename-dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={submitForm}>
        <label className="rename-dialog__label" htmlFor="rename-dialog-input">
          {dialog.title}
        </label>
        <input id="rename-dialog-input" maxLength={MAX_PANE_TITLE_LENGTH} onChange={(event) => onChange(event.target.value)} ref={inputRef} value={dialog.value} />
        <div className="rename-dialog__actions">
          <button onClick={onCancel} type="button">
            Cancel
          </button>
          <button type="submit">Save</button>
        </div>
      </form>
    </div>
  );
}

function TabStrip({ activeTabId, onAddTab, onCloseTab, onRenameTab, onSelectTab, tabs }: { activeTabId: string; onAddTab: () => void; onCloseTab: (tabId: string) => void; onRenameTab: (tabId: string) => void; onSelectTab: (tabId: string) => void; tabs: TerminalTab[] }) {
  return (
    <div className="tab-strip" role="tablist" aria-label="Terminal tabs">
      <div className="tab-strip__scroll">
        {tabs.map((tab) => {
          const terminalCount = Object.keys(tab.panes).length;
          return (
            <div className="tab-strip__tab-shell" key={tab.id}>
              <button
                aria-selected={tab.id === activeTabId}
                className="tab-strip__tab"
                onClick={() => onSelectTab(tab.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onRenameTab(tab.id);
                }}
                onDoubleClick={() => onRenameTab(tab.id)}
                role="tab"
                title={`${tab.title} terminal tab, ${terminalCount} terminal${terminalCount === 1 ? "" : "s"}`}
                type="button"
              >
                <span className="tab-strip__title">{tab.title}</span>
                <span className="tab-strip__count">{terminalCount}</span>
              </button>
              <button
                aria-label={`Close ${tab.title} tab`}
                className="tab-strip__close"
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tab.id);
                }}
                title={`Close ${tab.title} tab`}
                type="button"
              >
                x
              </button>
            </div>
          );
        })}
      </div>
      <button aria-label="New terminal tab" className="tab-strip__add" onClick={onAddTab} title="New terminal tab" type="button">
        <AgentDeckIcon name="add" size={15} />
      </button>
    </div>
  );
}

function TerminalWorkspace({
  canAddToContextTargets,
  contextMenu,
  contextTargets,
  hidden,
  layout,
  onAddTerminal,
  onAddTerminalToSide,
  onCloseContextMenu,
  onLayoutChange,
  onOpenTerminalMenu,
  onRenameTerminal,
  onRemoveTerminals,
  onSelectTerminal,
  panes,
  selectedTerminalIds,
}: {
  canAddToContextTargets: boolean;
  contextMenu: ContextMenuState | null;
  contextTargets: string[];
  hidden: boolean;
  layout: SplitNode | null;
  onAddTerminal: (targetId: string | undefined, side?: TerminalSide) => void;
  onAddTerminalToSide: (targetIds: string[], side: TerminalSide) => void;
  onCloseContextMenu: () => void;
  onLayoutChange: (layout: SplitNode) => void;
  onOpenTerminalMenu: (terminalId: string, position: MenuPosition) => void;
  onRenameTerminal: (terminalId: string) => void;
  onRemoveTerminals: (terminalIds: string[]) => void;
  onSelectTerminal: (terminalId: string, additive: boolean) => void;
  panes: Record<string, TerminalPane>;
  selectedTerminalIds: Set<string>;
}) {
  if (!layout) {
    return (
      <section className="terminal-workspace terminal-workspace--empty" aria-label="Workspace panes" hidden={hidden}>
        <button className="empty-terminal-action" onClick={() => onAddTerminal(undefined)} type="button">
          <AgentDeckIcon name="add" size={17} />
          Add terminal
        </button>
      </section>
    );
  }

  return (
    <section aria-label="Workspace panes" aria-multiselectable="true" className="terminal-workspace" hidden={hidden} onClick={onCloseContextMenu} role="listbox">
      <SplitView
        node={layout}
        onOpenTerminalMenu={onOpenTerminalMenu}
        onSelectTerminal={onSelectTerminal}
        panes={panes}
        rootLayout={layout}
        selectedTerminalIds={selectedTerminalIds}
        onLayoutChange={onLayoutChange}
      />
      {contextMenu ? <TerminalContextMenu canAdd={canAddToContextTargets} contextMenu={contextMenu} onAddTerminalToSide={onAddTerminalToSide} onClose={() => onRemoveTerminals(contextTargets)} onDismiss={onCloseContextMenu} onRename={onRenameTerminal} targets={contextTargets} /> : null}
    </section>
  );
}

function SplitView({
  node,
  onLayoutChange,
  onOpenTerminalMenu,
  onSelectTerminal,
  panes,
  rootLayout,
  selectedTerminalIds,
}: {
  node: SplitNode;
  onLayoutChange: (layout: SplitNode) => void;
  onOpenTerminalMenu: (terminalId: string, position: MenuPosition) => void;
  onSelectTerminal: (terminalId: string, additive: boolean) => void;
  panes: Record<string, TerminalPane>;
  rootLayout: SplitNode;
  selectedTerminalIds: Set<string>;
}) {
  if (node.type === "terminal") {
    return <TerminalPaneView isSelected={selectedTerminalIds.has(node.id)} onOpenMenu={onOpenTerminalMenu} onSelect={onSelectTerminal} pane={panes[node.id]} />;
  }

  return (
    <div className={`split split--${node.direction}`} data-split-id={node.id}>
      {node.children.map((child, index) => (
        <div className="split__child" key={getNodeKey(child)} style={getChildStyle(node, child, index)}>
          <SplitView node={child} onLayoutChange={onLayoutChange} onOpenTerminalMenu={onOpenTerminalMenu} onSelectTerminal={onSelectTerminal} panes={panes} rootLayout={rootLayout} selectedTerminalIds={selectedTerminalIds} />
          {index < node.children.length - 1 ? <ResizeSash direction={node.direction} group={node} index={index} onLayoutChange={onLayoutChange} rootLayout={rootLayout} /> : null}
        </div>
      ))}
    </div>
  );
}

function ResizeSash({
  direction,
  group,
  index,
  onLayoutChange,
  rootLayout,
}: {
  direction: SplitDirection;
  group: SplitGroup;
  index: number;
  onLayoutChange: (layout: SplitNode) => void;
  rootLayout: SplitNode;
}) {
  function getResizeMetrics(target: HTMLElement) {
    const parentElement = target.parentElement?.parentElement;
    if (!parentElement) {
      return undefined;
    }

    const totalPixels = direction === "row" ? parentElement.getBoundingClientRect().width : parentElement.getBoundingClientRect().height;
    return {
      minAfterPixels: getSubtreeMinPixels(group.children[index + 1], direction === "row" ? "width" : "height"),
      minBeforePixels: getSubtreeMinPixels(group.children[index], direction === "row" ? "width" : "height"),
      totalPixels,
    };
  }

  function applyResize(deltaPixels: number, metrics: { totalPixels: number; minBeforePixels: number; minAfterPixels: number }) {
    onLayoutChange(resizeSplitGroup(rootLayout, group.id, index, deltaPixels, metrics.totalPixels, metrics.minBeforePixels, metrics.minAfterPixels));
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    const metrics = getResizeMetrics(event.currentTarget);
    if (!metrics) {
      return;
    }
    const resizeMetrics = metrics;

    const startPosition = direction === "row" ? event.clientX : event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);

    function resize(pointerEvent: PointerEvent) {
      const currentPosition = direction === "row" ? pointerEvent.clientX : pointerEvent.clientY;
      applyResize(currentPosition - startPosition, resizeMetrics);
    }

    function stopResize() {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stopResize);
    }

    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stopResize, { once: true });
  }

  function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    const metrics = getResizeMetrics(event.currentTarget);
    if (!metrics) {
      return;
    }

    const keyDeltas: Record<string, number> = direction === "row" ? { ArrowLeft: -32, ArrowRight: 32, End: metrics.totalPixels, Home: -metrics.totalPixels } : { ArrowDown: 32, ArrowUp: -32, End: metrics.totalPixels, Home: -metrics.totalPixels };
    const delta = keyDeltas[event.key];
    if (delta === undefined) {
      return;
    }

    event.preventDefault();
    applyResize(delta, metrics);
  }

  return (
    <div
      aria-label={`Resize ${group.id} panes`}
      aria-orientation={direction === "row" ? "vertical" : "horizontal"}
      className={`resize-sash resize-sash--${direction}`}
      onKeyDown={resizeWithKeyboard}
      onPointerDown={startResize}
      role="separator"
      tabIndex={0}
    />
  );
}

function TerminalPaneView({ isSelected, onOpenMenu, onSelect, pane }: { isSelected: boolean; onOpenMenu: (terminalId: string, position: MenuPosition) => void; onSelect: (terminalId: string, additive: boolean) => void; pane: TerminalPane | undefined }) {
  if (!pane) {
    return null;
  }
  const terminalPane = pane;

  function openMouseMenu(event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    onOpenMenu(terminalPane.id, { x: event.clientX, y: event.clientY });
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      onSelect(terminalPane.id, event.shiftKey);
      return;
    }

    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) {
      return;
    }

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    onOpenMenu(terminalPane.id, { x: rect.left + 16, y: rect.top + 32 });
  }

  return (
    <article
      aria-label={`${pane.title} terminal`}
      aria-selected={isSelected}
      className="terminal-pane"
      role="option"
      tabIndex={0}
      onClick={(event) => onSelect(terminalPane.id, event.shiftKey)}
      onContextMenu={openMouseMenu}
      onKeyDown={handleKeyDown}
    >
      <header className="terminal-pane__header">
        <span className="terminal-pane__title">
          <AgentDeckIcon name="terminal" size={14} />
          {pane.title}
        </span>
        <span className="terminal-pane__meta">
          <span className={`terminal-pane__status terminal-pane__status--${pane.tone}`}>{pane.status}</span>
        </span>
      </header>
      <div className="terminal-pane__body">
        <TerminalEmulator paneId={terminalPane.id} />
      </div>
    </article>
  );
}

function TerminalContextMenu({
  canAdd,
  contextMenu,
  onAddTerminalToSide,
  onClose,
  onDismiss,
  onRename,
  targets,
}: {
  canAdd: boolean;
  contextMenu: ContextMenuState;
  onAddTerminalToSide: (targetIds: string[], side: TerminalSide) => void;
  onClose: () => void;
  onDismiss: () => void;
  onRename: (terminalId: string) => void;
  targets: string[];
}) {
  const label = targets.length > 1 ? `${targets.length} terminals` : "terminal";
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, []);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    onDismiss();
  }

  return (
    <div className="terminal-context-menu" onKeyDown={handleKeyDown} ref={menuRef} role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
      <span className="terminal-context-menu__label">{canAdd ? `Add terminal beside ${label}` : "Select one attached pane group"}</span>
      <button disabled={!canAdd} onClick={() => onAddTerminalToSide(targets, "top")} role="menuitem" type="button">
        Top
      </button>
      <button disabled={!canAdd} onClick={() => onAddTerminalToSide(targets, "bottom")} role="menuitem" type="button">
        Bottom
      </button>
      <button disabled={!canAdd} onClick={() => onAddTerminalToSide(targets, "right")} role="menuitem" type="button">
        Right
      </button>
      <button disabled={!canAdd} onClick={() => onAddTerminalToSide(targets, "left")} role="menuitem" type="button">
        Left
      </button>
      <button disabled={targets.length !== 1} onClick={() => onRename(contextMenu.terminalId)} role="menuitem" type="button">
        Rename
      </button>
      <button className="terminal-context-menu__danger" onClick={onClose} role="menuitem" type="button">
        Close selected
      </button>
    </div>
  );
}

export function resizeSplitGroup(layout: SplitNode, groupId: string, index: number, deltaPixels: number, totalPixels: number, minBeforePixels: number, minAfterPixels = minBeforePixels): SplitNode {
  if (layout.type === "terminal") {
    return layout;
  }

  if (layout.id === groupId) {
    return {
      ...layout,
      sizes: resizeAdjacentSizes(layout.sizes, index, deltaPixels, totalPixels, minBeforePixels, minAfterPixels),
    };
  }

  return {
    ...layout,
    children: layout.children.map((child) => resizeSplitGroup(child, groupId, index, deltaPixels, totalPixels, minBeforePixels, minAfterPixels)),
  };
}

export function resizeAdjacentSizes(sizes: number[], index: number, deltaPixels: number, totalPixels: number, minBeforePixels: number, minAfterPixels = minBeforePixels) {
  const before = sizes[index];
  const after = sizes[index + 1];
  if (before === undefined || after === undefined || totalPixels <= 0) {
    return sizes;
  }

  const combined = before + after;
  let minBeforeRatio = minBeforePixels / totalPixels;
  let minAfterRatio = minAfterPixels / totalPixels;
  if (minBeforeRatio + minAfterRatio > combined) {
    const scale = combined / (minBeforeRatio + minAfterRatio);
    minBeforeRatio *= scale;
    minAfterRatio *= scale;
  }

  const deltaRatio = deltaPixels / totalPixels;
  const nextBefore = Math.min(Math.max(before + deltaRatio, minBeforeRatio), combined - minAfterRatio);
  const nextAfter = combined - nextBefore;

  return sizes.map((size, sizeIndex) => {
    if (sizeIndex === index) {
      return nextBefore;
    }

    if (sizeIndex === index + 1) {
      return nextAfter;
    }

    return size;
  });
}

export function insertTerminal(layout: SplitNode | null, targetId: string | undefined, terminalId: string, direction: SplitDirection): SplitNode {
  return insertTerminalOnSide(layout, targetId ? [targetId] : [], terminalId, direction === "row" ? "right" : "bottom");
}

export function insertTerminalOnSide(layout: SplitNode | null, targetIds: string[], terminalId: string, side: TerminalSide): SplitNode {
  const terminal: TerminalNode = { type: "terminal", id: terminalId };
  const uniqueTargetIds = [...new Set(targetIds)];
  const direction = getSideDirection(side);
  const insertBeforeSelection = side === "left" || side === "top";

  if (!layout) {
    return terminal;
  }

  if (uniqueTargetIds.length === 0 || !canInsertTerminalOnSide(layout, uniqueTargetIds)) {
    return layout;
  }

  if (layout.type === "terminal") {
    if (!uniqueTargetIds.includes(layout.id)) {
      return layout;
    }

    return createSplitGroup(`split-${layout.id}-${terminalId}`, direction, insertBeforeSelection ? [terminal, layout] : [layout, terminal]);
  }

  const directTargetIndexes = layout.children
    .map((child, index) => (child.type === "terminal" && uniqueTargetIds.includes(child.id) ? index : -1))
    .filter((index) => index >= 0);

  if (directTargetIndexes.length > 0 && areContiguous(directTargetIndexes)) {
    const firstIndex = directTargetIndexes[0] ?? 0;
    const lastIndex = directTargetIndexes[directTargetIndexes.length - 1] ?? firstIndex;
    const selectedSize = sumRange(layout.sizes, firstIndex, lastIndex, 1 / layout.children.length);

    if (layout.direction !== direction) {
      const selectedChildren = layout.children.slice(firstIndex, lastIndex + 1);
      const selectedSizes = layout.sizes.slice(firstIndex, lastIndex + 1);
      const selectedGroup = selectedChildren.length === 1 ? selectedChildren[0] : createSplitGroup(`selection-${terminalId}`, layout.direction, selectedChildren, normalizeSelectionSizes(selectedSizes));
      if (!selectedGroup) {
        return layout;
      }

      const replacementGroup = createSplitGroup(`split-${terminalId}`, direction, insertBeforeSelection ? [terminal, selectedGroup] : [selectedGroup, terminal]);

      return {
        ...layout,
        children: [...layout.children.slice(0, firstIndex), replacementGroup, ...layout.children.slice(lastIndex + 1)],
        sizes: [...layout.sizes.slice(0, firstIndex), selectedSize, ...layout.sizes.slice(lastIndex + 1)],
      };
    }

    const nextChildren = [...layout.children];
    const nextSizes = [...layout.sizes];
    const newTerminalSize = selectedSize / (directTargetIndexes.length + 1);
    const shrinkScale = selectedSize > 0 ? (selectedSize - newTerminalSize) / selectedSize : 1;
    for (const selectedIndex of directTargetIndexes) {
      nextSizes[selectedIndex] = (nextSizes[selectedIndex] ?? 1 / layout.children.length) * shrinkScale;
    }

    const insertionIndex = insertBeforeSelection ? firstIndex : lastIndex + 1;
    return {
      ...layout,
      children: insertAt(nextChildren, insertionIndex, terminal),
      sizes: insertAt(nextSizes, insertionIndex, newTerminalSize),
    };
  }

  const childWithTargetIndex = layout.children.findIndex((child) => containsAnyTerminal(child, uniqueTargetIds));
  if (childWithTargetIndex < 0) {
    return layout;
  }

  return {
    ...layout,
    children: layout.children.map((child, childIndex) => (childIndex === childWithTargetIndex ? insertTerminalOnSide(child, uniqueTargetIds, terminalId, side) : child)),
  };
}

export function canInsertTerminalOnSide(layout: SplitNode | null, targetIds: string[]): boolean {
  const uniqueTargetIds = [...new Set(targetIds)];
  if (!layout || uniqueTargetIds.length === 0) {
    return false;
  }

  if (uniqueTargetIds.length === 1) {
    return containsAnyTerminal(layout, uniqueTargetIds);
  }

  return hasDirectContiguousTargets(layout, uniqueTargetIds);
}

export function getTerminalRange(layout: SplitNode | null, anchorId: string, terminalId: string) {
  const terminalOrder = getTerminalOrder(layout);
  const anchorIndex = terminalOrder.indexOf(anchorId);
  const terminalIndex = terminalOrder.indexOf(terminalId);
  if (anchorIndex < 0 || terminalIndex < 0) {
    return [terminalId];
  }

  const startIndex = Math.min(anchorIndex, terminalIndex);
  const endIndex = Math.max(anchorIndex, terminalIndex);
  return terminalOrder.slice(startIndex, endIndex + 1);
}

export function removeTerminalFromLayout(layout: SplitNode | null, terminalId: string): SplitNode | null {
  if (!layout) {
    return null;
  }

  if (layout.type === "terminal") {
    return layout.id === terminalId ? null : layout;
  }

  const nextEntries = layout.children.map((child, index) => ({
    child: removeTerminalFromLayout(child, terminalId),
    size: layout.sizes[index] ?? 1 / layout.children.length,
  }));

  nextEntries.forEach((entry, index) => {
    if (entry.child) {
      return;
    }

    const previousIndex = findRetainedSiblingIndex(nextEntries, index, -1);
    const nextIndex = findRetainedSiblingIndex(nextEntries, index, 1);
    const targetIndex = previousIndex >= 0 ? previousIndex : nextIndex;
    const targetEntry = nextEntries[targetIndex];
    if (targetEntry) {
      targetEntry.size += entry.size;
    }
  });

  const retainedEntries = nextEntries.filter((entry): entry is { child: SplitNode; size: number } => Boolean(entry.child));
  const retainedChildren = retainedEntries.map((entry) => entry.child);
  const retainedSizes = retainedEntries.map((entry) => entry.size);

  if (retainedChildren.length === 0) {
    return null;
  }

  if (retainedChildren.length === 1) {
    return retainedChildren[0] ?? null;
  }

  return {
    ...layout,
    children: retainedChildren,
    sizes: retainedSizes,
  };
}

function createTerminalPane(id: string, index: number): TerminalPane {
  return {
    command: "shell",
    detail: "new local terminal",
    id,
    status: "ready",
    title: `Terminal ${index}`,
    tone: "neutral",
  };
}

function createTerminalTab(id: string, tabIndex: number, terminalIndex: number): TerminalTab {
  const terminalId = `term-${terminalIndex}`;
  return {
    id,
    layout: { type: "terminal", id: terminalId },
    panes: {
      [terminalId]: createTerminalPane(terminalId, terminalIndex),
    },
    title: `Tab ${tabIndex}`,
  };
}

function getActiveTab(tabs: TerminalTab[], activeTabId: string) {
  return tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
}

function replaceTab(tabs: TerminalTab[], nextTab: TerminalTab) {
  return tabs.map((tab) => (tab.id === nextTab.id ? nextTab : tab));
}

function createSplitGroup(id: string, direction: SplitDirection, children: SplitNode[], sizes = children.map(() => 1 / children.length)): SplitGroup {
  return {
    children,
    direction,
    id,
    sizes,
    type: "split",
  };
}

function insertAt<T>(items: T[], index: number, item: T) {
  return [...items.slice(0, index), item, ...items.slice(index)];
}

function getSideDirection(side: TerminalSide): SplitDirection {
  return side === "left" || side === "right" ? "row" : "column";
}

function areContiguous(indexes: number[]) {
  if (indexes.length === 0) {
    return false;
  }

  const sortedIndexes = [...indexes].sort((left, right) => left - right);
  return sortedIndexes.every((index, sortedIndex) => sortedIndex === 0 || index === (sortedIndexes[sortedIndex - 1] ?? index) + 1);
}

function sumRange(sizes: number[], firstIndex: number, lastIndex: number, fallbackSize: number) {
  let totalSize = 0;
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    totalSize += sizes[index] ?? fallbackSize;
  }

  return totalSize;
}

function normalizeSelectionSizes(sizes: number[]) {
  const totalSize = sizes.reduce((sum, size) => sum + size, 0);
  if (totalSize <= 0) {
    return sizes.map(() => 1 / sizes.length);
  }

  return sizes.map((size) => size / totalSize);
}

function containsAnyTerminal(node: SplitNode, terminalIds: string[]): boolean {
  if (node.type === "terminal") {
    return terminalIds.includes(node.id);
  }

  return node.children.some((child) => containsAnyTerminal(child, terminalIds));
}

function hasDirectContiguousTargets(node: SplitNode, terminalIds: string[]): boolean {
  if (node.type === "terminal") {
    return false;
  }

  const directTargetIndexes = node.children
    .map((child, index) => (child.type === "terminal" && terminalIds.includes(child.id) ? index : -1))
    .filter((index) => index >= 0);

  if (directTargetIndexes.length > 0) {
    return directTargetIndexes.length === terminalIds.length && areContiguous(directTargetIndexes);
  }

  return node.children.some((child) => hasDirectContiguousTargets(child, terminalIds));
}

function getTerminalOrder(layout: SplitNode | null): string[] {
  if (!layout) {
    return [];
  }

  if (layout.type === "terminal") {
    return [layout.id];
  }

  return layout.children.flatMap((child) => getTerminalOrder(child));
}

function findRetainedSiblingIndex(entries: Array<{ child: SplitNode | null; size: number }>, startIndex: number, direction: -1 | 1) {
  for (let index = startIndex + direction; index >= 0 && index < entries.length; index += direction) {
    if (entries[index]?.child) {
      return index;
    }
  }

  return -1;
}

function getChildStyle(parent: SplitGroup, child: SplitNode, index: number): CSSProperties {
  const basis = `${(parent.sizes[index] ?? 1 / parent.children.length) * 100}%`;

  if (parent.direction === "row") {
    return {
      flexBasis: basis,
      minWidth: getSubtreeMinPixels(child, "width"),
    };
  }

  return {
    flexBasis: basis,
    minHeight: getSubtreeMinPixels(child, "height"),
  };
}

function getSubtreeMinPixels(node: SplitNode | undefined, dimension: "width" | "height"): number {
  if (!node) {
    return dimension === "width" ? MIN_PANE_WIDTH : MIN_PANE_HEIGHT;
  }

  if (node.type === "terminal") {
    return dimension === "width" ? MIN_PANE_WIDTH : MIN_PANE_HEIGHT;
  }

  if ((node.direction === "row" && dimension === "width") || (node.direction === "column" && dimension === "height")) {
    return node.children.reduce((minimum, child) => minimum + getSubtreeMinPixels(child, dimension), 0);
  }

  return Math.max(...node.children.map((child) => getSubtreeMinPixels(child, dimension)));
}

function ResourcePage({ activeWorkspace, dismissedInstructionPrompts, mcpMessages, mcpSetupStatus, onDismissInstructionPrompt, onMcpAction, onSelectWorkspaceRoot, page, pendingMcpClients, workspaceError, workspaceLoading }: { activeWorkspace: Workspace | null; dismissedInstructionPrompts: Set<McpClient>; mcpMessages: Record<McpClient, string>; mcpSetupStatus: McpSetupStatus | null; onDismissInstructionPrompt: (client: McpClient) => void; onMcpAction: (client: McpClient, action: McpUiAction) => void; onSelectWorkspaceRoot: () => void; page: Exclude<Page, "terminal">; pendingMcpClients: Record<McpClient, boolean>; workspaceError: string | null; workspaceLoading: boolean }) {
  if (page === "docs") {
    return (
      <section className="resource-page" aria-label="Docs">
        <ResourceHeader eyebrow="Knowledge Base" icon="note" label="Docs" description="Project documents that agents can read without crowding the terminal surface." />
        <WorkspaceGate activeWorkspace={activeWorkspace} onSelectWorkspaceRoot={onSelectWorkspaceRoot} workspaceError={workspaceError} workspaceLoading={workspaceLoading}>
          {(workspace) => <DocsPanel workspace={workspace} />}
        </WorkspaceGate>
      </section>
    );
  }

  if (page === "todos") {
    return (
      <section className="resource-page" aria-label="Todos">
        <ResourceHeader eyebrow="Execution Queue" icon="task" label="Todos" description="Shared project work that stays available to humans and local agents." />
        <WorkspaceGate activeWorkspace={activeWorkspace} onSelectWorkspaceRoot={onSelectWorkspaceRoot} workspaceError={workspaceError} workspaceLoading={workspaceLoading}>
          {(workspace) => <TodosPanel workspace={workspace} />}
        </WorkspaceGate>
      </section>
    );
  }

  if (page === "integrations") {
    return (
      <section className="resource-page" aria-label="MCP Integrations">
        <ResourceHeader eyebrow="Agent Wiring" icon="server" label="MCP Integrations" description="Install AgentDeck's local stdio MCP globally, then add instructions so agents know when to use shared context tools." />
        <InstructionNoticeList dismissedInstructionPrompts={dismissedInstructionPrompts} mcpSetupStatus={mcpSetupStatus} onDismiss={onDismissInstructionPrompt} onInstall={(client) => onMcpAction(client, "install-global-instructions")} pendingMcpClients={pendingMcpClients} />
        <div className="integration-grid">
          {mcpClients.map((client) => (
            <article className="integration-card" key={client.id}>
              <div className="integration-card__header">
                <span className="integration-card__icon"><AgentDeckIcon name="server" size={18} /></span>
                <div>
                  <span>{client.configFile}</span>
                  <h2>{client.label}</h2>
                  <p>{client.description}</p>
                </div>
              </div>
              <div className="integration-card__actions">
                <button disabled={pendingMcpClients[client.id]} onClick={() => onMcpAction(client.id, "install")} type="button">
                  Install Global MCP
                </button>
                <button disabled={pendingMcpClients[client.id]} onClick={() => onMcpAction(client.id, "install")} type="button">
                  Repair Global MCP
                </button>
                <button disabled={pendingMcpClients[client.id]} onClick={() => onMcpAction(client.id, "uninstall")} type="button">
                  Uninstall
                </button>
                <button disabled={pendingMcpClients[client.id]} onClick={() => onMcpAction(client.id, "copy")} type="button">
                  Copy Config
                </button>
                <button disabled={pendingMcpClients[client.id]} onClick={() => onMcpAction(client.id, "install-global-instructions")} type="button">
                  Install Global Instructions
                </button>
                <button disabled={pendingMcpClients[client.id]} onClick={() => onMcpAction(client.id, "install-repo-instructions")} type="button">
                  Generate Repo Instructions
                </button>
                <button disabled={pendingMcpClients[client.id]} onClick={() => onMcpAction(client.id, "copy-global-instructions")} type="button">
                  Copy Instructions
                </button>
              </div>
              <p className="integration-card__status" role="status">
                {mcpMessages[client.id]}
              </p>
            </article>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="resource-page" aria-label="Memory">
      <ResourceHeader eyebrow="Shared Recall" icon="brain" label="Memory" description="Durable workspace facts and decisions retrieved through MCP." />
      <WorkspaceGate activeWorkspace={activeWorkspace} onSelectWorkspaceRoot={onSelectWorkspaceRoot} workspaceError={workspaceError} workspaceLoading={workspaceLoading}>
        {(workspace) => <NotesMemoryPanel workspace={workspace} />}
      </WorkspaceGate>
    </section>
  );
}

function WorkspaceGate({ activeWorkspace, children, onSelectWorkspaceRoot, workspaceError, workspaceLoading }: { activeWorkspace: Workspace | null; children: (workspace: Workspace) => ReactNode; onSelectWorkspaceRoot: () => void; workspaceError: string | null; workspaceLoading: boolean }) {
  if (workspaceLoading) {
    return <p className="resource-empty">Loading shared workspace...</p>;
  }

  if (!activeWorkspace) {
    return (
      <article className="resource-card resource-empty-card">
        <div>
          <h2>Open a project folder</h2>
          <p>Choose a project folder to create or reuse an AgentDeck workspace before syncing docs, todos, notes, and memory with MCP agents.</p>
          {workspaceError ? <p className="resource-error">{workspaceError}</p> : null}
        </div>
        <div className="integration-card__actions">
          <button onClick={onSelectWorkspaceRoot} type="button">Open Project Folder</button>
        </div>
      </article>
    );
  }

  return children(activeWorkspace);
}

function TodosPanel({ workspace }: { workspace: Workspace }) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [error, setError] = useState<string | null>(null);

  async function loadTodos() {
    const bridge = getSharedStateBridge();
    if (!bridge) {
      setError("Shared state is available only in the Electron desktop app.");
      return;
    }

    try {
      setTodos(await bridge.listTodos(workspace.id));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load todos.");
    }
  }

  useEffect(() => {
    void loadTodos();
  }, [workspace.id]);

  async function submitTodo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) {
      return;
    }

    try {
      const bridge = getSharedStateBridge();
      const todo = await bridge?.createTodo({ description: description.trim(), priority, title: nextTitle, workspaceId: workspace.id });
      if (todo) {
        setTodos((currentTodos) => [...currentTodos, todo]);
      }
      setTitle("");
      setDescription("");
      setPriority("medium");
      setIsAddDialogOpen(false);
      setError(null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create todo.");
    }
  }

  async function updateTodoStatus(todoId: string, status: TodoStatus) {
    try {
      const updated = await getSharedStateBridge()?.updateTodo(todoId, { status });
      if (updated) {
        setTodos((currentTodos) => currentTodos.map((todo) => (todo.id === todoId ? updated : todo)));
      }
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update todo.");
    }
  }

  async function deleteTodo(todoId: string) {
    try {
      await getSharedStateBridge()?.deleteTodo(todoId);
      setTodos((currentTodos) => currentTodos.filter((todo) => todo.id !== todoId));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete todo.");
    }
  }

  return (
    <>
      <ResourceWorkspaceMeta workspace={workspace} />
      <div className="resource-toolbar">
        <button onClick={() => setIsAddDialogOpen(true)} type="button">Add Todo</button>
      </div>
      {isAddDialogOpen ? (
        <ResourceDialog title="Add Todo" onClose={() => setIsAddDialogOpen(false)}>
          <form className="resource-form" onSubmit={submitTodo}>
            <input aria-label="Todo title" autoFocus onChange={(event) => setTitle(event.target.value)} placeholder="Todo title" value={title} />
            <textarea aria-label="Todo description" onChange={(event) => setDescription(event.target.value)} placeholder="Description" value={description} />
            <select aria-label="Todo priority" onChange={(event) => setPriority(event.target.value as Priority)} value={priority}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <div className="resource-dialog__actions">
              <button onClick={() => setIsAddDialogOpen(false)} type="button">Cancel</button>
              <button type="submit">Add Todo</button>
            </div>
          </form>
        </ResourceDialog>
      ) : null}
      {error ? <p className="resource-error">{error}</p> : null}
      {todos.length === 0 ? <p className="resource-empty">No shared todos yet.</p> : null}
      <ol className="todo-list">
        {todos.map((todo, index) => (
          <li key={todo.id}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>{todo.title}</strong>
              <small>{todo.status.replaceAll("_", " ")} / {todo.priority}{todo.description ? ` / ${todo.description}` : ""}</small>
              <div className="integration-card__actions">
                <button onClick={() => updateTodoStatus(todo.id, "in_progress")} type="button">Start</button>
                <button onClick={() => updateTodoStatus(todo.id, "done")} type="button">Complete</button>
                <button onClick={() => deleteTodo(todo.id)} type="button">Delete</button>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

function NotesMemoryPanel({ workspace }: { workspace: Workspace }) {
  const [activeTab, setActiveTab] = useState<MemoryPageTab>("notes");
  return (
    <>
      <ResourceWorkspaceMeta workspace={workspace} />
      <div className="resource-tabs" role="tablist" aria-label="Memory page tabs">
        <button aria-selected={activeTab === "notes"} onClick={() => setActiveTab("notes")} role="tab" type="button">Notes</button>
        <button aria-selected={activeTab === "memory"} onClick={() => setActiveTab("memory")} role="tab" type="button">Memory entries</button>
      </div>
      {activeTab === "notes" ? <NotesPanel workspace={workspace} /> : <MemoryPanel workspace={workspace} />}
    </>
  );
}

function NotesPanel({ workspace }: { workspace: Workspace }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [isNoteDialogOpen, setIsNoteDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function loadNotes() {
    try {
      setNotes((await getSharedStateBridge()?.listNotes(workspace.id)) ?? []);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load notes.");
    }
  }

  useEffect(() => {
    void loadNotes();
  }, [workspace.id]);

  async function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) {
      return;
    }

    try {
      if (editingNoteId) {
        const updated = await getSharedStateBridge()?.updateNote(editingNoteId, { body, title: nextTitle });
        if (updated) {
          setNotes((currentNotes) => currentNotes.map((note) => (note.id === editingNoteId ? updated : note)));
        }
      } else {
        const note = await getSharedStateBridge()?.createNote({ body, source: "human", title: nextTitle, workspaceId: workspace.id });
        if (note) {
          setNotes((currentNotes) => [note, ...currentNotes]);
        }
      }
      setEditingNoteId(null);
      setTitle("");
      setBody("");
      setIsNoteDialogOpen(false);
      setError(null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to save note.");
    }
  }

  async function deleteNote(noteId: string) {
    try {
      await getSharedStateBridge()?.deleteNote(noteId);
      setNotes((currentNotes) => currentNotes.filter((note) => note.id !== noteId));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete note.");
    }
  }

  return (
    <>
      <div className="resource-toolbar">
        <button onClick={() => { setEditingNoteId(null); setTitle(""); setBody(""); setIsNoteDialogOpen(true); }} type="button">Add Note</button>
      </div>
      {isNoteDialogOpen ? (
        <ResourceDialog title={editingNoteId ? "Edit Note" : "Add Note"} onClose={() => setIsNoteDialogOpen(false)}>
          <form className="resource-form" onSubmit={submitNote}>
            <input aria-label="Note title" autoFocus onChange={(event) => setTitle(event.target.value)} placeholder="Note title" value={title} />
            <textarea aria-label="Note body" onChange={(event) => setBody(event.target.value)} placeholder="Markdown note body" value={body} />
            <div className="resource-dialog__actions">
              <button onClick={() => setIsNoteDialogOpen(false)} type="button">Cancel</button>
              <button type="submit">{editingNoteId ? "Save Note" : "Add Note"}</button>
            </div>
          </form>
        </ResourceDialog>
      ) : null}
      {error ? <p className="resource-error">{error}</p> : null}
      {notes.length === 0 ? <p className="resource-empty">No shared notes yet.</p> : null}
      <div className="memory-list">
        {notes.map((note) => (
          <article className="memory-card" key={note.id}>
            <span className="memory-card__icon"><AgentDeckIcon name="note" size={16} /></span>
            <div>
              <span>{note.source}</span>
              <p><strong>{note.title}</strong></p>
              <p>{note.body || "No body yet."}</p>
              <div className="integration-card__actions">
                <button onClick={() => { setEditingNoteId(note.id); setTitle(note.title); setBody(note.body); setIsNoteDialogOpen(true); }} type="button">Edit</button>
                <button onClick={() => deleteNote(note.id)} type="button">Delete Note</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function MemoryPanel({ workspace }: { workspace: Workspace }) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [isMemoryDialogOpen, setIsMemoryDialogOpen] = useState(false);
  const [content, setContent] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<MemoryType>("fact");
  const [error, setError] = useState<string | null>(null);

  async function loadMemories() {
    try {
      setMemories((await getSharedStateBridge()?.listMemories(workspace.id)) ?? []);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load memories.");
    }
  }

  useEffect(() => {
    void loadMemories();
  }, [workspace.id]);

  async function submitMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextContent = content.trim();
    if (!nextContent) {
      return;
    }

    try {
      const memory = await getSharedStateBridge()?.storeMemory({ content: nextContent, source: "human", type, workspaceId: workspace.id });
      if (memory) {
        setMemories((currentMemories) => [memory, ...currentMemories]);
      }
      setContent("");
      setType("fact");
      setIsMemoryDialogOpen(false);
      setError(null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to store memory.");
    }
  }

  async function searchMemories(nextQuery: string) {
    setQuery(nextQuery);
    try {
      setMemories(nextQuery.trim() ? ((await getSharedStateBridge()?.searchMemory(workspace.id, nextQuery.trim())) ?? []) : ((await getSharedStateBridge()?.listMemories(workspace.id)) ?? []));
      setError(null);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Unable to search memory.");
    }
  }

  return (
    <>
      <div className="resource-toolbar">
        <button onClick={() => setIsMemoryDialogOpen(true)} type="button">Store Memory</button>
        <input aria-label="Memory search" className="resource-search" onChange={(event) => void searchMemories(event.target.value)} placeholder="Search memory" value={query} />
      </div>
      {isMemoryDialogOpen ? (
        <ResourceDialog title="Store Memory" onClose={() => setIsMemoryDialogOpen(false)}>
          <form className="resource-form" onSubmit={submitMemory}>
            <textarea aria-label="Memory content" autoFocus onChange={(event) => setContent(event.target.value)} placeholder="Durable fact, decision, convention, risk, setup note, or handoff" value={content} />
            <select aria-label="Memory type" onChange={(event) => setType(event.target.value as MemoryType)} value={type}>
              <option value="fact">Fact</option>
              <option value="decision">Decision</option>
              <option value="convention">Convention</option>
              <option value="handoff">Handoff</option>
              <option value="setup">Setup</option>
              <option value="risk">Risk</option>
            </select>
            <div className="resource-dialog__actions">
              <button onClick={() => setIsMemoryDialogOpen(false)} type="button">Cancel</button>
              <button type="submit">Store Memory</button>
            </div>
          </form>
        </ResourceDialog>
      ) : null}
      {error ? <p className="resource-error">{error}</p> : null}
      {memories.length === 0 ? <p className="resource-empty">No memory entries yet.</p> : null}
      <div className="memory-list">
        {memories.map((memory) => (
          <article className="memory-card" key={memory.id}>
            <span className="memory-card__icon"><AgentDeckIcon name="brain" size={16} /></span>
            <div>
              <span>{memory.type}</span>
              <p>{memory.content}</p>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function DocsPanel({ workspace }: { workspace: Workspace }) {
  const [docs, setDocs] = useState<WorkspaceDoc[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<WorkspaceDocContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadDocs() {
      try {
        setDocs((await getSharedStateBridge()?.listDocs(workspace.id)) ?? []);
        setError(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to list docs.");
      }
    }

    void loadDocs();
  }, [workspace.id]);

  async function openDoc(path: string) {
    try {
      const doc = await getSharedStateBridge()?.readDoc(workspace.id, path);
      if (doc) {
        setSelectedDoc(doc);
      }
      setError(null);
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Unable to read doc.");
    }
  }

  return (
    <>
      <ResourceWorkspaceMeta workspace={workspace} />
      {error ? <p className="resource-error">{error}</p> : null}
      {docs.length === 0 ? <p className="resource-empty">No docs found under {workspace.rootPath}/docs.</p> : null}
      <div className={`docs-layout${selectedDoc ? " docs-layout--preview" : ""}`}>
        <div className="resource-grid docs-grid">
          {docs.map((doc) => (
            <button className="resource-card resource-card--button" aria-pressed={selectedDoc?.path === doc.path} key={doc.path} onClick={() => openDoc(doc.path)} type="button">
              <div className="resource-card__topline">
                <span>{doc.path}</span>
                <span className="resource-card__icon"><AgentDeckIcon name="note" size={15} /></span>
              </div>
              <div>
                <h2>{getDocTitle(doc.path)}</h2>
                <p>{formatBytes(doc.size)} / {new Date(doc.updatedAt).toLocaleDateString()}</p>
              </div>
            </button>
          ))}
        </div>
        <aside className="doc-preview-panel" aria-label="Doc preview" aria-hidden={!selectedDoc}>
          {selectedDoc ? (
            <article className="doc-preview">
              <div className="doc-preview__header">
                <span>{selectedDoc.path}</span>
                <button aria-label="Close doc preview" onClick={() => setSelectedDoc(null)} type="button">Close</button>
              </div>
              <pre>{selectedDoc.text}</pre>
            </article>
          ) : null}
        </aside>
      </div>
    </>
  );
}

function ResourceWorkspaceMeta({ workspace }: { workspace: Workspace }) {
  return <p className="resource-workspace-meta">{workspace.name} / {workspace.rootPath}</p>;
}

function getDocTitle(path: string) {
  return path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || path;
}

function formatBytes(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  return `${Math.round(size / 1024)} KB`;
}

function InstructionNoticeList({ dismissedInstructionPrompts, mcpSetupStatus, onDismiss, onInstall, pendingMcpClients }: { dismissedInstructionPrompts: Set<McpClient>; mcpSetupStatus: McpSetupStatus | null; onDismiss: (client: McpClient) => void; onInstall: (client: McpClient) => void; pendingMcpClients: Record<McpClient, boolean> }) {
  const clientsNeedingInstructions = mcpClients.filter((client) => {
    const status = mcpSetupStatus?.[client.id];
    return status?.mcpInstalled && !status.instructionsInstalled && !dismissedInstructionPrompts.has(client.id);
  });

  if (clientsNeedingInstructions.length === 0) {
    return null;
  }

  return (
    <div className="integration-notices" aria-label="MCP setup notifications">
      {clientsNeedingInstructions.map((client) => (
        <article className="integration-notice" key={client.id}>
          <div>
            <span>Instructions recommended</span>
            <p>{client.label} can connect to AgentDeck MCP, but instructions are missing. Install them so it automatically checks shared docs, todos, notes, and memory.</p>
          </div>
          <div className="integration-card__actions">
            <button disabled={pendingMcpClients[client.id]} onClick={() => onInstall(client.id)} type="button">Install Instructions</button>
            <button disabled={pendingMcpClients[client.id]} onClick={() => onDismiss(client.id)} type="button">Not Now</button>
          </div>
        </article>
      ))}
    </div>
  );
}

function InstructionPrompt({ client, onDismiss, onInstall }: { client: McpClient; onDismiss: () => void; onInstall: () => void }) {
  const label = getMcpClientLabel(client);
  const installButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    installButtonRef.current?.focus();
  }, []);

  return (
    <div className="instruction-dialog-backdrop" role="presentation">
      <section aria-label="AgentDeck instruction recommendation" aria-modal="true" className="instruction-dialog" role="dialog">
        <div className="instruction-dialog__header">
          <div className="instruction-dialog__icon" aria-hidden="true">
            <AgentDeckIcon name="server" size={20} />
          </div>
          <div>
            <span className="instruction-dialog__eyebrow">Instructions Recommended</span>
            <h2 className="instruction-dialog__title">AgentDeck MCP is installed</h2>
          </div>
        </div>
        <div className="instruction-dialog__body">
          <p className="instruction-dialog__copy">{label} can now connect to AgentDeck, but it needs instructions to know when to use shared docs, todos, notes, and memory automatically.</p>
          <p className="instruction-dialog__copy">Install instructions unless you plan to manually tell the agent to use AgentDeck MCP each session.</p>
        </div>
        <div className="instruction-dialog__actions">
          <button className="instruction-dialog__button instruction-dialog__button--secondary" onClick={onDismiss} type="button">Not Now</button>
          <button className="instruction-dialog__button instruction-dialog__button--primary" onClick={onInstall} ref={installButtonRef} type="button">Install Instructions</button>
        </div>
      </section>
    </div>
  );
}

function getMcpClientLabel(client: McpClient) {
  return mcpClients.find((item) => item.id === client)?.label ?? client;
}

function ResourceDialog({ children, onClose, title }: { children: ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="resource-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section aria-label={title} aria-modal="true" className="resource-dialog" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="resource-dialog__header">
          <div>
            <span>New Entry</span>
            <h2>{title}</h2>
          </div>
          <button aria-label={`Close ${title}`} onClick={onClose} type="button">Close</button>
        </div>
        {children}
      </section>
    </div>
  );
}

function ResourceHeader({ description, eyebrow, icon, label }: { description: string; eyebrow: string; icon: AgentDeckIconName; label: string }) {
  return (
    <header className="resource-header">
      <div className="resource-header__orb" aria-hidden="true" />
      <div className="resource-header__icon">
        <AgentDeckIcon name={icon} size={20} />
      </div>
      <div>
        <p className="resource-header__eyebrow">{eyebrow}</p>
        <span>{label}</span>
        <p>{description}</p>
      </div>
    </header>
  );
}

function getNodeKey(node: SplitNode) {
  return node.type === "terminal" ? node.id : node.id;
}
