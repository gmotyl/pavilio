import { existsSync, readFileSync } from "fs";

import { preferences } from "../../../src/preferences/declarations";
import { preferencesFileFor } from "../../config";

/**
 * The spikes root (`research.spikesRoot`), read from the workspace preferences document.
 *
 * Same contract as `wiki/config.ts#readWikiConfig`: read-only, never throws. A missing,
 * unreadable or malformed file, a non-string value or a blank one all yield the registry
 * default. The value is trimmed and returned as written — `~` is kept, not expanded.
 */
const ROOT = preferences.researchSpikesRoot;

export const SPIKES_ROOT_DEFAULT: string = ROOT.default;

/** Spikes root from an already-parsed preferences document (any shape). */
export function spikesRootFrom(doc: unknown): string {
  const record =
    doc && typeof doc === "object" && !Array.isArray(doc) ? (doc as Record<string, unknown>) : {};
  const value = record[ROOT.key];
  // A blank root names nothing, so it reads like a missing one.
  return typeof value === "string" && value.trim() !== "" ? value.trim() : ROOT.default;
}

/** Spikes root from the preferences file at `prefsPath`. */
export function readSpikesRoot(prefsPath: string): string {
  let doc: unknown = undefined;
  try {
    if (existsSync(prefsPath)) doc = JSON.parse(readFileSync(prefsPath, "utf8"));
  } catch {
    /* unreadable or malformed — default */
  }
  return spikesRootFrom(doc);
}

/** Spikes root for `workspaceRoot`, from this machine's preferences file there. */
export async function loadSpikesRoot(workspaceRoot: string): Promise<string> {
  return readSpikesRoot(await preferencesFileFor(workspaceRoot));
}
