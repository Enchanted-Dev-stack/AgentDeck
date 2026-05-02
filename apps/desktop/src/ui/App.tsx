import { useEffect, useRef, useState } from "react";
import { Responsive, type Layout, type ResponsiveLayouts } from "react-grid-layout";
import { AgentDeckIcon, type AgentDeckIconName } from "./Icon.js";

type Page = "terminal" | "docs" | "todos" | "memory";
type PaneTone = "success" | "neutral" | "warn";

interface TerminalPane {
  id: string;
  title: string;
  detail: string;
  status: string;
  tone: PaneTone;
}

const navItems: Array<{ id: Page; label: string; icon: AgentDeckIconName }> = [
  { id: "terminal", label: "Terminal", icon: "terminal" },
  { id: "docs", label: "Docs", icon: "note" },
  { id: "todos", label: "Todos", icon: "task" },
  { id: "memory", label: "Memory", icon: "brain" },
];

const terminalPanes: TerminalPane[] = [
  { id: "TERM-01", title: "OpenCode", detail: "agent shell · shared MCP armed", status: "RUNNING", tone: "success" },
  { id: "TERM-02", title: "Dev Server", detail: "corepack pnpm dev", status: "IDLE", tone: "neutral" },
  { id: "TERM-03", title: "Tests", detail: "vitest watch", status: "EXIT 0", tone: "success" },
  { id: "TERM-04", title: "Scratch", detail: "local commands · permissioned", status: "READY", tone: "warn" },
];

export const initialTerminalLayout: Layout = [
  { i: "TERM-01", x: 0, y: 0, w: 6, h: 7, minW: 3, minH: 4 },
  { i: "TERM-02", x: 6, y: 0, w: 6, h: 4, minW: 3, minH: 3 },
  { i: "TERM-03", x: 6, y: 4, w: 3, h: 3, minW: 3, minH: 3 },
  { i: "TERM-04", x: 9, y: 4, w: 3, h: 3, minW: 3, minH: 3 },
];

export const initialTerminalLayouts: ResponsiveLayouts<"desktop" | "tablet" | "mobile"> = {
  desktop: initialTerminalLayout,
  tablet: [
    { i: "TERM-01", x: 0, y: 0, w: 6, h: 6, minW: 2, minH: 4 },
    { i: "TERM-02", x: 0, y: 6, w: 6, h: 4, minW: 2, minH: 3 },
    { i: "TERM-03", x: 0, y: 10, w: 3, h: 3, minW: 2, minH: 3 },
    { i: "TERM-04", x: 3, y: 10, w: 3, h: 3, minW: 2, minH: 3 },
  ],
  mobile: [
    { i: "TERM-01", x: 0, y: 0, w: 1, h: 6, minW: 1, minH: 4 },
    { i: "TERM-02", x: 0, y: 6, w: 1, h: 4, minW: 1, minH: 3 },
    { i: "TERM-03", x: 0, y: 10, w: 1, h: 3, minW: 1, minH: 3 },
    { i: "TERM-04", x: 0, y: 13, w: 1, h: 3, minW: 1, minH: 3 },
  ],
};

