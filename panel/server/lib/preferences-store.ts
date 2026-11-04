// Workspace preferences, read once at boot and held in memory.
//
// The file is a human-diffable JSON document: `version` first, every other key
// sorted, one key per line. It lives in the data repo, so auto-sync commits it
// — a stable key order keeps those commits to the keys that actually changed.
//
// Writes are debounced (a UI toggle usually arrives as a burst) and committed
// by renaming a sibling temp file over the target, so a concurrent reader
// never observes a half-written document.
//
// Three things the file is protected from, because it is shared state that
// outlives the process and travels between machines:
//   - a value JSON cannot represent (`undefined`, a function, a symbol, a
//     BigInt, a circular object) never reaches it — it would emit a bare
//     `undefined` token and the whole document would fail to parse on the
//     next boot. Such a key is ignored with a warning, never stored and never
//     deleted: `null` is the delete verb, and it is the only one;
//   - a failed write is remembered, not swallowed, so the next flush retries;
//   - a document written by a newer panel is never rewritten in an older
//     panel's format.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface PreferencesDoc {
  /** Format marker. This panel writes — and only writes — `CURRENT_VERSION`. */
  version: number;
  [key: string]: unknown;
}

/** Debounce window for writes. Long enough to collapse a burst of UI toggles
 *  (a drag on a slider, a pane resize), short enough that a crash loses at
 *  most a quarter second of intent. Shutdown always calls flushPreferences(). */
const WRITE_DEBOUNCE_MS = 250;

/** The only format this panel knows how to write. */
const CURRENT_VERSION = 1;

const emptyDoc = (): PreferencesDoc => ({ version: CURRENT_VERSION });

let doc: PreferencesDoc = emptyDoc();
let targetPath = "";
let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> | null = null;
let dirty = false;
let tmpSeq = 0;
let refusalLogged = false;
const unstorableWarned = new Set<string>();

/**
 * Read the document at `path` into memory. Boot-time and synchronous; never
 * throws — a missing, empty or malformed file simply yields
 * `{ version: CURRENT_VERSION }`, because a broken preferences file must not
 * keep the panel from starting.
 *
 * `path` is this machine's own file. When it does not exist yet, `seed` names
 * where a first boot copies from (design D5), in order: the mirror machine's
 * committed per-machine file, then the legacy shared `.pavilio/preferences.json`
 * (migration). The first one that parses to a JSON object is loaded and written
 * to `path` straight away; a missing or malformed seed falls through to the
 * next, ending at the defaults. A seed file is only ever read — every later
 * write goes to `path`. An own file that exists is loaded as-is (malformed
 * included) and no seed is read.
 *
 * A `version` this panel does not know (any integer above `CURRENT_VERSION`)
 * is kept exactly as found and makes the store read-only — see `isReadOnly`.
 */
export function loadPreferences(
  path: string,
  seed?: { mirrorPath?: string; legacyPath?: string },
): PreferencesDoc {
  targetPath = path;
  doc = emptyDoc();
  refusalLogged = false;
  unstorableWarned.clear();
  if (!path) return doc;
  if (existsSync(path)) {
    doc = readDoc(path) ?? emptyDoc();
    return doc;
  }
  for (const source of [seed?.mirrorPath, seed?.legacyPath]) {
    if (!source || source === path) continue;
    const seeded = readDoc(source);
    if (!seeded) continue;
    doc = seeded;
    seedOwnFile(path, source);
    break;
  }
  return doc;
}

/** The document at `path`, or undefined when it is missing, unreadable or not a JSON object. */
export function readDoc(path: string): PreferencesDoc | undefined {
  try {
    if (!existsSync(path)) return undefined;
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    return { ...record, version: normalizeVersion(record.version) };
  } catch {
    return undefined;
  }
}

/** Persist a freshly seeded doc to the own path, synchronously (boot). A copy,
 *  not a rewrite, so it is written whatever its version. On failure the doc
 *  stays pending and the next flush retries — the panel still starts. */
