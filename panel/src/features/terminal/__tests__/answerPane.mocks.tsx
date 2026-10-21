/**
 * The module-mock factories of the answer pane and composer family — see
 * `answerPane.harness.tsx` for why they live apart from it. This module must
 * not import anything from the app: it is loaded from inside `vi.mock`
 * factories, while the modules they replace are still being resolved.
 */
import type { ConnectionState } from "../terminalInstances";

/**
 * The markdown renderer reaches mermaid's browser-only stack the moment an
 * answer is under the cursor. The stand-in prints the chart source, so a test
 * that does render a fence can still read what reached it.
 */
export function mermaidMock() {
  return {
    default: ({ chart }: { chart: string }) => <div data-testid="mermaid">{chart}</div>,
  };
}

/** The synthesis cache the pane's rail peeks into: nothing warm, nothing subscribes. */
export function synthMock() {
  return {
    isSpeechSynthesized: () => false,
    speechCacheState: () => "cold",
    subscribeSpeechCache: () => () => {},
  };
}

/**
 * The terminal pool's state, as the composer's stub of it sees it.
 *
 * `connectionState` is what every cell reports; `listeners` are the
 * connection-state subscribers, by session — the retry's wake-up signal. Both
 * live here, beside the factory that reads them, so a test file can hand a
 * verdict to the subscribers without re-declaring the pool.
 * A file that needs a particular starting state sets it in its `beforeEach`.
 */
export const pool = {
  connectionState: "connected" as ConnectionState,
  listeners: new Map<string, Set<(state: ConnectionState) => void>>(),
};

/**
 * The pool is somebody else's subject, and jsdom has no socket under any of
 * this. What is replaced is exactly the entry points the composer reaches —
 * its own focus repair and dismiss, and the three `ptySubmit` asks the pool
 * for — so the handshake can be answered by hand through `pool`.
 */
export const terminalInstancesMock = () => ({
  bracketedPasteOn: () => false,
  sendDismiss: () => {},
  reconnectOnActivate: () => {},
  getConnectionState: () => pool.connectionState,
  hasExited: () => false,
  reconnectSession: () => {},
  onConnectionChange: (sessionId: string, cb: (state: ConnectionState) => void) => {
    let set = pool.listeners.get(sessionId);
    if (!set) {
      set = new Set();
      pool.listeners.set(sessionId, set);
    }
    set.add(cb);
    return () => {
      set?.delete(cb);
    };
  },
});
