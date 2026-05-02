import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { getTerminalBridge } from "../terminal/bridge.js";

export function TerminalEmulator({ paneId }: { paneId: string }) {
  const terminalElementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bridge = getTerminalBridge();
    const terminalElement = terminalElementRef.current;
    if (!bridge || !terminalElement) {
      return undefined;
    }

    const terminal = new Terminal({
      allowProposedApi: false,
      cursorBlink: true,
      fontFamily: "JetBrains Mono, Consolas, monospace",
      fontSize: 12,
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
    fitAddon.fit();

    const resizePty = () => {
      if (terminalElement.clientWidth === 0 || terminalElement.clientHeight === 0) {
        return;
      }

      fitAddon.fit();
      ignoreTerminalIpcError(bridge.resize(paneId, terminal.cols, terminal.rows));
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

    void bridge.createSession({ cols: terminal.cols, id: paneId, rows: terminal.rows }).then((created) => {
      if (!created) {
        terminal.writeln("Unable to start local shell session.");
      }
    }).catch(() => terminal.writeln("Unable to start local shell session."));

    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resizePty);
    observer?.observe(terminalElement);

    return () => {
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
