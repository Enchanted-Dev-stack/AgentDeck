import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { getTerminalBridge } from "../terminal/bridge.js";

const TERMINAL_FONT_FAMILY = "Cascadia Mono, Consolas, JetBrains Mono, monospace";

export function TerminalEmulator({ paneId }: { paneId: string }) {
  const terminalElementRef = useRef<HTMLDivElement>(null);

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
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 12,
      letterSpacing: 0,
      lineHeight: 1,
      theme: {
        background: "#07090d",
        cursor: "#7dd3fc",
        foreground: "#d8dce2",
        selectionBackground: "#25435a",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalElement);

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
      sessionCreated = true;
      return bridge.createSession({ cols: terminal.cols, id: paneId, rows: terminal.rows });
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
      removeDataListener();
      removeExitListener();
      inputDisposable.dispose();
      terminal.dispose();
    };
  }, [paneId]);

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