const docs = [
  { title: "Product Requirements", path: "docs/PRD.md", summary: "Local-first workspace scope, agent surfaces, and V1 boundaries." },
  { title: "MCP Contract", path: "docs/MCP_CONTRACT.md", summary: "Shared tools and resources exposed to coding agents over stdio." },
  { title: "Architecture", path: "docs/ARCHITECTURE.md", summary: "Desktop shell, shared state package, and MCP server responsibilities." },
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
  const [activePage, setActivePage] = useState<Page>("terminal");
  const [layouts, setLayouts] = useState(initialTerminalLayouts);
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasWidth = useElementWidth(canvasRef, 1180);

  return (
    <main className="ops-shell" aria-label="AgentDeck workspace deck">
      <aside className="app-sidebar" aria-label="Primary navigation">
        <div className="sidebar-brand" aria-label="AgentDeck">
          <AgentDeckIcon name="sparkles" size={22} />
        </div>
        <nav className="sidebar-nav" aria-label="Workspace pages">
          {navItems.map((item) => (
            <button
              aria-label={item.label}
              aria-pressed={activePage === item.id}
              className="sidebar-nav__item"
              key={item.id}
              onClick={() => setActivePage(item.id)}
              title={item.label}
              type="button"
            >
              <AgentDeckIcon name={item.icon} size={20} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <button className="sidebar-nav__item sidebar-nav__item--utility" type="button" aria-label="Settings" title="Settings">
          <AgentDeckIcon name="settings" size={20} />
          <span>Settings</span>
        </button>
      </aside>

      <section className="workspace-stage" aria-label="Workspace content">
        {activePage === "terminal" ? (
          <TerminalPage canvasRef={canvasRef} layouts={layouts} onLayoutsChange={setLayouts} width={canvasWidth} />
        ) : (
          <ResourcePage page={activePage} />
        )}
      </section>
    </main>
  );
}

function TerminalPage({
  canvasRef,
  layouts,
  onLayoutsChange,
  width,
}: {
  canvasRef: React.RefObject<HTMLDivElement | null>;
  layouts: ResponsiveLayouts<"desktop" | "tablet" | "mobile">;
  onLayoutsChange: (layouts: ResponsiveLayouts<"desktop" | "tablet" | "mobile">) => void;
  width: number;
}) {
  const breakpoint = getBreakpoint(width);

  function nudgePane(paneId: string, dx: number, dy: number) {
    onLayoutsChange(nudgePaneInLayouts(layouts, paneId, dx, dy));
  }

  return (
    <div className="terminal-page">
      <header className="page-heading">
        <span className="section-kicker section-kicker--with-icon">
          <AgentDeckIcon name="layout" size={15} />
          Dynamic Pane Canvas
        </span>
        <h1>Terminals</h1>
        <p>Drag pane headers and pull resize handles. The grid packs panes without overlap or hidden stacking.</p>
      </header>

      <div className="pane-canvas" ref={canvasRef} aria-label="Workspace panes">
        <Responsive
          breakpoint={breakpoint}
          breakpoints={{ desktop: 960, mobile: 0, tablet: 640 }}
          className="pane-grid"
          cols={{ desktop: 12, mobile: 1, tablet: 6 }}
          dragConfig={{ bounded: true, handle: ".pane-drag-handle" }}
          layouts={layouts}
          margin={[12, 12]}
          onLayoutChange={(_nextLayout, nextLayouts) => onLayoutsChange(copyLayouts(nextLayouts))}
          resizeConfig={{ handles: ["se", "e", "s"] }}
          rowHeight={42}
          width={width}
        >
          {terminalPanes.map((pane) => (
            <article className="pane-frame" key={pane.id}>
              <header className="pane-header">
                <span className="pane-header__id">
                  <button aria-label={`Drag ${pane.title} pane`} className="pane-drag-handle" type="button">
                    <AgentDeckIcon name="drag" size={15} />
                  </button>
                  <AgentDeckIcon name="terminal" size={15} />
                  {pane.id}
                </span>
                <span className="pane-actions">
                  <button type="button" aria-label={`Move ${pane.title} left`} onClick={() => nudgePane(pane.id, -1, 0)}>
                    ←
                  </button>
                  <button type="button" aria-label={`Move ${pane.title} right`} onClick={() => nudgePane(pane.id, 1, 0)}>
                    →
                  </button>
                  <button type="button" aria-label={`Move ${pane.title} up`} onClick={() => nudgePane(pane.id, 0, -1)}>
                    ↑
                  </button>
                  <button type="button" aria-label={`Move ${pane.title} down`} onClick={() => nudgePane(pane.id, 0, 1)}>
                    ↓
                  </button>
                  <span className={`pane-status pane-status--${pane.tone}`}>{pane.status}</span>
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
            </article>
          ))}
        </Responsive>
      </div>
    </div>
  );
}

export function nudgePaneInLayouts<B extends string>(layouts: ResponsiveLayouts<B>, paneId: string, dx: number, dy: number): ResponsiveLayouts<B> {
  return Object.fromEntries(
    Object.entries(layouts).map(([breakpoint, layout]) => [
      breakpoint,
      (layout as Layout).map((item) => {
        if (item.i !== paneId) {
          return item;
        }

        return {
          ...item,
          x: Math.max(0, item.x + dx),
          y: Math.max(0, item.y + dy),
        };
      }),
    ]),
  ) as unknown as ResponsiveLayouts<B>;
}

function copyLayouts<B extends string>(layouts: ResponsiveLayouts<B>): ResponsiveLayouts<B> {
  return Object.fromEntries(Object.entries(layouts).map(([breakpoint, layout]) => [breakpoint, [...(layout as Layout)]])) as unknown as ResponsiveLayouts<B>;
}

function getBreakpoint(width: number) {
  if (width >= 960) {
    return "desktop";
  }

  if (width >= 640) {
    return "tablet";
  }

  return "mobile";
}

function ResourcePage({ page }: { page: Exclude<Page, "terminal"> }) {
  if (page === "docs") {
    return (
      <ResourceShell icon="note" kicker="Shared Docs" title="Docs" description="Project documentation stays outside the terminal canvas so panes remain focused on agent work.">
        <div className="resource-grid">
          {docs.map((doc) => (
            <article className="resource-card" key={doc.path}>
              <span>{doc.path}</span>
              <h2>{doc.title}</h2>
              <p>{doc.summary}</p>
            </article>
          ))}
        </div>
      </ResourceShell>
    );
  }

  if (page === "todos") {
    return (
      <ResourceShell icon="task" kicker="Shared Todos" title="Todos" description="A shared task lane for CLI agents and humans working in the same local project.">
        <ol className="todo-list">
          {todos.map((todo, index) => (
            <li key={todo}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {todo}
            </li>
          ))}
        </ol>
      </ResourceShell>
    );
  }

  return (
    <ResourceShell icon="brain" kicker="Memory Vault" title="Memory" description="Durable workspace facts and decisions that agents can retrieve through MCP.">
      <div className="memory-list">
        {memories.map((memory) => (
          <article className="memory-card" key={memory.text}>
            <span>{memory.label}</span>
            <p>{memory.text}</p>
          </article>
        ))}
      </div>
    </ResourceShell>
  );
}

function ResourceShell({
  children,
  description,
  icon,
  kicker,
  title,
}: {
  children: React.ReactNode;
  description: string;
  icon: AgentDeckIconName;
  kicker: string;
  title: string;
}) {
  return (
    <div className="resource-page">
      <header className="page-heading">
        <span className="section-kicker section-kicker--with-icon">
          <AgentDeckIcon name={icon} size={15} />
          {kicker}
        </span>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <section className="resource-panel">{children}</section>
    </div>
  );
}

function useElementWidth(ref: React.RefObject<HTMLElement | null>, fallbackWidth: number) {
  const [width, setWidth] = useState(fallbackWidth);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }

      setWidth(Math.max(Math.floor(entry.contentRect.width), 320));
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}
