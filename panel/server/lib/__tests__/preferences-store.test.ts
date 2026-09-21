import { describe, it, expect, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  statSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

// Record what the store does to the filesystem without stubbing it: the
// debounce contract ("several patches → one write") is only observable as the
// number of commits to the target path, and "atomic" is only observable as
// *where* the bytes were written before the target started pointing at them.
const spy = vi.hoisted(() => ({ renames: 0, written: [] as string[] }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    default: actual,
    writeFile: async (path: string, data: string, enc: BufferEncoding) => {
      spy.written.push(path);
      return actual.writeFile(path, data, enc);
    },
    rename: async (from: string, to: string) => {
      spy.renames++;
      return actual.rename(from, to);
    },
  };
});

import {
  loadPreferences,
  getPreferences,
  patchPreferences,
  flushPreferences,
  _resetPreferencesForTests,
} from "../preferences-store.js";

let dir = "";
const file = () => join(dir, "preferences.json");
const freshDir = (): string => (dir = mkdtempSync(join(tmpdir(), "pavilio-prefs-")));

afterEach(() => {
  _resetPreferencesForTests();
  vi.useRealTimers();
  spy.renames = 0;
  spy.written = [];
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("loadPreferences", () => {
  it("a missing file yields an empty versioned doc", () => {
    freshDir();
    expect(loadPreferences(join(dir, "nope", "preferences.json"))).toEqual({ version: 1 });
    expect(getPreferences()).toEqual({ version: 1 });
  });

  it("a malformed file yields an empty versioned doc", () => {
    freshDir();
    for (const junk of ["", "   ", "{ not json", "[1,2,3]", "null", '"a string"']) {
      writeFileSync(file(), junk, "utf8");
      expect(loadPreferences(file())).toEqual({ version: 1 });
      expect(getPreferences()).toEqual({ version: 1 });
      _resetPreferencesForTests();
    }
  });

  it("a valid file is loaded into memory", () => {
    freshDir();
    writeFileSync(
      file(),
      JSON.stringify({ version: 1, theme: "dark", panes: { left: 240 } }),
      "utf8",
    );
    expect(loadPreferences(file())).toEqual({ version: 1, theme: "dark", panes: { left: 240 } });
    expect(getPreferences()).toEqual({ version: 1, theme: "dark", panes: { left: 240 } });
  });
});

describe("patchPreferences", () => {
  it("a patch merges rather than replaces", async () => {
    freshDir();
    writeFileSync(file(), JSON.stringify({ version: 1, theme: "dark", locale: "pl" }), "utf8");
    loadPreferences(file());

    const merged = patchPreferences({ theme: "light", density: "compact" });

    // readable immediately, before any write has landed
    expect(merged).toEqual({ version: 1, theme: "light", locale: "pl", density: "compact" });
    expect(getPreferences()).toEqual(merged);

    await flushPreferences();
    expect(JSON.parse(readFileSync(file(), "utf8"))).toEqual({
      version: 1,
      theme: "light",
      locale: "pl",
      density: "compact",
    });
  });

  it("a null value removes the key from the file", async () => {
    freshDir();
    loadPreferences(file());
    patchPreferences({ theme: "dark", locale: "pl" });
    await flushPreferences();
    expect(JSON.parse(readFileSync(file(), "utf8"))).toEqual({
      version: 1,
      theme: "dark",
      locale: "pl",
    });

    patchPreferences({ theme: null });
    await flushPreferences();

    const text = readFileSync(file(), "utf8");
    expect(text).not.toContain("theme");
    expect(JSON.parse(text)).toEqual({ version: 1, locale: "pl" });
    expect(getPreferences()).toEqual({ version: 1, locale: "pl" });
  });
});

describe("serialization", () => {
  it("keys are written sorted, one per line, with version first", async () => {
    freshDir();
    loadPreferences(file());
    patchPreferences({ zeta: 1, alpha: 2, mid: { x: 1, y: [1, 2] }, Beta: "b" });
    await flushPreferences();

    const text = readFileSync(file(), "utf8");
    expect(text.endsWith("}\n")).toBe(true);

    const lines = text.trimEnd().split("\n");
    expect(lines[0]).toBe("{");
    expect(lines[lines.length - 1]).toBe("}");

    const keyLines = lines.slice(1, -1);
    // one key per line, two-space indent — nested values stay on their key's line
    expect(keyLines).toHaveLength(5);
    for (const line of keyLines) expect(line).toMatch(/^ {2}"/);

    const keys = keyLines.map((l) => JSON.parse(l.trim().match(/^("(?:[^"\\]|\\.)*")/)![1]));
    expect(keys[0]).toBe("version");
    expect(keys.slice(1)).toEqual([...keys.slice(1)].sort());
    expect(keys.slice(1)).toEqual(["Beta", "alpha", "mid", "zeta"]);

    expect(JSON.parse(text)).toEqual({
      version: 1,
      zeta: 1,
      alpha: 2,
      mid: { x: 1, y: [1, 2] },
      Beta: "b",
    });
  });
});

describe("durability", () => {
  it("the write is atomic — no partial file is ever visible", async () => {
    freshDir();
    loadPreferences(file());

    // A small, complete doc first, so a reader that catches an in-place write
    // mid-flight sees a truncated file rather than merely a missing one.
    patchPreferences({ seed: "small" });
    await flushPreferences();
    const before = readFileSync(file(), "utf8");
    const inoBefore = statSync(file()).ino;
    spy.written = [];

    // Big enough that a non-atomic writeFile needs many syscalls and yields to
    // the event loop between them — that is the window this test polls.
    const blob = "x".repeat(64 * 1024);
    const big: Record<string, unknown> = {};
    for (let i = 0; i < 64; i++) big[`k${String(i).padStart(3, "0")}`] = blob;
    patchPreferences(big);

    let reads = 0;
    let stop = false;
    const poll = (async () => {
      while (!stop) {
        let text: string;
        try {
          text = await readFile(file(), "utf8");
        } catch {
          continue; // ENOENT is honest: the file simply isn't there yet
        }
        reads++;
        // every observation must be one of the two committed states, never a
        // half-written one
        expect(() => JSON.parse(text)).not.toThrow();
        const doc = JSON.parse(text) as Record<string, unknown>;
        expect(doc.version).toBe(1);
        if (text !== before) expect(Object.keys(doc)).toHaveLength(66);
      }
    })();

    await flushPreferences();
    stop = true;
    await poll;

    expect(reads).toBeGreaterThan(0);

    // The polling reader above can only ever *catch* a non-atomic write; these
    // three assertions prove the write could not have been one. No byte was
    // written to the target path itself — every write went to a sibling in the
    // same directory (same filesystem, so the rename that follows is atomic),
    // and the target's inode changed, which an in-place truncate-and-write
    // cannot do. The temp sibling is gone afterwards.
    expect(spy.written.length).toBeGreaterThan(0);
    for (const p of spy.written) {
      expect(p).not.toBe(file());
      expect(dirname(p)).toBe(dir);
    }
    expect(statSync(file()).ino).not.toBe(inoBefore);
    expect(readdirSync(dir)).toEqual(["preferences.json"]);
    expect(Object.keys(JSON.parse(readFileSync(file(), "utf8")))).toHaveLength(66);
  }, 30_000);

  it("patches within the debounce window collapse into one write", async () => {
    freshDir();
    loadPreferences(file());
    vi.useFakeTimers();

    patchPreferences({ a: 1 });
    await vi.advanceTimersByTimeAsync(20);
    patchPreferences({ b: 2 });
    await vi.advanceTimersByTimeAsync(20);
    patchPreferences({ c: 3 });
    expect(existsSync(file())).toBe(false); // nothing written yet

    await vi.advanceTimersByTimeAsync(5_000); // well past the debounce window
    // an explicit flush on top of an already-fired debounce must not re-write
    await flushPreferences();

    expect(spy.renames).toBe(1);
    expect(JSON.parse(readFileSync(file(), "utf8"))).toEqual({ version: 1, a: 1, b: 2, c: 3 });
  });

  it("a missing parent directory is created on first write", async () => {
    freshDir();
    const nested = join(dir, "deep", ".pavilio", "preferences.json");
    loadPreferences(nested);
    patchPreferences({ theme: "dark" });
    await flushPreferences();
    expect(JSON.parse(readFileSync(nested, "utf8"))).toEqual({ version: 1, theme: "dark" });
  });
});
