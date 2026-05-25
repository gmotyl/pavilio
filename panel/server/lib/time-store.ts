import {
  mkdirSync,
  appendFileSync,
  readdirSync,
  readFileSync,
  existsSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";

export type TimeEntry =
  | { id: string; type: "manual"; date: string; minutes: number; note?: string; createdAt?: string }
  | { id: string; type: "busy_block"; date: string; start: string; end: string; minutes: number }
  | { id: string; type: "reset"; date: string; ts: string };

export function appendTimeEntry(opts: {
  projectsDir: string;
  projectName: string;
  hostname: string;
  entry: TimeEntry;
}): void {
  const dir = join(opts.projectsDir, opts.projectName, "time");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${opts.hostname}.jsonl`);
  appendFileSync(file, JSON.stringify(opts.entry) + "\n", "utf8");
}

/**
 * Update or remove a manual entry by id in <projectsDir>/<projectName>/time/<hostname>.jsonl.
 * If the id isn't found (or the machine's file doesn't exist) returns false and leaves the file untouched.
 * If patch === null, the line is removed; otherwise the patch is shallow-merged into the parsed row.
 * Rewrites the file atomically (tmp file + rename). Malformed lines elsewhere in the file are preserved as-is.
 */
export function patchTimeEntry(opts: {
  projectsDir: string;
  projectName: string;
  hostname: string;
  entryId: string;
  patch: Partial<{ minutes: number; note: string; date: string }> | null;
}): boolean {
  const file = join(opts.projectsDir, opts.projectName, "time", `${opts.hostname}.jsonl`);
  if (!existsSync(file)) return false;
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  const out: string[] = [];
  let found = false;
  for (const line of lines) {
    if (line === "") {
      out.push(line);
      continue;
    }
    let parsed: { id?: unknown } | undefined;
    try {
      parsed = JSON.parse(line);
    } catch {
      out.push(line);
      continue;
    }
    if (parsed && parsed.id === opts.entryId) {
      found = true;
      if (opts.patch === null) {
        // drop this line
        continue;
      }
      const merged = { ...parsed, ...opts.patch };
      out.push(JSON.stringify(merged));
      continue;
    }
    out.push(line);
  }
  if (!found) return false;
  const tmp = `${file}.tmp.${process.pid}`;
  writeFileSync(tmp, out.join("\n"), "utf8");
  renameSync(tmp, file);
  return true;
}

export function readTimeEntries(opts: {
  projectsDir: string;
  projectName: string;
}): TimeEntry[] {
  const dir = join(opts.projectsDir, opts.projectName, "time");
  if (!existsSync(dir)) return [];
  const out: TimeEntry[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const text = readFileSync(join(dir, name), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as TimeEntry);
      } catch {
        /* skip malformed */
      }
    }
  }
  return out;
}
