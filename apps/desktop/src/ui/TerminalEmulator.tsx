import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal, type IDisposable, type ITerminalAddon } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { getTerminalBridge } from "../terminal/bridge.js";
import { isTerminalPasteShortcut } from "./terminalShortcuts.js";

const DEFAULT_TERMINAL_FONT_FAMILY = "JetBrains Mono, Cascadia Mono, Consolas, monospace";
const TERMINAL_RENDER_DIAGNOSTIC_EVENT = "agentdeck:terminal-render-diagnostic";
const TERMINAL_RENDER_OPTIONS_EVENT = "agentdeck:terminal-render-options";
const DEFAULT_TERMINAL_FONT_SIZE = 12;
const TERMINAL_RENDER_DIAGNOSTIC_SAMPLE = [
  "\r\n\x1b[1;36mAgentDeck xterm render diagnostic\x1b[0m\r\n",
  "background cells: ",
  "\x1b[48;2;88;88;88m        \x1b[48;2;145;145;145m        \x1b[48;2;235;235;235m        \x1b[0m\r\n",
  "full blocks:      ",
  "\x1b[38;2;88;88;88m████████\x1b[38;2;145;145;145m████████\x1b[38;2;235;235;235m████████\x1b[0m\r\n",
  "half blocks:      ",
  "\x1b[38;2;88;88;88m▄▄▄▄▄▄▄▄\x1b[38;2;145;145;145m▀▀▀▀▀▀▀▀\x1b[38;2;235;235;235m████████\x1b[0m\r\n",
  "If these rows show seams or gaps, the renderer/CSS path is causing the artifact.\r\n\r\n",
].join("");

export function requestTerminalRenderDiagnostic(paneId?: string) {
  window.dispatchEvent(new CustomEvent(TERMINAL_RENDER_DIAGNOSTIC_EVENT, { detail: { paneId } }));
}

export function updateTerminalRenderOptions(options: { customGlyphs?: boolean; fontSize?: number; paneId?: string }) {
  window.dispatchEvent(new CustomEvent(TERMINAL_RENDER_OPTIONS_EVENT, { detail: options }));
}

