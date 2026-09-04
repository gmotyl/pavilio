import * as pty from "node-pty";
import { randomUUID } from "crypto";
import { platform, homedir, userInfo } from "os";
import { recordOutput, removeSession } from "./terminalActivity";
import {
  createModeState,
  modePreamble,
  scanModeState,
  type ModeState,
} from "./terminal-mode-state";
import {
  createReplay,
  feedReplay,
  resizeReplay,
  destroyReplay,
} from "./terminalReplay";
import { nextSessionName, removeName, writeName } from "./terminal-identity";
import { listOsUsers, hasGitBindMount } from "./os-users";
import { translateCwd, buildRunAsSpawnCommand } from "./terminal-run-as";

export interface TerminalSession {
  id: string;
  name: string;
  project: string;
  cwd: string;
  pid: number;
  createdAt: string;
  pty: pty.IPty;
  modeState: ModeState;
  /**
   * Home directory this session's identity file lives under — the target
   * user's home for a `runAsUser` session, the panel-owner's own home
   * otherwise. Threaded into `writeName`/`removeName` at every call site so
   * the identity file always lands next to the account that's actually
   * running the PTY (see `terminal-identity.ts`'s header comment).
   */
  identityHomeDir: string;
  _suppressRecordUntil?: number;
}

export type TerminalSessionMeta = Omit<TerminalSession, "pty">;

const sessions = new Map<string, TerminalSession>();

/**
 * Every name ever handed to a session of a project — default-allocated or
 * explicitly supplied — for the lifetime of this process. `createSession`
 * feeds this record, not the live `sessions` map, to `nextSessionName`: the
 * live map only reflects sessions that happen to still be open, so scanning
 * it lets a destroyed session's number come back the moment nothing else is
 * holding it — exactly the collision `nextSessionName`'s own contract rules
 * out ("a closed session's number is never reused"). Entries are appended
 * on create and never pruned on destroy or rename, on purpose: forgetting an
 * assigned name is the bug this record exists to prevent.
 *
 * Memory note: this map is per-process and grows without bound, but every
 * entry is a short name string, so even a very long-lived server holds only
 * a negligible amount of data here.
 */
const assignedNames = new Map<string, string[]>();

function recordAssignedName(project: string, name: string): void {
  const names = assignedNames.get(project);
  if (names) names.push(name);
  else assignedNames.set(project, [name]);
}

/**
 * Test-only: clears the per-project assigned-name record so a test can
 * assert a fresh `<project>-1` allocation without leaking state from
 * earlier tests in the same process. Never called from production code.
 */
