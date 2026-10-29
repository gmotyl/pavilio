/**
 * The browser side of the page audio cache: a page's units, once synthesized,
 * are kept on the panel server (`/api/speech/page-cache`) so the next Play of
 * the same page answers from disk instead of the engine.
 *
 * This module sits beside the seam and never builds an anytts instance —
 * `synth.ts` stays the only synthesizer. A page is addressed by the SHA-256
 * hex of its doc key, a unit by the SHA-256 hex of its `text`.
 *
 * Two things are kept per page, keyed by the doc key itself:
 * - the *listed* units — what the server holds (hash → size), from the list
 *   fetch, a fetched hit or a landed upload;
 * - the units *in hand* — their bytes, fetched or uploaded this session.
 * A listed unit is `warming` until its bytes are in hand, then `ready`. Both
 * are dropped when the page is cleared or the cache wiped, so bytes are held
 * no longer than the page's cache lives.
 *
 * Hashing is async (`crypto.subtle`) but {@link pageUnitState} and
 * {@link pageCachedShare} are read on render, so they are synchronous: each
 * text's hash is memoized once computed, and a unit whose text has not been
 * hashed yet reads as unknown (not cached). {@link prunePage} hashes every
 * current unit, and the page run calls it right after {@link loadPageList},
 * so from then on the page's units answer synchronously.
 *
 * Hashing needs `crypto.subtle`, which exists only in a secure context
 * (https or localhost) — the panel also serves plain http on the LAN, where it
 * is missing. Without a hash the cache steps aside rather than break playback:
 * {@link pageAudio} synthesizes straight through (no fetch, no upload),
 * {@link loadPageList} and {@link prunePage} resolve without a request, the
 * synchronous readers report nothing cached, and {@link clearPage} — which
 * cannot name the page on disk — rebuilds the speech cache and rejects with
 * the reason. {@link wipeCache} needs no hash and works as ever. It warns once.
 *
 * Clearing races in-flight work: a synthesis or fetch that lands after its
 * page was cleared (or the cache wiped) still answers its caller, but is
 * neither uploaded nor recorded. Every scope carries a generation — one per
 * page plus one global — taken when the work starts and checked before
 * anything lands.
 *
 * Concurrent asks for one unit (the run's lookahead warm and its ladder, a
 * preload and a Play) share one disk fetch and one upload: both are keyed by
 * generation and URL, so a clear or a wipe never hands a flight from before it
 * to a caller after it. The synthesis itself is not shared here — each caller
 * asks `synth.ts` on its own tier and signal, which is what lets a run promote
 * a unit a preload queued, and the library dedupes the flight.
 */
import { resetSpeechCache, synthesizeSpeech, SPEECH_AUDIO_MIME_TYPE, type SpeechSynthesisOptions } from "./synth";
import type { SpeechCacheState } from "./synth";
import type { SpeechUnit } from "./types";

/** What the server reports for the whole cache — and what a wipe freed. */
export interface PageCacheTotals {
  pages: number;
  units: number;
  bytes: number;
}

const BASE_URL = "/api/speech/page-cache";

/** text (or doc key) → its SHA-256 hex. Content-derived, so never invalidated. */
const hashes = new Map<string, string>();
/** doc key → unit hash → size on disk. */
const listed = new Map<string, Map<string, number>>();
/** doc key → unit hash → bytes in hand. */
const inHand = new Map<string, Map<string, ArrayBuffer>>();
/** doc key → generation, bumped by a clear of that page. */
const pageGenerations = new Map<string, number>();
/** Bumped by a wipe, which clears every page at once. */
let globalGeneration = 0;
/** Upload failure kinds already warned about, so a broken server warns once per kind. */
const warnedKinds = new Set<string>();
const listeners = new Set<() => void>();
/** `generation\0url` → the disk fetch in flight: its bytes, or `null` for a miss. */
const fetching = new Map<string, Promise<ArrayBuffer | null>>();
/** `generation\0url` of every upload in flight, so a unit synthesized twice uploads once. */
const uploading = new Set<string>();

const NO_HASHING = "page cache unavailable: crypto.subtle needs a secure context (https or localhost)";

/** The text's SHA-256 hex, or `null` when this origin cannot hash (warned once). */
async function sha256Hex(text: string): Promise<string | null> {
  const known = hashes.get(text);
  if (known) return known;
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error(NO_HASHING);
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    hashes.set(text, hex);
    return hex;
  } catch (err) {
    if (!warnedKinds.has("hashing")) {
      warnedKinds.add("hashing");
      console.warn("[speech] page cache off: cannot hash on this origin; pages synthesize as usual", err);
    }
    return null;
  }
}

function generation(docKey: string): string {
  return `${globalGeneration}:${pageGenerations.get(docKey) ?? 0}`;
}

function entries<V>(maps: Map<string, Map<string, V>>, docKey: string): Map<string, V> {
  let map = maps.get(docKey);
  if (!map) {
    map = new Map();
    maps.set(docKey, map);
  }
  return map;
}

