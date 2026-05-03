import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { getTerminalBridge, getWorkspaceBridge } from "../terminal/bridge.js";
import { createWorkspaceDocument } from "../workspace/schema.js";
import { AgentDeckIcon, type AgentDeckIconName } from "./Icon.js";
import { TerminalEmulator } from "./TerminalEmulator.js";

type Page = "terminal" | "docs" | "todos" | "memory";
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

const MIN_PANE_WIDTH = 220;
const MIN_PANE_HEIGHT = 140;
const MAX_PANE_TITLE_LENGTH = 80;

const navItems: Array<{ id: Page; label: string; icon: AgentDeckIconName }> = [
  { id: "terminal", label: "Terminal", icon: "terminal" },
  { id: "docs", label: "Docs", icon: "note" },
  { id: "todos", label: "Todos", icon: "task" },
  { id: "memory", label: "Memory", icon: "brain" },
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

const docs = [
  { title: "Product requirements", path: "docs/PRD.md", summary: "Local-first workspace scope, agent surfaces, and V1 boundaries." },
  { title: "MCP contract", path: "docs/MCP_CONTRACT.md", summary: "Shared tools and resources exposed to coding agents over stdio." },
  { title: "Architecture", path: "docs/ARCHITECTURE.md", summary: "Desktop shell, shared state package, and MCP server responsibilities." },
];

const todos = [
  "Wire MCP tool contract tests",
  "Create OpenCode launch profile",
  "Design saved pane layout schema",
  "Add Qdrant adapter boundary",
];

const memories = [
  { label: "Convention", text: "Shared memory is durable context, not raw logs." },
  { label: "Decision", text: "Use stdio MCP first; HTTP transport is deferred." },
  { label: "Risk", text: "Terminal execution needs explicit permission boundaries." },
];

export function App() {
  const [activePage, setActivePage] = useState<Page>("terminal");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [selectedTerminalIds, setSelectedTerminalIds] = useState<Set<string>>(new Set());
  const [workspaceName, setWorkspaceName] = useState("AgentDeck Workspace");
  const [terminalState, setTerminalState] = useState({
    activeTabId: "tab-1",
    nextTabIndex: 2,
    nextTerminalIndex: 5,
    tabs: initialTerminalTabs,
  });
  const activeTab = terminalState.tabs.find((tab) => tab.id === terminalState.activeTabId) ?? terminalState.tabs[0] ?? createTerminalTab("tab-1", 1, 1);

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
    const nextTitle = window.prompt("Rename terminal", currentTitle)?.trim().slice(0, MAX_PANE_TITLE_LENGTH);
    if (!nextTitle) {
      setContextMenu(null);
      return;
    }

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
    setContextMenu(null);
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
    const nextTitle = window.prompt("Rename tab", currentTitle)?.trim().slice(0, MAX_PANE_TITLE_LENGTH);
    if (!nextTitle) {
      return;
    }

    setTerminalState((currentState) => ({
      ...currentState,
      tabs: currentState.tabs.map((tab) => (tab.id === tabId ? { ...tab, title: nextTitle } : tab)),
    }));
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
          <button aria-label="Export workspace" className="sidebar__button" onClick={saveWorkspace} title="Export workspace" type="button">
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
        {activePage !== "terminal" ? <ResourcePage page={activePage} /> : null}
      </section>
    </main>
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

function ResourcePage({ page }: { page: Exclude<Page, "terminal"> }) {
  if (page === "docs") {
    return (
      <section className="resource-page" aria-label="Docs">
        <ResourceHeader icon="note" label="Docs" description="Project documents that agents can read without crowding the terminal surface." />
        <div className="resource-grid">
          {docs.map((doc) => (
            <article className="resource-card" key={doc.path}>
              <span>{doc.path}</span>
              <h2>{doc.title}</h2>
              <p>{doc.summary}</p>
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (page === "todos") {
    return (
      <section className="resource-page" aria-label="Todos">
        <ResourceHeader icon="task" label="Todos" description="Shared project work that stays available to humans and local agents." />
        <ol className="todo-list">
          {todos.map((todo, index) => (
            <li key={todo}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {todo}
            </li>
          ))}
        </ol>
      </section>
    );
  }

  return (
    <section className="resource-page" aria-label="Memory">
      <ResourceHeader icon="brain" label="Memory" description="Durable workspace facts and decisions retrieved through MCP." />
      <div className="memory-list">
        {memories.map((memory) => (
          <article className="memory-card" key={memory.text}>
            <span>{memory.label}</span>
            <p>{memory.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ResourceHeader({ description, icon, label }: { description: string; icon: AgentDeckIconName; label: string }) {
  return (
    <header className="resource-header">
      <span>
        <AgentDeckIcon name={icon} size={16} />
        {label}
      </span>
      <p>{description}</p>
    </header>
  );
}

function getNodeKey(node: SplitNode) {
  return node.type === "terminal" ? node.id : node.id;
}
