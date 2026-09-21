// Workspace preferences, read once at boot and held in memory.
//
// The file is a human-diffable JSON document: `version` first, every other key
// sorted, one key per line. It lives in the data repo, so auto-sync commits it
// — a stable key order keeps those commits to the keys that actually changed.
//
// Writes are debounced (a UI toggle usually arrives as a burst) and committed
// by renaming a sibling temp file over the target, so a concurrent reader
// never observes a half-written document.

import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface PreferencesDoc {
  version: 1;
  [key: string]: unknown;
}

/** Debounce window for writes. Long enough to collapse a burst of UI toggles
 *  (a drag on a slider, a pane resize), short enough that a crash loses at
 *  most a quarter second of intent. Shutdown always calls flushPreferences(). */
const WRITE_DEBOUNCE_MS = 250;

const emptyDoc = (): PreferencesDoc => ({ version: 1 });

let doc: PreferencesDoc = emptyDoc();
let targetPath = "";
let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> | null = null;
let dirty = false;
let tmpSeq = 0;

/**
 * Read the document at `path` into memory. Boot-time and synchronous; never
 * throws — a missing, empty or malformed file simply yields `{ version: 1 }`,
 * because a broken preferences file must not keep the panel from starting.
 */
export function loadPreferences(path: string): PreferencesDoc {
  targetPath = path;
  doc = emptyDoc();
  try {
    if (existsSync(path)) {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        doc = { ...(parsed as Record<string, unknown>), version: 1 };
      }
    }
  } catch {
    /* unreadable or malformed — fall back to the empty doc */
  }
  return doc;
}

/** The in-memory document. */
export function getPreferences(): PreferencesDoc {
  return doc;
}

/**
 * Shallow-merge `patch` into the in-memory document and schedule a write.
 * A `null` value deletes its key. `version` is not patchable. The merged doc
 * is returned and readable immediately, long before the write lands.
 */
export function patchPreferences(patch: Record<string, unknown>): PreferencesDoc {
  const next: PreferencesDoc = { ...doc, version: 1 };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "version") continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  doc = next;
  scheduleWrite();
  return doc;
}

/**
 * Write any pending change now. Resolves once the document on disk matches the
 * one in memory. A no-op when nothing is pending, so calling it on top of an
 * already-fired debounce does not write twice. Never rejects: a failed write
 * is logged, not thrown, so shutdown is not blocked by a full disk.
 */
export async function flushPreferences(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  // Let a write that is already running finish before deciding what is left.
  while (inFlight) await inFlight;
  if (!dirty || !targetPath) return;
  dirty = false;
  const write = writeNow(targetPath, serialize(doc))
    .catch((err) => console.error("[preferences] write failed:", err))
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
}

function scheduleWrite(): void {
  dirty = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flushPreferences();
  }, WRITE_DEBOUNCE_MS);
}

/** `version` first, then every other key sorted — one key per line. */
function serialize(d: PreferencesDoc): string {
  const lines = [`  "version": ${JSON.stringify(d.version)}`];
  for (const key of Object.keys(d).filter((k) => k !== "version").sort()) {
    lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(d[key])}`);
  }
  return `{\n${lines.join(",\n")}\n}\n`;
}

/** Write to a sibling temp file, then rename it over the target — same
 *  filesystem, so the swap is atomic and readers see whole documents only. */
async function writeNow(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${++tmpSeq}`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, path);
}
