export interface Disposable {
  dispose: () => void;
}

export interface ResolvedShell {
  args: string[];
  file: string;
}

export interface TerminalSessionRequest {
  cols?: number;
  cwd?: string;
  env?: Record<string, string>;
  id: string;
  rows?: number;
  shell?: ResolvedShell;
}

export interface TerminalSpawnOptions {
  args: string[];
  cols: number;
  cwd: string;
  env: Record<string, string>;
  file: string;
  id: string;
  rows: number;
}

export interface TerminalDataEvent {
  data: string;
  id: string;
}

export interface TerminalExitEvent {
  exitCode: number;
  id: string;
  signal?: number;
}

export interface TerminalPty {
  kill: () => void;
  onData: (handler: (data: string) => void) => Disposable;
  onExit: (handler: (event: { exitCode: number; signal?: number }) => void) => Disposable;
  resize: (cols: number, rows: number) => void;
  write: (data: string) => void;
}

export interface PtyAdapter {
  spawn: (options: TerminalSpawnOptions) => TerminalPty;
}

export interface TerminalSessionHostEvents {
  onData?: (event: TerminalDataEvent) => void;
  onExit?: (event: TerminalExitEvent) => void;
}

interface TerminalSessionRecord {
  disposables: Disposable[];
  pty: TerminalPty;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export class TerminalSessionHost {
  private readonly adapter: PtyAdapter;
  private readonly events: TerminalSessionHostEvents;
  private readonly sessions = new Map<string, TerminalSessionRecord>();

  constructor(adapter: PtyAdapter, events: TerminalSessionHostEvents = {}) {
    this.adapter = adapter;
    this.events = events;
  }

  createSession(request: TerminalSessionRequest) {
    if (this.sessions.has(request.id)) {
      throw new Error(`Terminal session ${request.id} already exists`);
    }

    const shell = request.shell ?? resolveDefaultShell();
    const pty = this.adapter.spawn({
      args: shell.args,
      cols: request.cols ?? DEFAULT_COLS,
      cwd: request.cwd ?? process.cwd(),
      env: request.env ?? getProcessEnv(),
      file: shell.file,
      id: request.id,
      rows: request.rows ?? DEFAULT_ROWS,
    });

    const dataDisposable = pty.onData((data) => this.events.onData?.({ id: request.id, data }));
    const exitDisposable = pty.onExit((event) => {
      this.disposeSession(request.id, false);
      const exitEvent: TerminalExitEvent = { exitCode: event.exitCode, id: request.id };
      if (event.signal !== undefined) {
        exitEvent.signal = event.signal;
      }
      this.events.onExit?.(exitEvent);
    });

    this.sessions.set(request.id, { disposables: [dataDisposable, exitDisposable], pty });
  }

  closeAll() {
    for (const sessionId of this.getSessionIds()) {
      this.closeSession(sessionId);
    }
  }

  closeSession(sessionId: string) {
    return this.disposeSession(sessionId, true);
  }

  getSessionIds() {
    return [...this.sessions.keys()];
  }

  resize(sessionId: string, cols: number, rows: number) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.pty.resize(Math.max(1, Math.floor(cols)), Math.max(1, Math.floor(rows)));
    return true;
  }

  write(sessionId: string, data: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.pty.write(data);
    return true;
  }

  private disposeSession(sessionId: string, kill: boolean) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    this.sessions.delete(sessionId);
    for (const disposable of session.disposables) {
      disposable.dispose();
    }

    if (kill) {
      session.pty.kill();
    }

    return true;
  }
}

export function resolveDefaultShell(platform = process.platform, env: Record<string, string | undefined> = process.env): ResolvedShell {
  if (env.AGENTDECK_SHELL) {
    return { args: [], file: env.AGENTDECK_SHELL };
  }

  if (platform === "win32") {
    return { args: [], file: env.ComSpec || "cmd.exe" };
  }

  return { args: [], file: env.SHELL || "sh" };
}

function getProcessEnv() {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
