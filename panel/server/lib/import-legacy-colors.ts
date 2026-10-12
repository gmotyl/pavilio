import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getConfig } from "../config.js";
import { getPreferences, patchPreferences } from "./preferences-store.js";

// Duplicated from the registry (`project.color`, project scope) because the
// server never imports the client's declarations; importLegacyColors.test.ts
// pins the two together.
const COLOR_KEY = "project.color";
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * One-way import of the old `<projectsDir>/.panel/project-colors.json` into
 * the preferences document, run once per server start after preferences load.
 *
 * Only fills gaps: a project that already has `project.color@<name>` keeps it,
 * so the import can run on every boot without undoing a later choice. The
 * legacy file is read, never written or deleted. Returns how many colours were
 * imported.
 */
export function importLegacyColors(): number {
  const file = join(getConfig().projectsDir, ".panel", "project-colors.json");
  if (!existsSync(file)) return 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return 0;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return 0;

  const doc = getPreferences();
  const patch: Record<string, string> = {};
  for (const [name, hex] of Object.entries(parsed)) {
    if (typeof hex !== "string" || !HEX_RE.test(hex) || name.trim() === "") continue;
    const key = `${COLOR_KEY}@${name}`;
    if (Object.prototype.hasOwnProperty.call(doc, key)) continue;
    patch[key] = hex;
  }
  const count = Object.keys(patch).length;
  if (count > 0) patchPreferences(patch);
  return count;
}
