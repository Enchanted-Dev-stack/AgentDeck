import { AgentDeckIcon } from "./Icon.js";

const workspaces = [
  { name: "AgentDeck", path: "D:/projects/AgentDeck", status: "LIVE", panes: "04", todos: "07" },
  { name: "OpenCode Lab", path: "~/labs/opencode", status: "IDLE", panes: "03", todos: "02" },
  { name: "Docs Maintainer", path: "~/oss/docs", status: "SYNC", panes: "02", todos: "11" },
];

const panes = [
  { id: "TERM-01", title: "OpenCode", detail: "agent shell · shared MCP armed", status: "RUNNING" },
  { id: "TERM-02", title: "Dev Server", detail: "corepack pnpm dev", status: "IDLE" },
  { id: "TERM-03", title: "Tests", detail: "vitest watch", status: "EXIT 0" },
  { id: "DOC-04", title: "Workspace Notes", detail: "AGENTS.md · shared instructions", status: "PINNED" },
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
  return (
    <main className="ops-shell" aria-label="AgentDeck local operations deck">
      <TopRail />
      <aside className="workspace-dock" aria-label="Saved workspaces">
        <h2 className="section-kicker">Stations</h2>
        <h1>AgentDeck</h1>
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
          <article className="pane-frame" key={pane.id}>
            <header className="pane-header">
              <span className="pane-header__id">
                <AgentDeckIcon name={pane.id.startsWith("DOC") ? "note" : "terminal"} size={15} />
                {pane.id}
              </span>
              <span>{pane.status}</span>
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

function TopRail() {
  return (
    <header className="top-rail">
      <span className="rail-brand">AGENTDECK</span>
      <span>D:/projects/Projects-batch3/AgentDeck</span>
      <span className="rail-status">MCP LOCAL</span>
      <button className="command-button" type="button">COMMAND / CTRL+K</button>
    </header>
  );
}
