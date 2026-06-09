import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const defaultFile = resolve(dirname(fileURLToPath(import.meta.url)), "../../.autosync-state.json");

export function isEnabled(file = defaultFile): boolean {
  if (!existsSync(file)) return true; // default ON
  try {
    return JSON.parse(readFileSync(file, "utf-8")).enabled !== false;
  } catch {
    return true;
  }
}

export function setEnabled(enabled: boolean, file = defaultFile): void {
  writeFileSync(file, JSON.stringify({ enabled }, null, 2));
}
