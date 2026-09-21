/**
 * The client half of the preference store: one synchronous read, one
 * fire-and-forget write, for every declaration in the registry.
 *
 * Reads must be synchronous because every consumer reads inside a
 * `useState(() => …)` initializer — see design.md's "Boot and delivery". A
 * portable value therefore comes from `window.__PAVILIO_PREFS__`, which
 * `GET /api/preferences.js` assigns from a parser-blocking script before any
 * application code runs; a non-portable one comes from `localStorage`, or from
 * `sessionStorage` when the declaration asks for the narrower tier.
 *
 * Writes go the other way round: the in-memory document is updated first and
 * subscribers are notified immediately, so a resize handle tracks the pointer,
 * and the PATCH follows on a debounce.
 *
 * The realtime channel is imported here even though the registry otherwise sits
 * *under* the features: `features/realtime/channel` imports nothing, so it is
 * infrastructure rather than a feature, and reusing it is what keeps the panel
 * on one socket.
 */
import { subscribeRealtime } from "../features/realtime/channel";
import { storageKey, type PreferenceDef } from "./types";

import type { RealtimeFrame } from "../features/realtime/channel";

declare global {
  /**
   * The workspace preferences document, injected into the page by
   * `GET /api/preferences.js`. Absent in node, and absent in any page whose
   * request for that script failed — a 401 behind `PANEL_TOKEN`, most often.
   * That difference is load-bearing: see `portableDoc`.
   */
  // `var`, not `const`/`let`: only a `var` declaration puts the name on
  // `globalThis`, which is how this is read (there may be no `window`).
  var __PAVILIO_PREFS__: Record<string, unknown> | undefined;
}

/**
 * How long writes accumulate before one PATCH carries them. Long enough to
 * collapse a drag gesture into a single request, short enough that a tab closed
 * right after a click still lands the click. The server debounces the *file*
 * write again on top of this.
 */
export const PREFERENCE_PATCH_DEBOUNCE_MS = 200;

const PATCH_URL = "/api/preferences";
const SCRIPT_URL = "/api/preferences.js";

/**
 * The assignment `GET /api/preferences.js` emits. The document is one line —
 * `JSON.stringify` escapes every newline inside a string — so `.` stopping at
 * the line end is exactly the right boundary.
 */
const PREFS_ASSIGNMENT = /^window\.__PAVILIO_PREFS__\s*=\s*(.+);$/m;

type Listener = () => void;

/** Subscribers by storage key, so a frame wakes only the hooks that care. */
const listeners = new Map<string, Set<Listener>>();
/** Keys written since the last PATCH. `null` means "delete", as on the wire. */
let pending: Record<string, unknown> | null = null;
let patchTimer: ReturnType<typeof setTimeout> | null = null;
let channelUnsubscribe: (() => void) | null = null;

/**
 * The injected document, or `undefined` when the script never ran.
 *
 * The distinction is the whole interlock: `{ version: 1 }` is a legitimately
 * empty document and writes against it are normal, while an absent global means
 * this page knows *nothing* about the stored file. Writing then would PATCH the
 * declared defaults over the user's real values — data loss rather than
 * degradation — so `writePreference` refuses instead.
 */
function portableDoc(): Record<string, unknown> | undefined {
  const doc = (globalThis as { __PAVILIO_PREFS__?: unknown }).__PAVILIO_PREFS__;
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return undefined;
  return doc as Record<string, unknown>;
}

/**
 * The browser store backing a non-portable declaration, or `undefined` when the
 * browser refuses to hand one over (private mode, blocked site data).
 */
