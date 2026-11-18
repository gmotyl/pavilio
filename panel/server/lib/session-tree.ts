import { execFileSync } from "node:child_process";

/** ppid -> child pids. */
export type ProcessTable = Map<number, number[]>;

let warned = false;

/** Parse `ps -A -o pid=,ppid=` output into a ppid -> children table. */
export function parsePsTable(text: string): ProcessTable {
  const table: ProcessTable = new Map();
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    const kids = table.get(ppid);
    if (kids) kids.push(pid);
    else table.set(ppid, [pid]);
  }
  return table;
}

/** rootPid plus every transitive child; cycle-safe. */
export function descendants(rootPid: number, table: ProcessTable): Set<number> {
  const seen = new Set<number>([rootPid]);
  const stack = [rootPid];
  while (stack.length > 0) {
    const pid = stack.pop() as number;
    for (const child of table.get(pid) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      stack.push(child);
    }
  }
  return seen;
}

/** Snapshot the host process table; empty on failure (warns once per process). */
export function readProcessTable(): ProcessTable {
  try {
    const out = execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
    return parsePsTable(out);
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn("[session-tree] ps failed, process table unavailable:", (err as Error).message);
    }
    return new Map();
  }
}
