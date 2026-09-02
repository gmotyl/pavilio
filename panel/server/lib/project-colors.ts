import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { getConfig } from "../config.js";

/**
 * The colour palette a project is auto-assigned from. The first six are the
 * ones the old per-session palette used, kept in their original order so that
 * today's auto-assignments do not shift as the palette grows.
 */
export const PROJECT_COLOR_PRESETS: readonly { name: string; hex: string }[] = [
  { name: "Gold", hex: "#f0c674" },
  { name: "Coral", hex: "#e06c75" },
  { name: "Purple", hex: "#c678dd" },
  { name: "Blue", hex: "#61afef" },
  { name: "Teal", hex: "#56b6c2" },
  { name: "Green", hex: "#98c379" },
  { name: "Orange", hex: "#d19a66" },
  { name: "Olive", hex: "#b5bd68" },
  { name: "Emerald", hex: "#5fd7a7" },
  { name: "Indigo", hex: "#7d8ff5" },
  { name: "Pink", hex: "#ec7fa9" },
  { name: "Slate", hex: "#8fa3bf" },
];

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * `<projectsDir>/.panel/project-colors.json`. `.panel` carries no `PROJECT.md`,
 * so `discovery.ts` — which filters on that marker — never sees it as a project.
 */
function storePath(): string {
  return join(getConfig().projectsDir, ".panel", "project-colors.json");
}

/** Absent, empty, malformed, or not an object all mean "no colours assigned yet". */
function readStore(): Record<string, string> {
  const file = storePath();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [name, hex] of Object.entries(parsed)) {
      if (typeof hex === "string" && HEX_RE.test(hex)) out[name] = hex;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Temp file + rename, the way `time-store.ts` rewrites a timesheet: every panel
 * render reads this map, and a torn write would parse as malformed — which this
 * module deliberately treats as empty, silently recolouring every project.
 */
function writeStore(colors: Record<string, string>): void {
  const file = storePath();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(colors, null, 2) + "\n", "utf-8");
  renameSync(tmp, file);
}

/**
 * Pick a colour for one more project. Preference is the first preset no project
 * holds yet; once the palette is exhausted assignment continues from its start,
 * so a project is never left colourless. Duplicates are permitted — uniqueness
 * is advisory here and enforced nowhere.
 */
function nextColor(assigned: Record<string, string>): string {
  const used = new Set(Object.values(assigned));
  const free = PROJECT_COLOR_PRESETS.find((p) => !used.has(p.hex));
  if (free) return free.hex;
  const index = Object.keys(assigned).length % PROJECT_COLOR_PRESETS.length;
  return PROJECT_COLOR_PRESETS[index].hex;
}

/** Every known project's colour, assigning and persisting one for any project without an entry. */
export function resolveProjectColors(projectNames: string[]): Record<string, string> {
  const colors = readStore();
  // Sorted, not in arrival order: assignment must not depend on the order the
  // caller happened to discover projects in.
  const missing = [...new Set(projectNames)].filter((n) => !colors[n]).sort();
  for (const name of missing) colors[name] = nextColor(colors);
  if (missing.length > 0) writeStore(colors);
  return colors;
}

/** Set one project's colour. `hex` must be #rgb or #rrggbb; throws otherwise. */
export function setProjectColor(project: string, hex: string): void {
  if (!HEX_RE.test(hex)) throw new Error(`Invalid colour: ${hex}`);
  const colors = readStore();
  colors[project] = hex;
  writeStore(colors);
}
