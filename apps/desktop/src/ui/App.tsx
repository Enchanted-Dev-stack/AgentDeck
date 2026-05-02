import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, useState } from "react";
import { AgentDeckIcon, type AgentDeckIconName } from "./Icon.js";

type Page = "terminal" | "docs" | "todos" | "memory";
type SplitDirection = "row" | "column";
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

const MIN_PANE_WIDTH = 220;
const MIN_PANE_HEIGHT = 140;

const navItems: Array<{ id: Page; label: string; icon: AgentDeckIconName }> = [
  { id: "terminal", label: "Terminal", icon: "terminal" },
  { id: "docs", label: "Docs", icon: "note" },
  { id: "todos", label: "Todos", icon: "task" },
  { id: "memory", label: "Memory", icon: "brain" },
];

const terminalPanes: Record<string, TerminalPane> = {
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
  const [layout, setLayout] = useState<SplitNode>(initialSplitLayout);

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
        <button aria-label="Settings" className="sidebar__button" title="Settings" type="button">
          <AgentDeckIcon name="settings" size={19} />
        </button>
      </aside>

      <section className="workspace" aria-label="Workspace content">
        {activePage === "terminal" ? <TerminalWorkspace layout={layout} onLayoutChange={setLayout} /> : <ResourcePage page={activePage} />}
      </section>
    </main>
  );
}

function TerminalWorkspace({ layout, onLayoutChange }: { layout: SplitNode; onLayoutChange: (layout: SplitNode) => void }) {
  return (
    <section className="terminal-workspace" aria-label="Workspace panes">
      <SplitView node={layout} onLayoutChange={onLayoutChange} rootLayout={layout} />
    </section>
  );
}

function SplitView({ node, onLayoutChange, rootLayout }: { node: SplitNode; onLayoutChange: (layout: SplitNode) => void; rootLayout: SplitNode }) {
  if (node.type === "terminal") {
    return <TerminalPaneView pane={terminalPanes[node.id]} />;
  }

  return (
    <div className={`split split--${node.direction}`} data-split-id={node.id}>
      {node.children.map((child, index) => (
        <div className="split__child" key={getNodeKey(child)} style={getChildStyle(node, child, index)}>
          <SplitView node={child} onLayoutChange={onLayoutChange} rootLayout={rootLayout} />
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

function TerminalPaneView({ pane }: { pane: TerminalPane | undefined }) {
  if (!pane) {
    return null;
  }

  return (
    <article className="terminal-pane" aria-label={`${pane.title} terminal`}>
      <header className="terminal-pane__header">
        <span className="terminal-pane__title">
          <AgentDeckIcon name="terminal" size={14} />
          {pane.title}
        </span>
        <span className={`terminal-pane__status terminal-pane__status--${pane.tone}`}>{pane.status}</span>
      </header>
      <div className="terminal-pane__body">
        <p className="terminal-pane__command">$ {pane.command}</p>
        <p>{pane.detail}</p>
        <div className="terminal-pane__lines" aria-hidden="true">
          <span>&gt; context.get_project_context</span>
          <span>&gt; todo.list --workspace current</span>
          <span>&gt; ready for shared-state operations</span>
        </div>
      </div>
    </article>
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
