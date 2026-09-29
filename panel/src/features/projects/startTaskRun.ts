import { createTerminalSession } from "../terminal/createTerminalSession";
import { submitToPty } from "../terminal/ptySubmit";
import {
  acquireTerminal,
  hasExited,
  onConnectionChange,
  releaseTerminal,
  type LiveTerminal,
} from "../terminal/terminalInstances";
import type { SessionMeta } from "../terminal/useTerminalSessions";

/** `WebSocket.OPEN`, spelled out so this module does not need the global. */
const WS_OPEN = 1;

/** How long a brand-new session's socket gets to finish its handshake. */
export const SOCKET_OPEN_TIMEOUT_MS = 10_000;

/** The project's open sessions, only to pick the next free `<project>-N` name. */
async function projectSessions(project: string): Promise<SessionMeta[]> {
  try {
    const res = await fetch("/api/terminal/sessions");
    if (!res.ok) return [];
    const all = (await res.json()) as SessionMeta[];
    return Array.isArray(all) ? all.filter((s) => s.project === project) : [];
  } catch {
    // A name collision is cosmetic; failing the run over it would not be.
    return [];
  }
}

/**
 * Resolves once `live`'s socket is OPEN. A fresh instance's socket is still
 * handshaking, and `send` refuses a frame until it lands — a refused body
 * would send `submitToPty` down its reconnect path, tearing down the very
 * handshake it is waiting for. The pool's first "connected" is the optimistic
 * one at the socket swap, so the readiness test is `readyState`, not the event.
 */
function whenOpen(sessionId: string, live: LiveTerminal): Promise<void> {
  if (live.ws?.readyState === WS_OPEN) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let unsubscribe: () => void = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("The new terminal did not connect in time"));
    }, SOCKET_OPEN_TIMEOUT_MS);
    const settle = (error: Error | null) => {
      clearTimeout(timer);
      unsubscribe();
      if (error) reject(error);
      else resolve();
    };
    unsubscribe = onConnectionChange(sessionId, (state) => {
      if (hasExited(sessionId)) settle(new Error("The new terminal exited before the run started"));
      else if (state === "disconnected") settle(new Error("The new terminal's connection failed"));
      else if (live.ws?.readyState === WS_OPEN) settle(null);
    });
  });
}

/** Writes `runLine` and its return; resolves once the return is on the socket. */
function submit(sessionId: string, live: LiveTerminal, runLine: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    submitToPty(sessionId, live.send, runLine, {
      onReturnDelivered: resolve,
      onFailed: (stage) =>
        reject(
          new Error(
            // Either way the session exists: say so, so nobody retries into a
            // second terminal without looking for the first.
            stage === "body"
              ? "The terminal was created but the run line could not be sent"
              : "The terminal was created and the run line typed, but its Enter did not reach it",
          ),
        ),
    });
  });
}

/** Creates a session for `project` — no cwd, so the server's default and the project's default
 *  user both apply — then writes the composed run line to it. Resolves with the new session id. */
export async function startTaskRun(opts: { project: string; runLine: string }): Promise<string> {
  const { project, runLine } = opts;
  // No `cwd` in the options: `createTerminalSession` sends `cwd: undefined`,
  // which JSON drops, and it never sends `runAsUser` — so the server applies
  // the workspace root and `getDefaultUser(project)`.
  const created = await createTerminalSession(project, await projectSessions(project));
  if (!created) throw new Error("Could not create a terminal for the run");

  // Held only while writing; released, the instance parks in the pool's hidden
  // root and the Terminal view re-acquires the same one, scrollback intact.
  const live = acquireTerminal(created.id);
  try {
    await whenOpen(created.id, live);
    await submit(created.id, live, runLine);
  } finally {
    releaseTerminal(created.id);
  }
  return created.id;
}
