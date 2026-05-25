import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendTimeEntry, readTimeEntries, patchTimeEntry } from "../time-store";

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

describe("patchTimeEntry", () => {
  it("updates an existing entry's minutes, preserving other fields", () => {
    appendTimeEntry({
      projectsDir, projectName: "p", hostname: "h",
      entry: { id: "a1", type: "manual", date: "2026-05-25", minutes: 90, note: "x" },
    });
    appendTimeEntry({
      projectsDir, projectName: "p", hostname: "h",
      entry: { id: "a2", type: "manual", date: "2026-05-25", minutes: 30, note: "y" },
    });
    const ok = patchTimeEntry({
      projectsDir, projectName: "p", hostname: "h", entryId: "a1",
      patch: { minutes: 60 },
    });
    expect(ok).toBe(true);
    const all = readTimeEntries({ projectsDir, projectName: "p" });
    const a1 = all.find((e) => e.id === "a1") as Extract<typeof all[number], { type: "manual" }>;
    expect(a1.minutes).toBe(60);
    expect(a1.note).toBe("x");
    expect(a1.date).toBe("2026-05-25");
    // a2 untouched
    expect(all.find((e) => e.id === "a2")).toMatchObject({ id: "a2", minutes: 30, note: "y" });
  });

  it("updates the note field", () => {
    appendTimeEntry({
      projectsDir, projectName: "p", hostname: "h",
      entry: { id: "a1", type: "manual", date: "2026-05-25", minutes: 90, note: "old" },
    });
    const ok = patchTimeEntry({
      projectsDir, projectName: "p", hostname: "h", entryId: "a1",
      patch: { note: "new" },
    });
    expect(ok).toBe(true);
    const all = readTimeEntries({ projectsDir, projectName: "p" });
    expect(all[0]).toMatchObject({ id: "a1", minutes: 90, note: "new" });
  });

  it("deletes when patch is null: line removed, other lines preserved", () => {
    appendTimeEntry({
      projectsDir, projectName: "p", hostname: "h",
      entry: { id: "a1", type: "manual", date: "2026-05-25", minutes: 90 },
    });
    appendTimeEntry({
      projectsDir, projectName: "p", hostname: "h",
      entry: { id: "a2", type: "manual", date: "2026-05-25", minutes: 30 },
    });
    const ok = patchTimeEntry({
      projectsDir, projectName: "p", hostname: "h", entryId: "a1", patch: null,
    });
    expect(ok).toBe(true);
    const all = readTimeEntries({ projectsDir, projectName: "p" });
    expect(all.map((e) => e.id)).toEqual(["a2"]);
  });

  it("returns false when the id isn't in that machine's file", () => {
    appendTimeEntry({
      projectsDir, projectName: "p", hostname: "h",
      entry: { id: "a1", type: "manual", date: "2026-05-25", minutes: 5 },
    });
    const before = readFileSync(join(projectsDir, "p", "time", "h.jsonl"), "utf8");
    const ok = patchTimeEntry({
      projectsDir, projectName: "p", hostname: "h", entryId: "missing", patch: { minutes: 1 },
    });
    expect(ok).toBe(false);
    const after = readFileSync(join(projectsDir, "p", "time", "h.jsonl"), "utf8");
    expect(after).toBe(before);
  });

  it("returns false when the machine's file doesn't exist", () => {
    const ok = patchTimeEntry({
      projectsDir, projectName: "p", hostname: "h", entryId: "any", patch: null,
    });
    expect(ok).toBe(false);
  });

  it("preserves a malformed line elsewhere in the file when patching", () => {
    mkdirSync(join(projectsDir, "p", "time"), { recursive: true });
    const file = join(projectsDir, "p", "time", "h.jsonl");
    writeFileSync(file,
      `{"id":"1","type":"manual","date":"2026-05-25","minutes":5}\nnot json\n{"id":"2","type":"manual","date":"2026-05-25","minutes":7}\n`,
    );
    const ok = patchTimeEntry({
      projectsDir, projectName: "p", hostname: "h", entryId: "1", patch: { minutes: 99 },
    });
    expect(ok).toBe(true);
    const text = readFileSync(file, "utf8");
    expect(text).toContain("not json");
    const all = readTimeEntries({ projectsDir, projectName: "p" });
    expect(all.find((e) => e.id === "1")).toMatchObject({ minutes: 99 });
    expect(all.find((e) => e.id === "2")).toMatchObject({ minutes: 7 });
  });
});