export function _resetAssignedNamesForTests(): void {
  assignedNames.clear();
}

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
  runAsUser?: string;
}): TerminalSessionMeta {
  const id = randomUUID();
  const shell = defaultShell();

  // A `runAsUser` that doesn't match a discovered account falls back to the
  // direct-spawn path below, identical to `runAsUser` being omitted — an
  // account removed after being set as a default must surface as a spawn
  // failure later, never a silent no-op here.
  const matchedUser = opts.runAsUser
    ? listOsUsers().find((user) => user.username === opts.runAsUser)
    : undefined;

  // The owner is a normal discovered account too, so the toolbar dropdown
  // can perfectly well list — and the caller pick — the panel-owner's own
  // username as `runAsUser`. That's not a "run as someone else" request, so
  // it must not route through the su/wsl.exe wrapper. Detected by identity
  // (uid/username via `userInfo()`), not by comparing `homeDir` strings:
  // `homedir()` prefers `$HOME` over the passwd-recorded home directory, so
  // a diverged `$HOME` could make a genuine owner match look like a
  // different account under a path comparison.
  const targetUser =
    matchedUser && matchedUser.username !== userInfo().username
      ? matchedUser
      : undefined;

  const identityHomeDir = targetUser?.homeDir ?? homedir();

  let spawnFile = shell;
  let spawnArgs: string[] = [];
  let spawnCwd = opts.cwd;

  if (targetUser) {
    const translated = translateCwd(opts.cwd, homedir(), targetUser.homeDir);
    // translateCwd assumes every account reaches the shared tree through its
    // own `~/git` (a symlink to the bind mount, per workspace-setup's own
    // design) — true for accounts provisioned that way, false for e.g. a
    // pre-existing account whose `~/git` is its own unrelated directory. Only
    // relevant when translation actually fired: an untranslated cwd (no
    // known owner-git prefix) was never going to land under the target's
    // `~/git` in the first place, so an absent link there says nothing about
    // it.
    const translationApplied = translated !== opts.cwd;
    const fallBackToHome = translationApplied && !hasGitBindMount(targetUser.homeDir);
    spawnCwd = fallBackToHome ? targetUser.homeDir : translated;

    const runAsCommand = buildRunAsSpawnCommand({
      user: targetUser,
      cwd: spawnCwd,
      sessionId: id,
      notice: fallBackToHome
        ? `pavilio: ${targetUser.username} has no ~/git link yet, opening $HOME instead of the project directory (expected until that account is set up with the shared tree)`
        : undefined,
    });
    spawnFile = runAsCommand.file;
    spawnArgs = runAsCommand.args;
  }

  const ptyProcess = pty.spawn(spawnFile, spawnArgs, {
    name: "xterm-256color",
    cols: opts.cols,
    rows: opts.rows,
    cwd: spawnCwd,
    env: { ...process.env, TERM: "xterm-256color", PAVILIO_TERMINAL_ID: id },
  });

  const priorNames = assignedNames.get(opts.project) ?? [];
  const providedName = opts.name === undefined || opts.name === "" ? undefined : opts.name;

  const session: TerminalSession = {
    id,
    name: providedName ?? nextSessionName(opts.project, priorNames),
    project: opts.project,
    cwd: opts.cwd,
    pid: ptyProcess.pid,
    createdAt: new Date().toISOString(),
    pty: ptyProcess,
    modeState: createModeState(),
    identityHomeDir,
  };

  sessions.set(id, session);
  recordAssignedName(opts.project, session.name);
  writeName(id, session.name, identityHomeDir);

  // Mirror every PTY output chunk into a headless replay buffer so a client
  // reconnecting later can be sent a serialized snapshot instead of a blank
  // screen. Kept as a separate onData subscription from the mode-scan hook so
  // the two concerns stay isolated.
  createReplay(id, opts.cols, opts.rows);
  ptyProcess.onData((data) => feedReplay(id, data));

  // Scan every PTY output chunk for DEC private mode set/reset sequences
  // so a newly-reconnecting client can receive a preamble that restores
  // the TUI's current mode state (alt screen, mouse tracking, bracketed
  // paste) — those bytes are emitted once at TUI startup and never again.
  ptyProcess.onData((data) => scanModeState(data, session.modeState));

  // Throttle activity-tracker updates: high-volume output (e.g. `cat`ing a
  // large file) would otherwise churn the idle timer thousands of times per
  // second. Missing the final chunk by up to RECORD_THROTTLE_MS is harmless
  // because the 1 s idle-debounce fires afterward anyway.
  const RECORD_THROTTLE_MS = 100;
  let lastRecordedAt = 0;
  ptyProcess.onData(() => {
    if (shouldSuppressRecord(session._suppressRecordUntil, Date.now())) return;
    const now = Date.now();
    if (now - lastRecordedAt >= RECORD_THROTTLE_MS) {
      lastRecordedAt = now;
      recordOutput(id);
    }
  });

  ptyProcess.onExit(() => {
    destroyReplay(id);
    removeSession(id);
    removeName(id, session.identityHomeDir);
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
  destroyReplay(id);
  removeName(id, session.identityHomeDir);
  sessions.delete(id);
  return true;
}

/**
 * A session's name is the only mutable part of its model. Colour used to live
 * here too; it identifies a *project* now and lives in the committed store
 * behind `project-colors.ts`.
 *
 * Renaming does not touch `assignedNames`: the old default-assigned name
 * (e.g. `alokai-3`) stays recorded even though no live session is called
 * that any more, so the allocator still won't hand it out again.
 */
export function updateSession(
  id: string,
  updates: { name?: string },
): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  if (updates.name !== undefined) {
    session.name = updates.name;
    writeName(id, session.name, session.identityHomeDir);
  }
  return true;
}

export function resizeSession(id: string, cols: number, rows: number): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  session.pty.resize(cols, rows);
  resizeReplay(id, cols, rows);
  return true;
}

const NUDGE_SUPPRESSION_MS = 700;

export function shouldSuppressRecord(
  suppressUntil: number | undefined,
  now: number,
): boolean {
  return (suppressUntil ?? 0) > now;
}

export function getModePreamble(id: string): string {
  const session = sessions.get(id);
  if (!session) return "";
  return modePreamble(session.modeState);
}

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
