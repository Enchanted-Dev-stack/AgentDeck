import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { getTerminalBridge } from "../terminal/bridge.js";
import { isTerminalPasteShortcut } from "./terminalShortcuts.js";

const DEFAULT_TERMINAL_FONT_FAMILY = "JetBrains Mono, Cascadia Mono, Consolas, monospace";

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
      fontSize: 12,
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
    terminal.loadAddon(fitAddon);
    terminal.open(terminalElement);

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
      terminalElement.removeEventListener("paste", pasteFromEvent);
      terminalElement.removeEventListener("pointerdown", focusTerminal);
      removeCwdListener();
      removeDataListener();
      removeExitListener();
      inputDisposable.dispose();
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