function browserStorage(def: PreferenceDef<unknown>): Storage | undefined {
  try {
    return def.browserStore === "session" ? globalThis.sessionStorage : globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * The text a codec parses, from whatever the document holds.
 *
 * The file is hand-readable and hand-seeded, so a boolean is stored as `true`
 * and a width as `240`, not as `"true"` and `"240"` — while the codecs speak
 * text, because `localStorage` does. A stored string is already that text; any
 * other JSON value becomes its own literal, which is what every codec here
 * reads back.
 */
function toRaw(stored: unknown): string {
  return typeof stored === "string" ? stored : JSON.stringify(stored);
}

/** The inverse of `toRaw`: the JSON shape a value is stored in. */
function toStored<T>(def: PreferenceDef<T>, value: T): unknown {
  const raw = def.codec.serialize(value);
  // A string-valued preference is its own text, so it is stored verbatim.
  // Re-parsing it would turn a `str` preference holding "true" into a boolean
  // and a remembered query of "240" into a number.
  if (typeof def.default === "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // A codec whose output is not JSON. None ships today; storing the text is
    // the honest fallback, and `toRaw` reads it straight back.
    return raw;
  }
}

function notify(key: string): void {
  // Copy first: a listener may unsubscribe while being notified.
  for (const listener of [...(listeners.get(key) ?? [])]) listener();
}

/** The current value of `def`, from wherever the declaration says it lives. */
export function readPreference<T>(def: PreferenceDef<T>, scopeArg?: string): T {
  const key = storageKey(def, scopeArg);

  let stored: unknown;
  if (def.portable) {
    stored = portableDoc()?.[key];
  } else {
    try {
      stored = browserStorage(def)?.getItem(key) ?? undefined;
    } catch {
      // Private-mode browsers throw on access rather than answering null.
      return def.default;
    }
  }

  if (stored === undefined || stored === null) return def.default;
  try {
    return def.codec.parse(toRaw(stored));
  } catch {
    // A value from an older panel, a hand-edit, or a past write that crossed
    // two keys. The default is always something the UI can render.
    return def.default;
  }
}

/**
 * Remember `value`. Visible to the next `readPreference` immediately; persisted
 * on a debounce. A portable write from a page that never received the injected
 * document is dropped — see `portableDoc`.
 */
export function writePreference<T>(def: PreferenceDef<T>, value: T, scopeArg?: string): void {
  const key = storageKey(def, scopeArg);

  if (def.portable) {
    const doc = portableDoc();
    if (!doc) return;
    const stored = toStored(def, value);
    doc[key] = stored;
    queuePatch(key, stored);
  } else {
    try {
      browserStorage(def)?.setItem(key, def.codec.serialize(value));
    } catch {
      // A full quota or a private-mode refusal. A preference is a choice, not
      // data: losing it makes the next session worse, not broken.
    }
  }

  notify(key);
}

/** Forget a stored value so the next read returns the declared default. */
export function clearPreference(def: PreferenceDef<unknown>, scopeArg?: string): void {
  const key = storageKey(def, scopeArg);

  if (def.portable) {
    const doc = portableDoc();
    if (!doc) return;
    delete doc[key];
    // `null` is the server store's delete.
    queuePatch(key, null);
  } else {
    try {
      browserStorage(def)?.removeItem(key);
    } catch {
      /* nothing was stored to begin with */
    }
  }

  notify(key);
}

/**
 * Call `listener` whenever this preference changes — through another hook's
 * write, or through a `preferences-change` frame from another tab. Returns the
 * unsubscribe. The first subscriber attaches the store to the realtime channel;
 * the last one to leave detaches it again.
 */
export function subscribePreference(
  def: PreferenceDef<unknown>,
  scopeArg: string | undefined,
  listener: Listener,
): () => void {
  const key = storageKey(def, scopeArg);
  let forKey = listeners.get(key);
  if (!forKey) {
    forKey = new Set();
    listeners.set(key, forKey);
  }
  forKey.add(listener);
  if (!channelUnsubscribe) channelUnsubscribe = subscribeRealtime(onFrame);

  return () => {
    forKey.delete(listener);
    if (forKey.size === 0) listeners.delete(key);
    // Detaching rather than latching: a store left permanently "attached" past
    // a channel teardown would be deaf for the rest of the tab.
    if (listeners.size === 0 && channelUnsubscribe) {
      channelUnsubscribe();
      channelUnsubscribe = null;
    }
  };
}

function queuePatch(key: string, value: unknown): void {
  pending ??= {};
  pending[key] = value;
  if (patchTimer) return;
  patchTimer = setTimeout(flushPatch, PREFERENCE_PATCH_DEBOUNCE_MS);
}

function flushPatch(): void {
  patchTimer = null;
  const body = pending;
  pending = null;
  if (!body) return;

  void fetch(PATCH_URL, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    })
    .catch((err: unknown) => {
      // No rollback and no retry, deliberately. The in-memory value is what the
      // user asked for, so the session stays coherent and the next write of any
      // key still carries the latest state; yanking a pane back to its old
      // width seconds after the drag would be worse than a lost write. A retry
      // queue would be worse again — it can race a newer write and resurrect a
      // value the user has since changed. Durability here is best-effort by
      // design (design.md, "Writing"), and a reload re-reads the server's doc.
      console.warn("[preferences] patch failed; keeping the local value:", err);
    });
}

function onFrame(frame: RealtimeFrame): void {
  if (frame.type !== "preferences-change") return;
  const keys = Array.isArray(frame.keys)
    ? frame.keys.filter((key): key is string => typeof key === "string")
    : [];
  if (keys.length === 0) return;
  void refresh(keys);
}

/**
 * Re-read the whole document and wake the hooks watching `keys`.
 *
 * The frame names keys but carries no values — the server broadcasts what
 * changed, not what it changed to — so the document has to come back over the
 * wire, from the same route the page booted from. A failed refetch notifies
 * nobody: re-rendering with values known to be stale is worse than late.
 */
async function refresh(keys: string[]): Promise<void> {
  // The interlock again: a page with no document of its own has no business
  // inventing one from a frame it happens to overhear.
  if (!portableDoc()) return;

  const doc = await fetchDocument();
  if (doc === undefined) return;

  // Writes made while the refetch was in flight win: they are newer than what
  // the server answered with, and their own PATCH is still queued.
  (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> }).__PAVILIO_PREFS__ = {
    ...doc,
    ...(pending ?? {}),
  };

  for (const key of keys) notify(key);
}

async function fetchDocument(): Promise<Record<string, unknown> | undefined> {
  try {
    const res = await fetch(SCRIPT_URL);
    if (!res.ok) return undefined;
    const match = PREFS_ASSIGNMENT.exec(await res.text());
    if (!match) return undefined;
    const parsed: unknown = JSON.parse(match[1]);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    // Offline, a 401 after the cookie expired, or a body this panel cannot
    // read. The in-memory document stays as it was.
    return undefined;
  }
}

/**
 * Test-only teardown: drops every subscriber, the channel attachment and any
 * write still waiting on the debounce. The store is a tab-scoped singleton, so
 * without this a suite leaks its pending PATCH into the next one.
 */
export function __resetPreferenceStoreForTests(): void {
  listeners.clear();
  pending = null;
  if (patchTimer) clearTimeout(patchTimer);
  patchTimer = null;
  channelUnsubscribe?.();
  channelUnsubscribe = null;
}
