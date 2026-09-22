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
 * How long writes accumulate before one PATCH carries them.
 *
 * A fixed ceiling, not a resetting debounce: the timer starts at the first
 * write of a burst and later writes join it rather than pushing it back. So a
 * sustained drag lands one PATCH per window instead of nothing at all until the
 * pointer stops, and a tab closed shortly after a click never had to wait
 * longer than this. The server debounces the *file* write again on top of it.
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
/**
 * Keys written since the last flush, waiting on the debounce. Keys, not
 * key/value pairs: the body is built from the document at flush time, so a key
 * re-sent after a failed PATCH carries what it holds *then* and can never
 * resurrect a value the user has since changed.
 */
const pendingKeys = new Set<string>();
/**
 * Keys whose PATCH has left but has not been acknowledged. They are no longer
 * pending and not yet confirmed by the server, so for the length of the
 * round-trip only this set records that the document in hand is ahead of the
 * server's. A refetch landing in that window must not overwrite them.
 */
const inFlightKeys = new Set<string>();
/**
 * The ack clock, and the tick at which each key's PATCH was last acknowledged.
 *
 * `inFlightKeys` protects a key only up to its ack — but the ack is not the
 * moment the key is safe. A refetch whose GET the server ANSWERED before it
 * applied that PATCH can still resolve afterwards, and the document it carries
 * predates the write. By then the key is in neither `pendingKeys` nor
 * `inFlightKeys`, so the overlay in `refresh` would let the older value win and
 * erase a write this page already shows — the mirror of the in-flight race, on
 * the far side of the ack.
 *
 * So a key stays protected past its ack until a refetch that STARTED after that
 * ack has resolved: that one really did ask the server after the write landed,
 * and whatever it answers for the key is the truth. Recording a TICK rather
 * than membership of a set is what makes a re-written key protected again
 * instead of being confirmed by a refetch that only ever saw its previous ack.
 * Entries are dropped the moment a refetch is entitled to confirm them, so
 * another tab's genuine change reaches an idle key on the very next refetch.
 */
let ackClock = 0;
const ackedAt = new Map<string, number>();
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
 * Whether the machine-local tier has already said out loud that it cannot
 * reach browser storage. One warning per tab, not one per call.
 */
let warnedBrowserStorage = false;

/**
 * The non-portable tier's ONLY diagnostic.
 *
 * Before the migration each hook carried its own `console.warn` around its own
 * try/catch — seven of them across `useTerminalOrdering`, `useTerminalMaximized`
 * and `useTerminalSessions`. Centralising storage into this module removed all
 * seven and replaced none, so a private-mode browser dropped every terminal
 * preference write in total silence: the panel looked like it had forgotten
 * nothing, and there was not one line in the console to say otherwise. (The
 * portable tier already had `flushPatch`'s warning; only this tier was mute.)
 *
 * Restored ONCE here rather than seven times at the call sites, and latched
 * rather than per-call: `readPreference` runs on every mount of every consumer,
 * so an un-latched warning in a browser that refuses storage would be a flood
 * that buries whatever the developer opened the console for. One honest line
 * naming the first casualty, and an explicit note that the rest are silent, is
 * the whole budget.
 */
function warnBrowserStorageUnavailable(action: string, key: string, err?: unknown): void {
  if (warnedBrowserStorage) return;
  warnedBrowserStorage = true;
  console.warn(
    `[preferences] browser storage is unavailable; the machine-local tier could not ${action} "${key}". ` +
      "Further machine-local failures this session are silent.",
    err,
  );
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
  // A text codec's output IS the stored text, so it is stored verbatim.
  // Re-parsing it would turn a `str` preference holding "true" into a boolean
  // and a remembered query of "240" into a number.
  //
  // This asks the CODEC, not `typeof def.default`. The default was only ever a
  // proxy for the codec's shape, and it is a lossy one: a portable declaration
  // with a `json<string | null>` codec and a non-string default would take the
  // JSON branch below, store `hello` unquoted, and read back as `null` when
  // `JSON.parse("hello")` throws — a silent data loss with nothing to warn on.
  if (def.codec.storesText === true) return raw;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    // A codec whose output is neither JSON nor declared as text. None ships
    // today; storing the text is the honest fallback, and `toRaw` reads it
    // straight back.
    return raw;
  }
  // A JSON codec whose payload happens to be a bare string. Stored unquoted it
  // would come back through `toRaw` as that text and throw on the way in; the
  // JSON text round-trips instead, at the cost of one pair of quotes in a file
  // where this shape does not currently occur.
  if (typeof parsed === "string") return raw;
  return parsed;
}

