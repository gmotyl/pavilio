import { subscribeRealtime } from "../realtime/channel";
import type { SessionMeta } from "./useTerminalSessions";

const ENDPOINT = "/api/terminal/sessions";
const POLL_MS = 8000;

type Listener = (sessions: SessionMeta[]) => void;

const listeners = new Set<Listener>();

let sessions: SessionMeta[] = [];
let started = false;
let poll: ReturnType<typeof setInterval> | null = null;
let stopRealtime: (() => void) | null = null;
let loadGen = 0;

function notify(listener: Listener): void {
  // Isolated: the store is tab-wide, so one broken consumer must not stop the
  // list reaching the others.
  try {
    listener(sessions);
  } catch (err) {
    console.warn("[terminal] session subscriber threw:", err);
  }
}

/**
 * Shallow per-field, because every `SessionMeta` field is a primitive — and
 * generic over the keys so a field added later is compared too.
 */
function sameSession(a: SessionMeta, b: SessionMeta): boolean {
  const keys = Object.keys(a) as (keyof SessionMeta)[];
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => a[key] === b[key]);
}

/**
 * The id sequence is the cheap gate — an add, a removal or a reorder is a
 * change and stops here. Past it the ids line up, so a changed field (a rename)
 * is the only thing left that can make this a different list.
 */
function isUnchanged(next: SessionMeta[]): boolean {
  if (next.length !== sessions.length) return false;
  if (!next.every((s, i) => s.id === sessions[i].id)) return false;
  return next.every((s, i) => sameSession(s, sessions[i]));
}

/**
 * An unchanged list keeps its array reference, so consumers keying effects off
 * `[sessions]` (per-session activity subscriptions, busy-tracker id lists) do
 * not re-derive everything every poll.
 */
function publish(next: SessionMeta[]): void {
  if (isUnchanged(next)) return;
  sessions = next;
  // Copy first: a listener may unsubscribe while being notified.
  for (const listener of [...listeners]) notify(listener);
}

async function load(): Promise<void> {
  // Overlapping loads are routine — a realtime frame or a refresh lands on top of
  // the poll — and responses can come back out of order. Without this generation
  // stamp the last request to *resolve* wins over the last one issued, so an older
  // list silently overwrites a newer one for the whole tab.
  const gen = ++loadGen;
  let next: SessionMeta[];
  try {
    const res = await fetch(ENDPOINT);
    if (!res.ok) {
      console.warn(`[terminal] session store got ${res.status} from server`);
      return; // keep what we have; the poll will try again
    }
    next = (await res.json()) as SessionMeta[];
  } catch (err) {
    console.warn("[terminal] session store fetch failed:", err);
    return;
  }
  // Superseded by a later load, or fenced off by a reset.
  if (gen !== loadGen) return;
  publish(next);
}

/**
 * The list is tab-scoped, not subscriber-scoped: one fetch, one poll and one
 * realtime refetch serve every surface, and they keep running once the last
 * subscriber leaves so a returning one finds the list already warm.
 */
function start(): void {
  if (started) return;
  started = true;
  void load();
  poll = setInterval(() => void load(), POLL_MS);
  // Covers sessions created or killed elsewhere, plus whatever was missed
  // while the socket was down.
  stopRealtime = subscribeRealtime(() => void load());
}

/**
 * Start listening to the shared cross-project session list. Returns the
 * unsubscribe. The listener is called with the current list right away, because
 * a session list is state rather than an event — a late subscriber that waited
 * for the next poll would render an empty grid for up to 8s.
 */
export function subscribeSessions(listener: Listener): () => void {
  listeners.add(listener);
  notify(listener);
  start();
  return () => {
    listeners.delete(listener);
  };
}

/** Open subscriber count. For tests and diagnostics only. */
export function sessionSubscriberCount(): number {
  return listeners.size;
}

/**
 * The list as last fetched. This is the store's live array, handed out by
 * reference on purpose — the stable identity is what lets consumers skip work on
 * an unchanged republish. Callers must treat it as frozen: an in-place `.sort()`
 * in ordering code would rewrite the stability gate's own baseline, so the store
 * would then compare the next payload against a list it never received and stop
 * publishing real changes. Copy before mutating.
 */
export function getSessions(): SessionMeta[] {
  return sessions;
}

/**
 * Force a refetch; resolves once this load is done with. A load superseded by a
 * later one resolves without publishing — nothing is lost, because the load that
 * superseded it publishes in its place.
 */
export function refreshSessions(): Promise<void> {
  return load();
}

/**
 * Test-only teardown: clears the list, subscribers and the poll. The production
 * path never stops the store, so suites need this to avoid leaking one between
 * files.
 */
export function __resetSessionStoreForTests(): void {
  // A fence, not just a clear: a load still in flight would otherwise land after
  // the reset and republish into the cleared store, leaking one test into the next.
  loadGen += 1;
  started = false;
  sessions = [];
  listeners.clear();
  if (poll) clearInterval(poll);
  poll = null;
  stopRealtime?.();
  stopRealtime = null;
}
