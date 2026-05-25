import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendTimeEntry, readTimeEntries } from "../time-store";

let projectsDir: string;
beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), "pavilio-time-"));
});

describe("appendTimeEntry", () => {
  it("creates time/<host>.jsonl and appends a JSON line", () => {
    appendTimeEntry({
      projectsDir,
      projectName: "metro",
      hostname: "macbook",
      entry: { id: "a1", type: "manual", date: "2026-05-25", minutes: 90, note: "x" },
    });
    const file = join(projectsDir, "metro", "time", "macbook.jsonl");
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ id: "a1", minutes: 90 });
  });

  it("appends multiple entries preserving order", () => {
    for (const id of ["a", "b", "c"]) {
      appendTimeEntry({
        projectsDir, projectName: "p", hostname: "h",
        entry: { id, type: "manual", date: "2026-05-25", minutes: 1 },
      });
    }
    const entries = readTimeEntries({ projectsDir, projectName: "p" });
    expect(entries.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });
});

describe("readTimeEntries", () => {
  it("merges entries from every <host>.jsonl in the project", () => {
    appendTimeEntry({ projectsDir, projectName: "p", hostname: "h1",
      entry: { id: "1", type: "manual", date: "2026-05-25", minutes: 30 }});
    appendTimeEntry({ projectsDir, projectName: "p", hostname: "h2",
      entry: { id: "2", type: "manual", date: "2026-05-25", minutes: 45 }});
    const all = readTimeEntries({ projectsDir, projectName: "p" });
    expect(all.map((e) => e.id).sort()).toEqual(["1", "2"]);
  });

  it("returns [] if project has no time dir", () => {
    expect(readTimeEntries({ projectsDir, projectName: "ghost" })).toEqual([]);
  });

  it("skips malformed lines but keeps valid ones", () => {
    mkdirSync(join(projectsDir, "p", "time"), { recursive: true });
    const file = join(projectsDir, "p", "time", "h.jsonl");
    writeFileSync(file,
      `{"id":"1","type":"manual","date":"2026-05-25","minutes":5}\nnot json\n{"id":"2","type":"manual","date":"2026-05-25","minutes":7}\n`,
    );
    const all = readTimeEntries({ projectsDir, projectName: "p" });
    expect(all.map((e) => e.id)).toEqual(["1", "2"]);
  });
});
