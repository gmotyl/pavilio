// Workspace preferences over HTTP.
//
// Two endpoints, deliberately on two different shapes of URL:
//
//   GET   /api/preferences.js  the in-memory document as a <script src>, so the
//                              page has its preferences before React mounts and
//                              never flashes a default layout first;
//   PATCH /api/preferences     a shallow patch (a null value deletes a key).
//
// And the two behind Settings' "Copy preferences from <machine>" (design D4):
//
//   GET  /api/preferences/machines   this machine's id and the other machines
//                                    with a committed per-machine file;
//   POST /api/preferences/copy-from  { machine } — replace this machine's
//                                    document with that machine's file.
//
// Mounted under `/api`, not `/api/preferences` — express splits a mount prefix
// on `/` only, so a router mounted at `/api/preferences` would never see
// `/api/preferences.js`.

import { Router } from "express";
import { lstatSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { getConfig } from "../config.js";
import { machineId } from "../lib/hostname.js";
import {
  getPreferences,
  getPreferencesPath,
  isReadOnly,
  patchPreferences,
  readDoc,
  replacePreferences,
} from "../lib/preferences-store.js";
import { trackedFileNames } from "../lib/trackedFiles.js";
import { broadcast } from "../watcher.js";

const preferencesRouter = Router();

/**
 * Characters that are legal inside a JSON string but hostile inside a served
 * script, rewritten to the `\uXXXX` escape a JavaScript parser reads back as
 * the original character — so nothing about a value changes.
 *
 *   `<`, `>`  a value holding `</script>` must not be able to close a script
 *             element. This response is an external script, so today's parser
 *             would not care; but the same text is one server-render away from
 *             an inline context, and escaping at the source costs nothing.
 *   `&`       the same argument one step earlier, for an HTML-escaped
 *             `&lt;/script&gt;`.
 *   U+2028/9  the hazard that bites even a pure `<script src>`: both are legal
 *             *raw* inside a JSON string, so `JSON.stringify` emits them
 *             untouched, but a pre-ES2019 JavaScript parser treats them as line
 *             terminators and the assignment becomes a syntax error.
 *             `JSON.stringify` produces JSON, which is not always a valid JS
 *             literal — this is exactly where the two grammars part.
 *
 * Lone surrogates need nothing here: ES2019's well-formed `JSON.stringify`
 * already emits them as `\uD800`-style escapes rather than raw bytes, and the
 * response declares `charset=utf-8`, so what is parsed is what was written.
 *
 * Every one of these characters can only occur inside a string literal of the
 * `JSON.stringify` output — the structural characters are `{}[]:,"` and digits
 * — so a blanket replacement over the whole text cannot damage the syntax.
 */
const SCRIPT_HOSTILE = /[<>&\u2028\u2029]/g;
const ESCAPED: Record<string, string> = {
  "<": "\\u003C",
  ">": "\\u003E",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

/** `value` as a JavaScript literal that is safe to serve inside a script. */
function toScriptLiteral(value: unknown): string {
  return JSON.stringify(value).replace(SCRIPT_HOSTILE, (c) => ESCAPED[c]);
}

preferencesRouter.get("/preferences.js", (_req, res) => {
  // The home directory travels with the document because the browser bundle
  // has no `process` to read it from: without it a `~`-spelled repo path and
  // its expanded form key two different preferences (see `normalizeRepoScope`
  // in src/preferences/types.ts).
  //
  // `__PAVILIO_TUNING__` is the third passenger and the odd one out: not a
  // preference (nobody sets it from Settings, and it is never patched back) but
  // a server-side TUNING KNOB the client needs before it runs. It rides this
  // document rather than a `VITE_*` variable because a build-time value would
  // need a rebuild to change, and the point of the knob is that an env var plus
  // a panel restart is enough. Its own key, not a key inside the preferences
  // document, so `PATCH /api/preferences` can never write to it — the patch
  // path reaches the preferences document and nothing else. (It says nothing
  // about unrecognized keys in general: `patchPreferences` keeps no allowlist
  // and will write whatever key it is handed.)
  const body =
    `window.__PAVILIO_PREFS__ = ${toScriptLiteral(getPreferences())};\n` +
    `window.__PAVILIO_HOME__ = ${toScriptLiteral(homedir())};\n` +
    `window.__PAVILIO_TUNING__ = ${toScriptLiteral({
      answerWaveDebounceMs: getConfig().answerWaveDebounceMs,
    })};\n` +
    // Whether this session's changes reach the file at all. Its own global for
    // the same reason as `__PAVILIO_TUNING__`: no PATCH can ever reach it.
    `window.__PAVILIO_PREFS_READONLY__ = ${toScriptLiteral(isReadOnly())};\n`;

  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  // The document changes on every patch and this script is the page's only
  // source for it — a cached copy is a stale layout after a reload.
  res.setHeader("Cache-Control", "no-store");
  res.send(body);
});

preferencesRouter.patch("/preferences", (req, res) => {
  const body: unknown = req.body;
  // An array is an object to `typeof`, but it names no keys, so it is not a
  // patch. `null` and an absent body land here too.
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({ error: "patch body must be an object of key/value pairs" });
  }

  // `version` is the document's own field, not a preference — the store
  // ignores it, so it must not be reported as changed either.
  const keys = Object.keys(body as Record<string, unknown>).filter((k) => k !== "version");
  // Nothing to apply. The store would still mark the document dirty and
  // schedule a write of a byte-identical file, and the frame below would wake
  // every open tab to re-read an empty list of keys. Still a 200: the caller
  // asked for nothing and nothing is what it got.
  // `persisted` says whether the change will reach the file or only this
  // session's memory (a newer panel's file is never rewritten — see
  // `isReadOnly`). Reported on every 200, this one included.
  if (keys.length === 0) return res.json({ ok: true, persisted: !isReadOnly() });

  patchPreferences(body as Record<string, unknown>);

  // Every other open panel tab holds the same document in memory; this is how
  // they learn which keys to re-read.
  broadcast({ type: "preferences-change", keys });
  res.json({ ok: true, persisted: !isReadOnly() });
});

/** A machine id as `sanitizeHostname` produces it — no dots, no slashes, so never a path. */
const MACHINE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * This machine's id and the other machines a copy may come from: the
 * `<id>.json` siblings of this machine's own file that git tracks — a
 * *committed* file, since that is what another machine's sync brought here, not
 * a stray local one — and that are still on disk to be read, as a regular file
 * (never a symlink or a directory). Outside a git
 * repository there is no "committed", so every per-machine file on disk counts.
 *
 * Empty when the own file is not a per-machine file (a `preferencesPath`
 * override, or the legacy shared file): its directory holds no machines.
 */
async function otherMachines(): Promise<{ self: string; dir: string; machines: string[] }> {
  const self = machineId();
  const own = getPreferencesPath();
  const dir = dirname(own);
  if (!own || basename(own) !== `${self}.json`) return { self, dir, machines: [] };
  const onDisk = new Set(await readdir(dir).catch(() => [] as string[]));
  const candidates = (await trackedFileNames(dir)) ?? [...onDisk];
  const machines = candidates
    .filter((name) => name.endsWith(".json") && onDisk.has(name) && isRegularFile(join(dir, name)))
    .map((name) => name.slice(0, -".json".length))
    .filter((id) => id !== self && MACHINE_ID.test(id))
    .sort();
  return { self, dir, machines };
}

/** A regular file, not a symlink: a committed link could point a copy anywhere on disk. */
function isRegularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

preferencesRouter.get("/preferences/machines", async (_req, res) => {
  const { self, machines } = await otherMachines();
  res.setHeader("Cache-Control", "no-store");
  res.json({ self, machines });
});

preferencesRouter.post("/preferences/copy-from", async (req, res) => {
  const machine: unknown = (req.body as { machine?: unknown } | undefined)?.machine;
  // Validated before any path is built from it: only an id from the list —
  // which is already sanitized, never this machine, never `../x` — is served.
  const { dir, machines } = await otherMachines();
  if (typeof machine !== "string" || !MACHINE_ID.test(machine) || !machines.includes(machine)) {
    return res.status(404).json({ error: "no other machine with committed preferences by that id" });
  }
  const copied = readDoc(join(dir, `${machine}.json`));
  if (!copied) {
    return res.status(422).json({ error: `${machine}'s preferences file is not a JSON object` });
  }
  try {
    await replacePreferences(copied);
  } catch (err) {
    return res.status(500).json({ error: `could not write this machine's preferences: ${String(err)}` });
  }
  // No broadcast: the copying tab reloads, and preferences are read once at
  // boot (ADR-0015) — another open tab picks the copy up on its next reload.
  res.status(204).end();
});

export default preferencesRouter;
