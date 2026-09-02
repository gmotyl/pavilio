import { useCallback, useSyncExternalStore } from "react";
import {
  getConnectionState,
  onConnectionChange,
  type ConnectionState,
} from "./terminalInstances";

/**
 * Liveness of this browser's socket for `sessionId`, as a subscription.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect` because the
 * store's two properties map straight onto it:
 *
 * - `onConnectionChange` does not fire on subscription, so the value has to be
 *   *read*, not awaited. `getSnapshot` is called during render, so the first
 *   paint already carries the right state — and a changed `sessionId` re-reads
 *   in the same render rather than flashing the previous session's value.
 * - the store re-announces `"connected"` twice around a `reopen()` (once at
 *   the ws identity swap, once from `ws.onopen`). React re-reads the snapshot
 *   and bails out when the string is unchanged, so a repeated announcement is
 *   inherently idempotent instead of something this hook has to dedupe.
 *
 * Subscribe/unsubscribe are symmetrical per `sessionId`, which the panel needs:
 * `<StrictMode>` is always on here (no production build), so effects are always
 * double-invoked.
 */
export function useTerminalConnection(sessionId: string): ConnectionState {
  // React resubscribes when this identity changes — keyed on sessionId only.
  const subscribe = useCallback(
    (onStoreChange: () => void) => onConnectionChange(sessionId, onStoreChange),
    [sessionId],
  );

  const getSnapshot = useCallback(
    () => getConnectionState(sessionId),
    [sessionId],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