function seedOwnFile(path: string, source: string): void {
  const tmp = `${path}.tmp.${process.pid}.${++tmpSeq}`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, serialize(doc), "utf8");
    renameSync(tmp, path);
    console.log(`[preferences] seeded ${path} from ${source}`);
  } catch (err) {
    rmSync(tmp, { force: true });
    dirty = true;
    console.error(`[preferences] seeding ${path} from ${source} failed:`, err);
  }
}

/** The in-memory document. */
export function getPreferences(): PreferencesDoc {
  return doc;
}

/** This machine's own file — where every write goes ("" before a load). */
export function getPreferencesPath(): string {
  return targetPath;
}

/**
 * Replace the whole in-memory document with `next` and write it to the own
 * file now — "Copy preferences from <machine>" (design D4). Not a merge: a key
 * only the old document had is gone. Like a boot seed it is a copy, so it is
 * written whatever its version (a newer one then makes the store read-only).
 * Any pending patch is superseded. Resolves once the file is on disk, because
 * the caller reloads the page next and preferences are read once (ADR-0015);
 * rejects when the write fails, with the document kept pending for a retry.
 */
export async function replacePreferences(next: Record<string, unknown>): Promise<PreferencesDoc> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  while (inFlight) await inFlight;
  doc = { ...next, version: normalizeVersion(next.version) };
  dirty = false;
  refusalLogged = false;
  unstorableWarned.clear();
  if (!targetPath) return doc;
  // Registered as the in-flight write, like flushPreferences' own: a patch that
  // lands meanwhile flushes only after this rename, so it is never overtaken.
  const write = writeNow(targetPath, serialize(doc))
    .catch((err: unknown) => {
      dirty = true;
      throw err;
    })
    .finally(() => {
      inFlight = null;
    });
  inFlight = write.catch(() => {});
  await write;
  return doc;
}

/**
 * Shallow-merge `patch` into the in-memory document and schedule a write.
 * A `null` value deletes its key — the one delete verb, and the only one a
 * caller can reach over HTTP. A value JSON cannot represent (`undefined`, a
 * function, a symbol, a BigInt, a circular object — see `asJson`) is ignored
 * with a warning: the stored value stays as it was. `version` is not
 * patchable. The merged doc is returned and readable immediately, long before
 * the write lands.
 */
export function patchPreferences(patch: Record<string, unknown>): PreferencesDoc {
  const next: PreferencesDoc = { ...doc, version: doc.version };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "version") continue;
    if (value === null) {
      delete next[key];
      continue;
    }
    // `undefined` is what `{ theme: getTheme() }` produces in ordinary TS when
    // the getter returns nothing, and `JSON.parse` never yields it — so this
    // branch is unreachable from HTTP and means an in-process slip, not an
    // intent to delete. Honouring it as a delete would turn that slip into
    // silent data loss; ignoring it turns it into a visible warning.
    if (asJson(value) === undefined) {
      warnUnstorable(key, value);
      continue;
    }
    next[key] = value;
  }
  doc = next;
  scheduleWrite();
  return doc;
}

/**
 * Write any pending change now. Resolves once the document on disk matches the
 * one in memory. A no-op when nothing is pending, so calling it on top of an
 * already-fired debounce does not write twice. Never rejects: a failed write
 * is logged, not thrown, so shutdown is not blocked by a full disk — but it
 * stays pending, so a later flush retries it.
 */
export async function flushPreferences(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  // Let a write that is already running finish before deciding what is left.
  while (inFlight) await inFlight;
  if (!dirty || !targetPath) return;
  if (!canWrite()) {
    dirty = false;
    return;
  }
  dirty = false;
  const write = writeNow(targetPath, serialize(doc))
    .catch((err) => {
      // The change exists only in memory. Forgetting it here is how a single
      // transient EPERM/ENOSPC turns into permanent data loss, so put it back
      // on the pending pile: the next flush — shutdown's included — retries.
      dirty = true;
      console.error("[preferences] write failed:", err);
    })
    .finally(() => {
      inFlight = null;
    });
  inFlight = write;
  await write;
}

