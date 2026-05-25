import {
  mkdirSync,
  appendFileSync,
  readdirSync,
  readFileSync,
  existsSync,
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