export function TerminalEmulator({ cwd, fontFamily = DEFAULT_TERMINAL_FONT_FAMILY, onCwdChange, paneId }: { cwd: string; fontFamily?: string; onCwdChange: (cwd: string) => void; paneId: string }) {
  const terminalElementRef = useRef<HTMLDivElement>(null);
  const initialCwdRef = useRef(cwd);
  const onCwdChangeRef = useRef(onCwdChange);

  useEffect(() => {
    onCwdChangeRef.current = onCwdChange;
  }, [onCwdChange]);

  useEffect(() => {
    const bridge = getTerminalBridge();
    const terminalElement = terminalElementRef.current;
    if (!bridge || !terminalElement) {
      return undefined;
    }

    let disposed = false;
    let sessionCreated = false;
    let resizeTimer: number | undefined;

    const terminal = new Terminal({
      allowProposedApi: false,
      customGlyphs: true,
      cursorBlink: true,
      fontFamily,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
      letterSpacing: 0,
      lineHeight: 1,
      theme: {
        background: "#05070a",
        cursor: "#7dd3fc",
        foreground: "#d8dce2",
        selectionBackground: "#25435a",
      },
    });
    const fitAddon = new FitAddon();
    let rendererAddon: ITerminalAddon | undefined;
    terminal.loadAddon(fitAddon);
    terminal.open(terminalElement);
    const contextLossDisposable = loadRendererAddon(terminal, (addon) => {
      rendererAddon = addon;
    });

    const focusTerminal = () => terminal.focus();
    terminalElement.addEventListener("pointerdown", focusTerminal);
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type === "keydown" && isTerminalPasteShortcut(event)) {
        ignoreTerminalIpcError(bridge.paste(paneId));
        return false;
      }

      return true;
    });

    const pasteFromEvent = (event: ClipboardEvent) => {
      event.preventDefault();
      ignoreTerminalIpcError(bridge.paste(paneId));
    };
    terminalElement.addEventListener("paste", pasteFromEvent);

    const writeRenderDiagnostic = (event: Event) => {
      const targetPaneId = event instanceof CustomEvent && typeof event.detail?.paneId === "string" ? event.detail.paneId : undefined;
      if (targetPaneId && targetPaneId !== paneId) {
        return;
      }

      terminal.write(TERMINAL_RENDER_DIAGNOSTIC_SAMPLE);
    };
    window.addEventListener(TERMINAL_RENDER_DIAGNOSTIC_EVENT, writeRenderDiagnostic);

    const updateRenderOptions = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        return;
      }

      const targetPaneId = typeof event.detail?.paneId === "string" ? event.detail.paneId : undefined;
      if (targetPaneId && targetPaneId !== paneId) {
        return;
      }

      const nextOptions: Partial<{ customGlyphs: boolean; fontSize: number }> = {};
      if (typeof event.detail?.customGlyphs === "boolean") {
        nextOptions.customGlyphs = event.detail.customGlyphs;
      }
      if (typeof event.detail?.fontSize === "number" && Number.isFinite(event.detail.fontSize)) {
        nextOptions.fontSize = Math.min(24, Math.max(8, Math.round(event.detail.fontSize)));
      }

      if (Object.keys(nextOptions).length === 0) {
        return;
      }

      terminal.options = nextOptions;
      resizePty();
    };
    window.addEventListener(TERMINAL_RENDER_OPTIONS_EVENT, updateRenderOptions);

    const resizePty = () => {
      if (terminalElement.clientWidth === 0 || terminalElement.clientHeight === 0) {
        return;
      }

      fitAddon.fit();
      ignoreTerminalIpcError(bridge.resize(paneId, terminal.cols, terminal.rows));
    };

    const scheduleResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resizePty, 50);
    };

    const inputDisposable = terminal.onData((data) => {
      ignoreTerminalIpcError(bridge.write(paneId, data));
    });
    const removeDataListener = bridge.onData((event) => {
      if (event.id === paneId) {
        terminal.write(event.data);
      }
    });
    const removeCwdListener = bridge.onCwd((event) => {
      if (event.id === paneId) {
        onCwdChangeRef.current(event.cwd);
      }
    });
    const removeExitListener = bridge.onExit((event) => {
      if (event.id === paneId) {
        terminal.writeln(`\r\n[process exited with code ${event.exitCode}]`);
      }
    });

    void prepareTerminalLayout(terminalElement).then(() => {
      if (disposed) {
        return;
      }

      resizePty();
      terminal.focus();
      sessionCreated = true;
      return bridge.createSession({ cols: terminal.cols, cwd: initialCwdRef.current || undefined, id: paneId, rows: terminal.rows });
    }).then((created) => {
      if (!disposed && created === false) {
        terminal.writeln("Unable to start local shell session.");
      }
    }).catch(() => {
      if (!disposed) {
        terminal.writeln("Unable to start local shell session.");
      }
    });

    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => {
      if (sessionCreated) {
        scheduleResize();
      }
    });
    observer?.observe(terminalElement);

    return () => {
      disposed = true;
      window.clearTimeout(resizeTimer);
      observer?.disconnect();
      contextLossDisposable?.dispose();
      window.removeEventListener(TERMINAL_RENDER_OPTIONS_EVENT, updateRenderOptions);
      window.removeEventListener(TERMINAL_RENDER_DIAGNOSTIC_EVENT, writeRenderDiagnostic);
      terminalElement.removeEventListener("paste", pasteFromEvent);
      terminalElement.removeEventListener("pointerdown", focusTerminal);
      removeCwdListener();
      removeDataListener();
      removeExitListener();
      inputDisposable.dispose();
      rendererAddon?.dispose();
      terminal.dispose();
    };
  }, [fontFamily, paneId]);

  if (!getTerminalBridge()) {
    return (
      <div className="terminal-emulator terminal-emulator--empty">
        <span>Electron terminal bridge unavailable in browser preview.</span>
      </div>
    );
  }

  return <div className="terminal-emulator" ref={terminalElementRef} />;
}

function ignoreTerminalIpcError(request: Promise<boolean>) {
  void request.catch(() => undefined);
}

function loadRendererAddon(terminal: Terminal, onRendererChange: (addon: ITerminalAddon | undefined) => void): IDisposable | undefined {
  try {
    const webglAddon = new WebglAddon();
    terminal.loadAddon(webglAddon);
    onRendererChange(webglAddon);
    return webglAddon.onContextLoss(() => {
      webglAddon.dispose();
      onRendererChange(undefined);
    });
  } catch {
    onRendererChange(undefined);
    return undefined;
  }
}

async function prepareTerminalLayout(terminalElement: HTMLElement) {
  await document.fonts?.ready;
  await nextAnimationFrame();

  if (terminalElement.clientWidth === 0 || terminalElement.clientHeight === 0) {
    await nextAnimationFrame();
  }
}

function nextAnimationFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