/** Drop all module state — in-memory doc, target path and any pending write. */
export function _resetPreferencesForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  inFlight = null;
  dirty = false;
  doc = emptyDoc();
  targetPath = "";
  refusalLogged = false;
  unstorableWarned.clear();
}

/**
 * A `version` this panel wrote or can safely adopt. Anything newer is left
 * alone; anything else — missing, a string, a fraction, zero — is the
 * empty/legacy case and normalizes to the current version.
 */
function normalizeVersion(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > CURRENT_VERSION
    ? value
    : CURRENT_VERSION;
}

/**
 * Whether the loaded document is one this panel must not rewrite. A file
 * stamped with a newer version was written by a newer panel and is shared —
 * through the data repo — with the machine running it; rewriting it in this
 * panel's format would hand that machine back a v1-labelled file full of
 * v2-shaped data. Refusing costs this session's changes; coercing costs the
 * other panel's. Pure: callers may ask as often as they like without spending
 * `canWrite`'s one-time warning.
 */
export function isReadOnly(): boolean {
  return doc.version !== CURRENT_VERSION;
}

/** `!isReadOnly()`, plus a one-time warning the first time a write is refused. */
function canWrite(): boolean {
  if (!isReadOnly()) return true;
  if (!refusalLogged) {
    refusalLogged = true;
    console.warn(
      `[preferences] ${targetPath} declares version ${String(doc.version)}, which is newer than ` +
        `this panel understands (version ${CURRENT_VERSION}): it was written by a newer panel and ` +
        `will not be modified. Preference changes apply to this session only.`,
    );
  }
  return false;
}

function scheduleWrite(): void {
  if (!canWrite()) return;
  dirty = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flushPreferences();
  }, WRITE_DEBOUNCE_MS);
}

/**
 * `value` as JSON text, or `undefined` when JSON has no representation for it.
 * That covers `undefined`, functions and symbols — for which `JSON.stringify`
 * *returns* `undefined` — and circular structures and BigInts, for which it
 * throws. All of them are one class of value: unstorable.
 */
function asJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

/** Name the unstorable value's shape, so the warning says *why* the key was
 *  skipped and not merely that it was. */
function describeUnstorable(value: unknown): string {
  if (value === undefined) return "an undefined value";
  if (typeof value === "function") return "a function";
  if (typeof value === "symbol") return "a symbol";
  if (typeof value === "bigint") return "a BigInt";
  return "a circular structure";
}

/** Once per offending key, not once per patch: a control bound to an
 *  undefined piece of state would otherwise log a line per keystroke. */
function warnUnstorable(key: string, value: unknown): void {
  if (unstorableWarned.has(key)) return;
  unstorableWarned.add(key);
  console.warn(
    `[preferences] ignoring ${JSON.stringify(key)}: ${describeUnstorable(value)} has no JSON ` +
      `representation and cannot be stored. Any value already stored under that key is kept — ` +
      `patch null to delete it.`,
  );
}

/** `version` first, then every other key sorted — one key per line. */
function serialize(d: PreferencesDoc): string {
  const lines = [`  "version": ${JSON.stringify(d.version)}`];
  for (const key of Object.keys(d)
    .filter((k) => k !== "version")
    .sort()) {
    // Belt and braces: `patchPreferences` already ignores unstorable values, so
    // this only fires for a doc assembled some other way. Emitting the line
    // anyway would put a bare `undefined` token in the file and make the whole
    // document unparseable on the next boot.
    const json = asJson(d[key]);
    if (json === undefined) continue;
    lines.push(`  ${JSON.stringify(key)}: ${json}`);
  }
  return `{\n${lines.join(",\n")}\n}\n`;
}

/** Write to a sibling temp file, then rename it over the target — same
 *  filesystem, so the swap is atomic and readers see whole documents only. */
async function writeNow(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${++tmpSeq}`;
  try {
    await writeFile(tmp, text, "utf8");
    await rename(tmp, path);
  } catch (err) {
    // A failed commit must not leave a half-document next to the real one —
    // this directory is a git working tree that auto-sync commits wholesale.
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}
