/**
 * The panel-wide alert stack — a module-level singleton read through
 * `useSyncExternalStore`. It lives outside React, so it is outside the router
 * and survives navigation by construction.
 *
 * The store holds entries and their order only. Timers (and pausing them on
 * hover) are a view concern and live in the host; `seq` is how the host learns
 * that a refreshed entry needs its timer restarted. There is no queue limit
 * here either: the host caps what is visible.
 *
 * The export is plural on purpose — a module exporting `alert` would shadow
 * `window.alert` for every reader of that file.
 */

export type AlertKind = "error" | "warning" | "info" | "success";

export interface AlertOptions {
  /** Second line, muted. */
  detail?: string;
  /** No timer; closes only by × / swipe / `alerts.dismiss`. */
  persistent?: boolean;
  /** Dedupe key: a repeat with a live id refreshes in place, never stacks. */
  id?: string;
  /** Called on × and swipe only — not on timer expiry or `alerts.dismiss`. */
  onDismiss?: () => void;
  /**
   * Makes the card a button: click / Enter / Space call this and remove the
   * card. Never on × or swipe, and activation does not call `onDismiss`.
   */
  onClick?: () => void;
}

export interface AlertEntry {
  id: string;
  kind: AlertKind;
  title: string;
  detail?: string;
  persistent: boolean;
  onDismiss?: () => void;
  onClick?: () => void;
  /** Grows on every push and refresh. */
  seq: number;
}

export const ALERT_DURATION_MS: Record<AlertKind, number> = {
  info: 4000,
  success: 4000,
  warning: 6000,
  error: 8000,
};

let entries: readonly AlertEntry[] = [];
let nextSeq = 1;
let nextId = 1;
const listeners = new Set<() => void>();

function commit(next: readonly AlertEntry[]): void {
  entries = next;
  listeners.forEach((l) => l());
}

function push(kind: AlertKind, title: string, opts: AlertOptions = {}): string {
  const id = opts.id ?? `alert-${nextId++}`;
  const entry: AlertEntry = {
    id,
    kind,
    title,
    detail: opts.detail,
    persistent: opts.persistent ?? false,
    onDismiss: opts.onDismiss,
    onClick: opts.onClick,
    seq: nextSeq++,
  };
  const index = entries.findIndex((e) => e.id === id);
  if (index === -1) {
    commit([...entries, entry]);
  } else {
    const next = entries.slice();
    next[index] = entry;
    commit(next);
  }
  return id;
}

/** Removes an entry; returns it, or `undefined` when the id was not live. */
function remove(id: string): AlertEntry | undefined {
  const entry = entries.find((e) => e.id === id);
  if (entry) commit(entries.filter((e) => e !== entry));
  return entry;
}

export const alerts: { [K in AlertKind]: (title: string, opts?: AlertOptions) => string } & {
  dismiss(id: string): void;
} = {
  error: (title, opts) => push("error", title, opts),
  warning: (title, opts) => push("warning", title, opts),
  info: (title, opts) => push("info", title, opts),
  success: (title, opts) => push("success", title, opts),
  /** Programmatic removal — does NOT call `onDismiss`. */
  dismiss: (id) => {
    remove(id);
  },
};

/** The × / swipe path: removes the entry and calls its `onDismiss`. */
export function userDismissAlert(id: string): void {
  remove(id)?.onDismiss?.();
}

/** The click / Enter / Space path: removes the entry and calls its `onClick`, never `onDismiss`. */
export function userActivateAlert(id: string): void {
  remove(id)?.onClick?.();
}

export function subscribeAlerts(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Same reference until something changes, as `useSyncExternalStore` needs. */
export function getAlertsSnapshot(): readonly AlertEntry[] {
  return entries;
}

export function __resetAlertsForTests(): void {
  entries = [];
  nextSeq = 1;
  nextId = 1;
  listeners.clear();
}
