import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

import { preferences } from "../../../src/preferences/declarations";
import { getConfig, loadConfig } from "../../config";

/**
 * The spikes root (`research.spikesRoot`), read from the workspace preferences document.
 *
 * Same contract as `wiki/config.ts#readWikiConfig`: read-only, never throws. A missing,
 * unreadable or malformed file, a non-string value or a blank one all yield the registry
 * default. The value is trimmed and returned as written — `~` is kept, not expanded.
 */
const ROOT = preferences.researchSpikesRoot;

export const SPIKES_ROOT_DEFAULT: string = ROOT.default;

/** The workspace this panel lives in — the one `panel.config.ts` describes. */
const DEFAULT_WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

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

/**
 * The preferences file for `workspaceRoot`, located the way the wiki CLI's `config` command
 * does: a workspace other than this panel's has its own `.pavilio/preferences.json`; this
 * panel's own workspace uses `preferencesPath` from `panel.config.ts` (as overridden by
 * `panel.config.local.ts`).
 */
export async function preferencesPathFor(workspaceRoot: string): Promise<string> {
  if (resolve(workspaceRoot) !== DEFAULT_WORKSPACE_ROOT) {
    return join(workspaceRoot, ".pavilio", "preferences.json");
  }
  await loadConfig();
  return getConfig().preferencesPath;
}

/** Spikes root for `workspaceRoot`, from the preferences file `preferencesPathFor` locates. */
export async function loadSpikesRoot(workspaceRoot: string): Promise<string> {
  return readSpikesRoot(await preferencesPathFor(workspaceRoot));
}
