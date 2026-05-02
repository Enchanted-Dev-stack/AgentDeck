import { AgentDeckIcon } from "./Icon.js";
import { useState } from "react";

const workspaces = [
  { name: "AgentDeck", path: "D:/projects/AgentDeck", status: "LIVE", panes: "04", todos: "07" },
  { name: "OpenCode Lab", path: "~/labs/opencode", status: "IDLE", panes: "03", todos: "02" },
  { name: "Docs Maintainer", path: "~/oss/docs", status: "SYNC", panes: "02", todos: "11" },
];

const initialPanes = [
  { id: "TERM-01", title: "OpenCode", detail: "agent shell · shared MCP armed", status: "RUNNING", statusTone: "success", kind: "terminal" },
  { id: "TERM-02", title: "Dev Server", detail: "corepack pnpm dev", status: "IDLE", statusTone: "neutral", kind: "terminal" },
  { id: "TERM-03", title: "Tests", detail: "vitest watch", status: "EXIT 0", statusTone: "success", kind: "terminal" },
  { id: "DOC-04", title: "Workspace Notes", detail: "AGENTS.md · shared instructions", status: "PINNED", statusTone: "neutral", kind: "note" },
];

const todos = [
  "Wire MCP tool contract tests",
  "Create OpenCode launch profile",
  "Design saved pane layout schema",
  "Add Qdrant adapter boundary",
];

const memories = [
  { label: "CONVENTION", text: "Shared memory is durable context, not raw logs." },
  { label: "DECISION", text: "Use stdio MCP first; HTTP transport is deferred." },
  { label: "RISK", text: "Terminal execution needs explicit permission boundaries." },
];

export function App() {
  const [panes, setPanes] = useState(initialPanes);
  const [draggedPaneId, setDraggedPaneId] = useState<string | null>(null);

  function movePane(targetPaneId: string) {
    if (!draggedPaneId || draggedPaneId === targetPaneId) {
      return;
    }

    setPanes((currentPanes) => moveItemBefore(currentPanes, draggedPaneId, targetPaneId));
  }

  function movePaneByOffset(paneId: string, offset: number) {
    setPanes((currentPanes) => {
      const currentIndex = currentPanes.findIndex((pane) => pane.id === paneId);
      const targetIndex = currentIndex + offset;

      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= currentPanes.length) {
        return currentPanes;
      }

      const nextPanes = [...currentPanes];
      const [pane] = nextPanes.splice(currentIndex, 1);
      if (!pane) {
        return currentPanes;
      }

      nextPanes.splice(targetIndex, 0, pane);
      return nextPanes;
    });
  }

  return (
    <main className="ops-shell" aria-label="AgentDeck workspace deck">
      <TopRail />
      <aside className="workspace-dock" aria-label="Saved workspaces">
        <div className="dock-heading">
          <h2 className="section-kicker">Workspaces</h2>
          <button className="icon-button" type="button" aria-label="Workspace settings">
            <AgentDeckIcon name="settings" size={17} />
          </button>
        </div>
        <h1>AgentDeck</h1>
        <p className="dock-copy">A calm command center for saved panes, shared context, and CLI coding agents.</p>
        <div className="dock-list">
          {workspaces.map((workspace) => (
            <button className="workspace-row" key={workspace.name} type="button">
              <span className="workspace-row__status">
                <AgentDeckIcon name="folder" size={16} />
                {workspace.status}
              </span>
              <span>
                <strong>{workspace.name}</strong>
                <small>{workspace.path}</small>
              </span>
              <span className="workspace-row__meta">{workspace.panes}P/{workspace.todos}T</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="pane-grid" aria-label="Workspace panes">
        {panes.map((pane) => (
          <article
            className="pane-frame"
            key={pane.id}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => movePane(pane.id)}
            tabIndex={0}
          >
            <header className="pane-header">
              <span className="pane-header__id">
                <span
                  aria-label={`Drag ${pane.title} pane`}
                  className="pane-drag-handle"
                  draggable
                  onDragEnd={() => setDraggedPaneId(null)}
                  onDragStart={() => setDraggedPaneId(pane.id)}
                  role="img"
                >
                  <AgentDeckIcon name="drag" size={15} />
                </span>
                <AgentDeckIcon name={pane.kind === "note" ? "note" : "terminal"} size={15} />
                {pane.id}
              </span>
              <span className="pane-actions">
                <button type="button" aria-label={`Move ${pane.title} left`} onClick={() => movePaneByOffset(pane.id, -1)}>
                  ←
                </button>
                <button type="button" aria-label={`Move ${pane.title} right`} onClick={() => movePaneByOffset(pane.id, 1)}>
                  →
                </button>
                <span className={`pane-status pane-status--${pane.statusTone}`}>{pane.status}</span>
              </span>
            </header>
            <div className="pane-body">
              <h2 className="pane-title">{pane.title}</h2>
              <p>{pane.detail}</p>
              <div className="terminal-lines" aria-hidden="true">
                <span>&gt; context.get_project_context</span>
                <span>&gt; todo.list --workspace current</span>
                <span>&gt; ready for shared-state operations</span>
              </div>
            </div>
            <span className="pane-resize-hint" aria-hidden="true" />
          </article>
        ))}
      </section>

      <aside className="context-deck" aria-label="Shared context deck">
        <section className="deck-panel">
          <h2 className="section-kicker section-kicker--with-icon">
            <AgentDeckIcon name="task" size={15} />
            Shared Todos
          </h2>
          <ol className="todo-list">
            {todos.map((todo, index) => (
              <li key={todo}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {todo}
              </li>
            ))}
          </ol>
        </section>

        <section className="deck-panel">
          <h2 className="section-kicker section-kicker--with-icon">
            <AgentDeckIcon name="brain" size={15} />
            Memory Vault
          </h2>
          <div className="memory-list">
            {memories.map((memory) => (
              <article className="memory-card" key={memory.text}>
                <span>{memory.label}</span>
                <p>{memory.text}</p>
              </article>
            ))}
          </div>
        </section>
      </aside>

      <footer className="event-strip" aria-label="Workspace event stream">
        <span>MCP: STDIO READY</span>
        <span>STORE: LOCKED WRITES + ATOMIC STATE</span>
        <span>BRANCH: DEVELOPMENT</span>
        <span>LAYOUT: QUAD / LOCAL OPS DECK</span>
      </footer>
    </main>
  );
}

export function moveItemBefore<T extends { id: string }>(items: T[], draggedId: string, targetId: string): T[] {
  const draggedIndex = items.findIndex((item) => item.id === draggedId);
  const targetIndex = items.findIndex((item) => item.id === targetId);

  if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) {
    return items;
  }

  const nextItems = [...items];
  const [draggedItem] = nextItems.splice(draggedIndex, 1);
  if (!draggedItem) {
    return items;
  }

  const insertionIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
  nextItems.splice(insertionIndex, 0, draggedItem);
  return nextItems;
}

function TopRail() {
  return (
    <header className="top-rail">
      <span className="rail-brand">
        <AgentDeckIcon name="sparkles" size={18} />
        AgentDeck
      </span>
      <span className="rail-path">D:/projects/Projects-batch3/AgentDeck</span>
      <span className="rail-status">MCP Local</span>
      <button className="command-button" type="button">
        <AgentDeckIcon name="search" size={16} />
        Search or command
        <kbd>Ctrl K</kbd>
      </button>
    </header>
  );
}
