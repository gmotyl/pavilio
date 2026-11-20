// Per-project identity (colour + mark) stored in the notes repo at
// `<projectsDir>/<project>/identity.json`, so it follows the project across
// machines instead of living in a per-machine preferences file.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getConfig } from "../config.js";
import { resolvesInsideProjectsDir } from "./discovery.js";

export type IdentityField = "color" | "mark";
export interface Identity {
  color?: string;
  mark?: string;
}

const IDENTITY_KEY = /^project\.(color|mark)@(.+)$/;
const FIELDS: IdentityField[] = ["color", "mark"];
let tmpSeq = 0;

/** `project.color@<p>` / `project.mark@<p>` -> its parts, else undefined. */
export function parseIdentityKey(key: string): { field: IdentityField; project: string } | undefined {
  const m = IDENTITY_KEY.exec(key);
  return m ? { field: m[1] as IdentityField, project: m[2] } : undefined;
}

export const isIdentityKey = (key: string): boolean => IDENTITY_KEY.test(key);

export const identityKey = (field: IdentityField, project: string): string => `project.${field}@${project}`;

/** A name that is one path segment, so it can never escape `projectsDir`. */
function safeName(name: string): boolean {
  return name !== "" && name !== "." && name !== ".." && !/[/\\\0]/.test(name);
}

function projectDir(name: string): string | undefined {
  if (!safeName(name)) return undefined;
  const { projectsDir } = getConfig();
  const dir = join(projectsDir, name);
  // A symlinked project dir pointing outside projectsDir must never receive
  // an identity write (or be read from).
  if (!resolvesInsideProjectsDir(projectsDir, dir)) return undefined;
  try {
    return statSync(dir).isDirectory() ? dir : undefined;
  } catch {
    return undefined;
  }
}

function readFile(file: string): Identity {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Identity = {};
    for (const f of FIELDS) {
      const v = (parsed as Record<string, unknown>)[f];
      if (typeof v === "string" && v !== "") out[f] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function readIdentity(name: string): Identity {
  const dir = projectDir(name);
  return dir ? readFile(join(dir, "identity.json")) : {};
}

/** Every project's identity, keyed by project name. Projects without one are omitted. */
export function readAllIdentities(): Record<string, Identity> {
  // Null prototype: a project named `__proto__` must be an ordinary entry.
  const out: Record<string, Identity> = Object.create(null) as Record<string, Identity>;
  let names: string[] = [];
  try {
    names = readdirSync(getConfig().projectsDir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (name.startsWith(".") || !safeName(name)) continue;
    const id = readIdentity(name);
    if (id.color || id.mark) out[name] = id;
  }
  return out;
}

/**
 * Merge `patch` into the project's identity.json; `null` deletes a field.
 * Atomic (tmp + rename). The file is removed when no field is left. Returns
 * false when the project directory does not exist — nothing is created for
 * an unknown project.
 */
export function writeIdentity(name: string, patch: { [K in IdentityField]?: string | null }): boolean {
  const dir = projectDir(name);
  if (!dir) return false;
  const file = join(dir, "identity.json");
  const next: Identity = readFile(file);
  for (const f of FIELDS) {
    const v = patch[f];
    if (v === undefined) continue;
    if (v === null) delete next[f];
    else next[f] = v;
  }
  if (!next.color && !next.mark) {
    try {
      rmSync(file, { force: true });
    } catch (err) {
      console.error(`[identity] remove ${file} failed:`, err);
      return false;
    }
    return true;
  }
  const sorted: Record<string, string> = {};
  for (const f of FIELDS) if (next[f]) sorted[f] = next[f];
  const tmp = `${file}.tmp.${process.pid}.${++tmpSeq}`;
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(tmp, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    console.error(`[identity] write ${file} failed:`, err);
    return false;
  }
  return true;
}
