// Workspace preferences over HTTP.
//
// Two endpoints, deliberately on two different shapes of URL:
//
//   GET   /api/preferences.js  the in-memory document as a <script src>, so the
//                              page has its preferences before React mounts and
//                              never flashes a default layout first;
//   PATCH /api/preferences     a shallow patch (a null value deletes a key).
//
// Mounted under `/api`, not `/api/preferences` — express splits a mount prefix
// on `/` only, so a router mounted at `/api/preferences` would never see
// `/api/preferences.js`.

import { Router } from "express";
import { homedir } from "node:os";
import { getPreferences, patchPreferences } from "../lib/preferences-store.js";
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
  const body =
    `window.__PAVILIO_PREFS__ = ${toScriptLiteral(getPreferences())};\n` +
    `window.__PAVILIO_HOME__ = ${toScriptLiteral(homedir())};\n`;

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
  if (keys.length === 0) return res.json({ ok: true });

  patchPreferences(body as Record<string, unknown>);

  // Every other open panel tab holds the same document in memory; this is how
  // they learn which keys to re-read.
  broadcast({ type: "preferences-change", keys });
  res.json({ ok: true });
});

export default preferencesRouter;
