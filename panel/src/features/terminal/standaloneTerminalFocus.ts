/**
 * The focused cell of the standalone `/terminals` page. That page keeps its
 * focus in component state (it spans every project, so there is no per-project
 * preference to read), so it publishes it here for the speech alerts' "looked
 * at" rule. Cleared when the page unmounts.
 */
let focused: string | null = null;
const listeners = new Set<() => void>();

export function readStandaloneTerminalFocus(): string | null {
  return focused;
}

export function publishStandaloneTerminalFocus(sessionId: string | null): void {
  if (focused === sessionId) return;
  focused = sessionId;
  for (const listener of [...listeners]) listener();
}

export function subscribeStandaloneTerminalFocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
