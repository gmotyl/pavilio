import { join } from "path";

/**
 * Where a workspace keeps its preferences document, per machine (design D8).
 *
 * Kept free of any config import: `panel.config.ts` itself derives its default
 * `preferencesPath` from this resolver, so importing the config here would close
 * an import cycle that the config evaluation hits at module load.
 */

/** The pre-per-machine location, relative to the workspace root (migration fallback only). */
export const LEGACY_PREFERENCES = ".pavilio/preferences.json";

/** `.pavilio/preferences/<machineId>.json` under workspaceRoot. */
export function preferencesPathFor(workspaceRoot: string, machineId: string): string {
  return join(workspaceRoot, ".pavilio", "preferences", `${machineId}.json`);
}

/**
 * Where a machine with no own preferences file seeds from at boot (design D5):
 * the mirror machine's per-machine file — skipped when this machine is the
 * mirror, or no mirror is recorded — then the legacy shared file.
 */
export function preferenceSeedsFor(
  workspaceRoot: string,
  machineId: string,
  mirrorId: string | undefined,
): { mirrorPath?: string; legacyPath: string } {
  const legacyPath = join(workspaceRoot, LEGACY_PREFERENCES);
  if (!mirrorId || mirrorId === machineId) return { legacyPath };
  return { mirrorPath: preferencesPathFor(workspaceRoot, mirrorId), legacyPath };
}