/**
 * Structural equality on the STORED representation — the shape `toStored`
 * produces and the document holds, never the caller's object.
 *
 * Reference equality is not enough: a `json` preference is re-serialized from a
 * fresh object on every write, and a value that came back from the server was
 * re-parsed, so two structurally identical objects are never `Object.is`-equal
 * and key order can differ between the two. Both would read as a change and
 * cost a PATCH.
 */
function sameStored(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameStored(item, b[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => key in right && sameStored(left[key], right[key]));
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
    const store = browserStorage(def);
    if (store === undefined) {
      warnBrowserStorageUnavailable("read", key);
      return def.default;
    }
    try {
      stored = store.getItem(key) ?? undefined;
    } catch (err) {
      // Private-mode browsers throw on access rather than answering null.
      warnBrowserStorageUnavailable("read", key, err);
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
 *
 * Writing what is already stored does nothing at all: no document mutation, no
 * PATCH, no notify. That guard is here rather than only at the call sites
 * because the migration changed what a write COSTS — it used to be a
 * `localStorage.setItem` and is now a network round trip and a write to a
 * committed file — so a mount effect or a controlled input echoing its own
 * value now puts the declared default into the workspace file under a key
 * nobody chose. The comparison is against what the STORE holds, never against
 * the declared default: a key the document no longer has (`clearPreference`)
 * is absent, not equal, so putting the same value back is still a real change.
 *
 * WHAT THE SKIP COSTS ON THE PORTABLE TIER. It returns before `queuePatch`, so
 * it arms no debounce timer — and `flushPatch`'s `.catch` deliberately arms
 * none either. A key a failed PATCH put back into `pendingKeys` therefore sits
 * there until the next `queuePatch`, and only three things call it: a CHANGED
 * value of the stranded key, a CHANGED value of any other key, or any portable
 * `clearPreference` (which queues unconditionally). An identical re-write of
 * ANY key skips out here and arms nothing, however often it is repeated. That
 * is acceptable — the value the user sees is already correct, and a reload
 * re-reads the server's — but it is a real narrowing, and this comment has
 * twice claimed more. Pinned by store.test.ts, "identical re-writes after a
 * failed PATCH strand the retry; a changed value rescues it".
 */
export function writePreference<T>(def: PreferenceDef<T>, value: T, scopeArg?: string): void {
  const key = storageKey(def, scopeArg);

  // NaN and the infinities have no JSON form, so `toStored` would fall back to
  // storing the literal text "NaN" in the hand-readable workspace file under a
  // `num` key — where `num.parse` rejects it and every later read answers the
  // declared default anyway. Refusing is the same outcome without the litter.
  //
  // THIS BRANCH NOTIFIES WHERE THE STORAGE `catch` BELOW DELIBERATELY DOES NOT,
  // and the reason inverts. There the writer holds the value the user asked for
  // and only the peers are behind, so waking them would re-read the OLD value
  // into every pane but the one that changed. Here nothing was stored and the
  // WRITER is the one holding garbage — `usePreference`'s setter adopted the
  // NaN before calling in — so the notify sends every hook, the writer
  // included, back to what is actually stored. It corrects the writer rather
  // than merely disturbing its peers.
  if (typeof value === "number" && !Number.isFinite(value)) {
    notify(key);
    return;
  }

  if (def.portable) {
    const doc = portableDoc();
    if (!doc) return;
    const next = toStored(def, value);
    // `key in doc`, not `doc[key] === undefined`: a cleared key is gone from
    // the document, and re-writing its old value has to reach the server as
    // the un-delete it is.
    if (key in doc && sameStored(doc[key], next)) return;
    doc[key] = next;
    queuePatch(key);
  } else {
    const raw = def.codec.serialize(value);
    try {
      const store = browserStorage(def);
      if (store === undefined) {
        warnBrowserStorageUnavailable("write", key);
        return;
      }
      if (store.getItem(key) === raw) return;
      store.setItem(key, raw);
    } catch (err) {
      // A full quota or a private-mode refusal. A preference is a choice, not
      // data: losing it makes the next session worse, not broken. The read
      // above can throw for the same reasons, and lands here too — writing
      // blind would be no better.
      //
      // RETURNING HERE SKIPS THE `notify` BELOW, AND THAT DIVERGES THE HOOKS.
      // Deliberate, but not free. `usePreference`'s setter calls `adopt(next)`
      // *before* `writePreference`, so the hook that wrote keeps the new value
      // in its own React state while every OTHER hook mounted on the same key
      // goes on rendering the old one — the notify that would have re-read
      // them never fires. Notifying instead would be worse: the others would
      // re-read storage, find the old value there, and the writing pane would
      // be the only one showing the change anyway, now with a re-render each
      // to prove it.
      //
      // It self-corrects on the next notify for that key — any later
      // successful write, or a `preferences-change` frame — and on reload,
      // where nothing was stored so everyone reads the same old value.
      warnBrowserStorageUnavailable("write", key, err);
      return;
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
    // The flush turns a key the document no longer holds into a `null` — the
    // server store's delete.
    queuePatch(key);
  } else {
    try {
      browserStorage(def)?.removeItem(key);
    } catch (err) {
      // Nothing was stored to begin with — but a store that throws on
      // `removeItem` is the same broken tier as one that throws on `setItem`,
      // so it goes through the same latched warning rather than adding a
      // second silent path.
      warnBrowserStorageUnavailable("clear", key, err);
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

  // Two tokens rather than one: `released` makes a second call a no-op, and the
  // identity check makes a *stale* one harmless. Without them, unsubscribing
  // twice across a key that emptied and was subscribed to again in between
  // deletes the new subscriber's set from the map and leaves it deaf.
  let released = false;
  return () => {
    if (released) return;
    released = true;
    forKey.delete(listener);
    if (forKey.size === 0 && listeners.get(key) === forKey) listeners.delete(key);
    // Detaching rather than latching: a store left permanently "attached" past
    // a channel teardown would be deaf for the rest of the tab.
    if (listeners.size === 0 && channelUnsubscribe) {
      channelUnsubscribe();
      channelUnsubscribe = null;
    }
  };
}

function queuePatch(key: string): void {
  pendingKeys.add(key);
  if (patchTimer) return;
  patchTimer = setTimeout(flushPatch, PREFERENCE_PATCH_DEBOUNCE_MS);
}

function flushPatch(): void {
  patchTimer = null;
  if (pendingKeys.size === 0) return;
  const doc = portableDoc();
  if (!doc) {
    pendingKeys.clear();
    return;
  }

  const keys = [...pendingKeys];
  pendingKeys.clear();
  for (const key of keys) inFlightKeys.add(key);

  // The body is read off the document NOW rather than accumulated as the writes
  // came in. That is what makes the retry below safe: a key re-sent after a
  // failure carries the value it holds at this flush, so a re-send can never
  // resurrect one the user has since changed. A key the document no longer
  // holds is a `null` — the server store's delete.
  const body: Record<string, unknown> = {};
  for (const key of keys) body[key] = key in doc ? doc[key] : null;

  void fetch(PATCH_URL, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // One tick for the whole batch: the server applied it as one PATCH.
      ackClock += 1;
      for (const key of keys) {
        inFlightKeys.delete(key);
        ackedAt.set(key, ackClock);
      }
    })
    .catch((err: unknown) => {
      // No rollback: the in-memory value is what the user asked for, and
      // yanking a pane back to its old width seconds after the drag would be
      // worse than a lost write. But the key stays dirty, so the next flush
      // re-sends it — the same shape as the server store's own `dirty` retry.
      // Without that, a lost PATCH leaves the key divergent for the whole
      // session and silently reverts on the next reload. No timer is armed
      // here: an offline tab must not turn one failure into a retry loop, and
      // the value is already correct everywhere the user can see it.
      for (const key of keys) {
        inFlightKeys.delete(key);
        pendingKeys.add(key);
      }
      console.warn("[preferences] patch failed; keeping the local value:", err);
    });
}

/**
 * Refetch sequencing. Every refetch takes the next generation; only the answer
 * to the newest one is applied, and the keys a superseded refetch was going to
 * wake ride along in `pendingNotifications` so nothing is silently dropped.
 */
let refreshGeneration = 0;
const pendingNotifications = new Set<string>();

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

  for (const key of keys) pendingNotifications.add(key);
  // Sequencing, not merely de-duplication. Two frames start two fetches and the
  // server may answer them in either order; without this the *older* document
  // can land last and walk the store backwards. Only the newest request's
  // answer is applied, and it carries every key the superseded ones named.
  const generation = ++refreshGeneration;
  // The clock as it stood when this GET left. A key acked at or before this
  // tick had already been applied when the server built its answer; one acked
  // later had not, whatever the answer says about it. Read here rather than
  // after the await, because that is when the request goes out.
  const askedAt = ackClock;
  const doc = await fetchDocument();
  if (generation !== refreshGeneration) return;
  if (doc === undefined) return;

  // This page's own unconfirmed writes win over what the server answered with.
  // `pendingKeys` have not been sent at all; `inFlightKeys` are racing this
  // very refetch; and `ackedAt` covers the window the other two miss — a key
  // whose ack landed AFTER this GET was issued is acked but not yet reflected
  // in the document in hand. Overlaying only the first two is what let a
  // just-acked write be reverted in memory while a mounted hook still rendered
  // the new value.
  const local = portableDoc() ?? {};
  const merged: Record<string, unknown> = { ...doc };
  const protectedKeys = new Set([...pendingKeys, ...inFlightKeys]);
  for (const [key, tick] of ackedAt) {
    if (tick > askedAt) protectedKeys.add(key);
    // This refetch asked after that ack, so it is entitled to confirm the key:
    // forget the tick and let the server speak for it from now on. Without
    // this, a key would be shielded forever and another tab's change could
    // never reach this page.
    else ackedAt.delete(key);
  }
  for (const key of protectedKeys) {
    if (key in local) merged[key] = local[key];
    else delete merged[key];
  }
  (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> }).__PAVILIO_PREFS__ = merged;

  const woken = [...pendingNotifications];
  pendingNotifications.clear();
  for (const key of woken) notify(key);
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
 * Test-only teardown: drops every subscriber, the channel attachment, any write
 * still waiting on the debounce or on an unacknowledged PATCH, and any refetch
 * in flight. The store is a tab-scoped singleton, so without this a suite leaks
 * its pending PATCH into the next one.
 */
export function __resetPreferenceStoreForTests(): void {
  listeners.clear();
  pendingKeys.clear();
  inFlightKeys.clear();
  ackedAt.clear();
  ackClock = 0;
  pendingNotifications.clear();
  // The machine-local warning is latched for the life of the tab, so without
  // this the first suite to hit a refusing store would silence every later
  // one's assertion that the tier still says something.
  warnedBrowserStorage = false;
  // Bumping the generation discards any refetch still in flight, so a response
  // arriving after the reset cannot write into the next suite's document.
  refreshGeneration += 1;
  if (patchTimer) clearTimeout(patchTimer);
  patchTimer = null;
  channelUnsubscribe?.();
  channelUnsubscribe = null;
}
