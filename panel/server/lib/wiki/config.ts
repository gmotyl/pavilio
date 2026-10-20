import { existsSync, readFileSync } from "fs";

import { preferences } from "../../../src/preferences/declarations";
import { getConfig, loadConfig } from "../../config";

/**
 * The wiki's two settings, read from the workspace preferences document.
 *
 * - Keys and defaults come from the preferences registry, the single source of truth; the
 *   registry is import-safe under node (its only runtime imports are codecs and a leaf module).
 * - Read-only and side-effect free: unlike `preferences-store.ts#loadPreferences` it never
 *   retargets the panel's in-memory store, so the panel server and the CLI can both call it.
 * - Never throws. A missing, unreadable or malformed file yields the defaults; a key holding the
 *   wrong type yields that key's default, the other key still reads.
 */
export interface WikiConfig {
  sessionStartIngest: boolean;
  writerModel: string;
}

const INGEST = preferences.wikiSessionStartIngest;
const MODEL = preferences.wikiWriterModel;

export const WIKI_CONFIG_DEFAULTS: Readonly<WikiConfig> = Object.freeze({
  sessionStartIngest: INGEST.default,
  writerModel: MODEL.default,
});

/** Wiki config from an already-parsed preferences document (any shape). */
export function wikiConfigFrom(doc: unknown): WikiConfig {
  const record =
    doc && typeof doc === "object" && !Array.isArray(doc) ? (doc as Record<string, unknown>) : {};
  const ingest = record[INGEST.key];
  const model = record[MODEL.key];
  return {
    sessionStartIngest: typeof ingest === "boolean" ? ingest : INGEST.default,
    // A blank model names nothing, so it reads like a missing one.
    writerModel: typeof model === "string" && model.trim() !== "" ? model.trim() : MODEL.default,
  };
}

/** Wiki config from the preferences file at `path`. */
export function readWikiConfig(path: string): WikiConfig {
  let doc: unknown = undefined;
  try {
    if (existsSync(path)) doc = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    /* unreadable or malformed — defaults */
  }
  return wikiConfigFrom(doc);
}

/**
 * Wiki config from the preferences file the panel itself uses: `preferencesPath` from
 * `panel.config.ts`, as overridden by `panel.config.local.ts`.
 */
export async function loadWikiConfig(): Promise<WikiConfig> {
  await loadConfig();
  return readWikiConfig(getConfig().preferencesPath);
}
