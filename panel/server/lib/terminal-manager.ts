import * as pty from "node-pty";
import { randomUUID } from "crypto";
import { platform } from "os";
import { recordOutput, removeSession } from "./terminalActivity";

export interface TerminalSession {
  id: string;
  name: string;
  color: string | null;
  project: string;
  cwd: string;
  pid: number;
  createdAt: string;
  pty: pty.IPty;
  _suppressRecordUntil?: number;
}

export type TerminalSessionMeta = Omit<TerminalSession, "pty">;

const sessions = new Map<string, TerminalSession>();

function defaultShell(): string {
  if (platform() === "win32") return "powershell.exe";
  return process.env.SHELL || "/bin/zsh";
}

function toMeta(session: TerminalSession): TerminalSessionMeta {
  const { pty: _pty, ...meta } = session;
  return meta;
}

export function createSession(opts: {
  cwd: string;
  cols: number;
  rows: number;
  project: string;
  name?: string;
}): TerminalSessionMeta {
  const id = randomUUID();
  const shell = defaultShell();

  const ptyProcess = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    env: { ...process.env, TERM: "xterm-256color" },
  });

  const session: TerminalSession = {
    id,
    name: opts.name || `shell-${sessions.size + 1}`,
    color: null,
    project: opts.project,
    cwd: opts.cwd,
    pid: ptyProcess.pid,
    createdAt: new Date().toISOString(),
    pty: ptyProcess,
  };

  sessions.set(id, session);

  // Throttle activity-tracker updates: high-volume output (e.g. `cat`ing a
  // large file) would otherwise churn the idle timer thousands of times per
  // second. Missing the final chunk by up to RECORD_THROTTLE_MS is harmless
  // because the 1 s idle-debounce fires afterward anyway.
  const RECORD_THROTTLE_MS = 100;
  let lastRecordedAt = 0;
  ptyProcess.onData(() => {
    if ((session._suppressRecordUntil ?? 0) > Date.now()) return;
    const now = Date.now();
    if (now - lastRecordedAt >= RECORD_THROTTLE_MS) {
      lastRecordedAt = now;
      recordOutput(id);
    }
  });

  ptyProcess.onExit(() => {
    removeSession(id);
    sessions.delete(id);
  });

  return toMeta(session);
}

export function getSession(id: string): TerminalSession | undefined {
  return sessions.get(id);
}

export function listSessions(): TerminalSessionMeta[] {
  return Array.from(sessions.values()).map(toMeta);
}

export function destroySession(id: string): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  session.pty.kill();
  sessions.delete(id);
  return true;
}

export function updateSession(
  id: string,
  updates: { name?: string; color?: string | null },
): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  if (updates.name !== undefined) session.name = updates.name;
  if (updates.color !== undefined) session.color = updates.color;
  return true;
}

export function resizeSession(id: string, cols: number, rows: number): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  session.pty.resize(cols, rows);
  return true;
}

const NUDGE_SUPPRESSION_MS = 700;

export function nudgeSession(id: string, cols: number, rows: number): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  session._suppressRecordUntil = Date.now() + NUDGE_SUPPRESSION_MS;
  session.pty.resize(Math.max(1, cols - 1), rows);
  setImmediate(() => {
    if (sessions.has(id)) session.pty.resize(cols, rows);
  });
  return true;
}