/**
 * Tells subscribers the answers changed. Iterates a snapshot and logs a
 * throwing listener instead of re-throwing — the same round `synth.ts` runs.
 */
function notify(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (err) {
      console.error("[speech] page cache listener threw; continuing the round", err);
    }
  }
}

/** Subscribes to page cache changes; returns the unsubscribe. */
export function subscribePageCache(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A failed response as an error naming its status, or the thrown error as is. */
async function send(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${url} answered ${res.status}`);
  return res;
}

/**
 * Fills the page's listed units from the server. A failed list leaves the
 * page with nothing cached: playback then synthesizes as if there were no
 * cache.
 */
export async function loadPageList(docKey: string): Promise<void> {
  const gen = generation(docKey);
  const page = await sha256Hex(docKey);
  if (page === null) return;
  let units: Map<string, number>;
  try {
    const body: unknown = await (await send(`${BASE_URL}/${page}`)).json();
    units = new Map(listedUnits(body));
  } catch {
    units = new Map();
  }
  if (gen !== generation(docKey)) return;
  listed.set(docKey, units);
  // Bytes in hand for a unit the server no longer holds would read `ready` for a miss.
  const held = inHand.get(docKey);
  if (held) for (const hash of held.keys()) if (!units.has(hash)) held.delete(hash);
  notify();
}

function listedUnits(body: unknown): [string, number][] {
  const units = (body as { units?: unknown } | null)?.units;
  if (!Array.isArray(units)) throw new Error("not a unit list");
  return units
    .filter(
      (u): u is { hash: string; bytes: number } =>
        typeof u?.hash === "string" && typeof u?.bytes === "number",
    )
    .map((u) => [u.hash, u.bytes]);
}

/**
 * Tells the server to keep only the page's current units, and mirrors that
 * locally. Hashes every unit on the way, which is what lets the synchronous
 * readers answer for them. A failed prune is ignored: the orphans wait for the
 * next Play.
 */
export async function prunePage(docKey: string, units: readonly SpeechUnit[]): Promise<void> {
  const gen = generation(docKey);
  const page = await sha256Hex(docKey);
  const hashed = await Promise.all(units.map((unit) => sha256Hex(unit.text)));
  if (page === null || hashed.some((hash) => hash === null)) return;
  const keep = hashed as string[];
  try {
    await send(`${BASE_URL}/${page}/prune`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keep }),
    });
  } catch {
    // The unit hashes are memoized either way, so the readers still answer.
    notify();
    return;
  }
  if (gen !== generation(docKey)) return;
  const kept = new Set(keep);
  for (const map of [listed.get(docKey), inHand.get(docKey)]) {
    if (map) for (const hash of map.keys()) if (!kept.has(hash)) map.delete(hash);
  }
  notify();
}

/**
 * The unit's audio: from disk when the server holds it, otherwise synthesized
 * and uploaded in the background. A fetch failure of any kind (network, 404,
 * 503, empty body) is a miss; an upload failure never rejects. Like
 * `synthesizeSpeech`, the buffer may be handed out again — wrap it with
 * `toSpeechBlob` (which copies) and never detach or transfer it.
 */
export async function pageAudio(
  docKey: string,
  unit: SpeechUnit,
  options: SpeechSynthesisOptions,
): Promise<ArrayBuffer> {
  const gen = generation(docKey);
  const [page, hash] = await Promise.all([sha256Hex(docKey), sha256Hex(unit.text)]);
  if (page === null || hash === null) return synthesizeSpeech(unit.text, options);
  const held = inHand.get(docKey)?.get(hash);
  if (held) return held;

  const url = `${BASE_URL}/${page}/${hash}`;
  const cached = await untilAborted(diskFetch(docKey, gen, url, hash), options.signal);
  if (cached) return cached;

  const bytes = await synthesizeSpeech(unit.text, options);
  if (gen === generation(docKey)) void upload(docKey, gen, url, hash, bytes);
  return bytes;
}

/**
 * The unit's bytes from disk, or `null` for a miss of any kind (network, 404,
 * 503, empty body). Shared by every caller asking in the same generation, so
 * it carries no caller's signal: a local GET is cheap to let finish, and each
 * caller stops waiting on its own signal instead ({@link untilAborted}).
 */
function diskFetch(docKey: string, gen: string, url: string, hash: string): Promise<ArrayBuffer | null> {
  const key = `${gen}\0${url}`;
  const inFlight = fetching.get(key);
  if (inFlight) return inFlight;
  const flight = (async (): Promise<ArrayBuffer | null> => {
    try {
      const bytes = await (await send(url)).arrayBuffer();
      if (bytes.byteLength === 0) return null;
      if (gen === generation(docKey)) {
        entries(listed, docKey).set(hash, bytes.byteLength);
        entries(inHand, docKey).set(hash, bytes);
        notify();
      }
      return bytes;
    } catch {
      return null;
    } finally {
      fetching.delete(key);
    }
  })();
  fetching.set(key, flight);
  return flight;
}

/** `work`, unless `signal` aborts first — then its reason, as `fetch` would reject. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function upload(
  docKey: string,
  gen: string,
  url: string,
  hash: string,
  bytes: ArrayBuffer,
): Promise<void> {
  const key = `${gen}\0${url}`;
  // Another caller's upload of this unit is out, or has landed already.
  if (uploading.has(key) || inHand.get(docKey)?.has(hash)) return;
  uploading.add(key);
  try {
    await send(url, {
      method: "PUT",
      // The server parses JSON bodies globally; audio must not look like JSON.
      // The doc key is percent-encoded: a header value must be Latin-1, and
      // page paths may be anything.
      headers: { "Content-Type": SPEECH_AUDIO_MIME_TYPE, "x-doc-key": encodeURIComponent(docKey) },
      body: bytes,
    });
  } catch (err) {
    const kind = err instanceof Error && / answered (\d+)$/.exec(err.message)?.[1];
    warnOnce(kind ? `http ${kind}` : "network", err);
    return;
  } finally {
    uploading.delete(key);
  }
  if (gen !== generation(docKey)) return;
  entries(listed, docKey).set(hash, bytes.byteLength);
  entries(inHand, docKey).set(hash, bytes);
  notify();
}

function warnOnce(kind: string, err: unknown): void {
  if (warnedKinds.has(kind)) return;
  warnedKinds.add(kind);
  console.warn(`[speech] page cache upload failed (${kind}); playback is unaffected`, err);
}

/**
 * Where the unit stands on disk: `ready` with its bytes in hand, `warming`
 * while listed but not yet fetched, `undefined` when it is not on disk (or its
 * text has not been hashed yet) — then ask `speechCacheState`. `cold` is part
 * of the shared vocabulary but never answered here: a unit not on disk is the
 * synthesizer's to describe.
 */
export function pageUnitState(docKey: string, unit: SpeechUnit): SpeechCacheState | undefined {
  const hash = hashes.get(unit.text);
  if (!hash) return undefined;
  if (inHand.get(docKey)?.has(hash)) return "ready";
  if (listed.get(docKey)?.has(hash)) return "warming";
  return undefined;
}

/** How many of `units` the server holds for the page, and their size — the bar's "N of M cached · size". */
export function pageCachedShare(
  docKey: string,
  units: readonly SpeechUnit[],
): { cached: number; bytes: number } {
  const onDisk = listed.get(docKey);
  let cached = 0;
  let bytes = 0;
  if (!onDisk) return { cached, bytes };
  for (const unit of units) {
    const hash = hashes.get(unit.text);
    const size = hash === undefined ? undefined : onDisk.get(hash);
    if (size === undefined) continue;
    cached += 1;
    bytes += size;
  }
  return { cached, bytes };
}

/**
 * Drops the page from disk and from memory. The local state is emptied and
 * the in-memory speech cache rebuilt even when the server call fails, so the
 * next Play cannot answer from memory; the failure still rejects, with its
 * reason, for the caller to alert — as does an origin that cannot hash, which
 * cannot name the page on disk.
 */
export async function clearPage(docKey: string): Promise<void> {
  pageGenerations.set(docKey, (pageGenerations.get(docKey) ?? 0) + 1);
  listed.delete(docKey);
  inHand.delete(docKey);
  try {
    const page = await sha256Hex(docKey);
    if (page === null) throw new Error(NO_HASHING);
    await send(`${BASE_URL}/${page}`, { method: "DELETE" });
  } finally {
    // Again after the await: work that started meanwhile is dropped too.
    pageGenerations.set(docKey, (pageGenerations.get(docKey) ?? 0) + 1);
    listed.delete(docKey);
    inHand.delete(docKey);
    resetSpeechCache();
    notify();
  }
}

/** The whole cache's totals; rejects when the server cannot say. */
export async function cacheTotals(): Promise<PageCacheTotals> {
  return toTotals(await (await send(BASE_URL)).json());
}

/**
 * Empties the whole cache, on disk and in memory, and resolves to what it
 * freed. Like {@link clearPage}, memory is emptied and the speech cache
 * rebuilt even when the server call fails.
 */
export async function wipeCache(): Promise<PageCacheTotals> {
  globalGeneration += 1;
  listed.clear();
  inHand.clear();
  try {
    return toTotals(await (await send(BASE_URL, { method: "DELETE" })).json());
  } finally {
    globalGeneration += 1;
    listed.clear();
    inHand.clear();
    resetSpeechCache();
    notify();
  }
}

function toTotals(body: unknown): PageCacheTotals {
  const t = body as Partial<PageCacheTotals> | null;
  if (typeof t?.pages !== "number" || typeof t.units !== "number" || typeof t.bytes !== "number") {
    throw new Error("page cache totals malformed");
  }
  return { pages: t.pages, units: t.units, bytes: t.bytes };
}

/** Test-only: forgets every page, hash, warning and listener. */
export function __resetPageCacheForTests(): void {
  hashes.clear();
  listed.clear();
  inHand.clear();
  pageGenerations.clear();
  globalGeneration = 0;
  warnedKinds.clear();
  listeners.clear();
  fetching.clear();
  uploading.clear();
}
