import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { getConfig } from "../config.js";

/**
 * `<projectsDir>/.panel/project-default-users.json`. `.panel` carries no
 * `PROJECT.md`, so `discovery.ts` — which filters on that marker — never sees
 * it as a project.
 */
function storePath(): string {
  return join(getConfig().projectsDir, ".panel", "project-default-users.json");
}

/**
 * A map with **no prototype**. Project names come from directory names, so
 * `constructor`, `toString` and friends are all legal ones: on a plain object
 * literal `users["constructor"]` would resolve up the prototype chain, the
 * project would look already-assigned, and the value handed to a consumer
 * would be a *function* rather than a username string.
 */
function emptyStore(): Record<string, string> {
  return Object.create(null) as Record<string, string>;
}

/**
 * Absent, empty, malformed, or not an object all mean "no defaults assigned
 * yet". A single bad *entry*, though, only discards that entry: dropping the
 * whole file would silently forget every project's chosen user.
 */
function readStore(): Record<string, string> {
  const file = storePath();
  const out = emptyStore();
  if (!existsSync(file)) return out;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out;
    for (const [name, username] of Object.entries(parsed)) {
      if (typeof username === "string") out[name] = username;
    }
    return out;
  } catch {
    return emptyStore();
  }
}

/**
 * Temp file + rename, the way `time-store.ts` rewrites a timesheet: every
 * panel render reads this map, and a torn write would parse as malformed —
 * which this module deliberately treats as empty, silently forgetting every
 * project's chosen default user.
 */
function writeStore(users: Record<string, string>): void {
  const file = storePath();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  try {
    writeFileSync(tmp, JSON.stringify(users, null, 2) + "\n", "utf-8");
    renameSync(tmp, file);
  } catch (err) {
    // Never leave `<file>.tmp.<pid>` behind: this directory is auto-committed,
    // so an orphan would be committed as if it were a real artefact.
    try {
      rmSync(tmp, { force: true, recursive: true });
    } catch {
      // Best effort — the original failure is the one worth reporting.
    }
    throw err;
  }
}

/** One project's stored default terminal user, or `undefined` if unset. */
export function getDefaultUser(project: string): string | undefined {
  return readStore()[project];
}

/** Set one project's default terminal user. */
export function setDefaultUser(project: string, username: string): void {
  const users = readStore();
  users[project] = username;
  writeStore(users);
}

/**
 * Every known project's default user, narrowed to `projectNames` — a stale
 * entry for a deleted project is never returned, though it stays on disk.
 * Unlike `resolveProjectColors`, nothing is auto-assigned: an unset project
 * is simply absent from the result.
 */
export function getAllDefaultUsers(projectNames: string[]): Record<string, string> {
  const users = readStore();
  const known = new Set(projectNames);
  const out = emptyStore();
  for (const [name, username] of Object.entries(users)) {
    if (known.has(name)) out[name] = username;
  }
  return out;
}
