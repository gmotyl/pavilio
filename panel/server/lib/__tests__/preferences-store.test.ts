import { describe, it, expect, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  statSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Both durability contracts are observed on the target file itself, never on a
// particular fs call: which module the store imports, whether it writes sync
// or async, and how it spells its temp path are implementation details, and a
// test that pins them reddens correct rewrites while proving nothing extra.
//
// A *commit* is a change in the target's identity — absent → present, or one
// (inode, mtime, size) to another. `null` means "not there yet".
const commitId = (): string | null => {
  try {
    const s = statSync(file());
    return `${s.ino}:${s.mtimeMs}:${s.size}`;
  } catch {
    return null;
  }
};

/** Every file under `dir`, recursively, relative to it. Directories are not
 *  listed: a store that stages its temp file in a sibling `.tmp/` directory is
 *  as correct as one that stages it next to the target. */
const filesUnder = (root: string, prefix = ""): string[] =>
  readdirSync(root, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? filesUnder(join(root, e.name), `${prefix}${e.name}/`)
        : [`${prefix}${e.name}`],
    )
    .sort();

afterEach(() => {
  _resetPreferencesForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
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

    // The polling reader above can only ever *catch* a non-atomic write; the
    // inode is what proves the write could not have been one. The target the
    // readers hold open is a different file from the one the new bytes went
    // into, which is precisely what "committed by rename" means and what an
    // in-place truncate-and-write cannot do, however it is spelled.
    expect(statSync(file()).ino).not.toBe(inoBefore);
    // Nothing staged is left behind — wherever it was staged.
    expect(filesUnder(dir)).toEqual(["preferences.json"]);
    expect(Object.keys(JSON.parse(readFileSync(file(), "utf8")))).toHaveLength(66);
  }, 30_000);

  it("patches within the debounce window collapse into one write", async () => {
    freshDir();
    loadPreferences(file());

    // Real timers on purpose. AC 8 is a timing contract, and the only honest
    // way to count writes is to watch the target while real time passes:
    // under fake timers the store's fs work has not landed yet when the timer
    // returns, so every sample looks the same and the test proves nothing.
    const seen: (string | null)[] = [];
    let stop = false;
    const watch = (async () => {
      while (!stop) {
        const id = commitId();
        if (seen.length === 0 || seen[seen.length - 1] !== id) seen.push(id);
        await sleep(2);
      }
    })();

    patchPreferences({ a: 1 });
    await sleep(60);
    patchPreferences({ b: 2 });
    await sleep(60);
    patchPreferences({ c: 3 });
    expect(existsSync(file())).toBe(false); // nothing written yet

    await sleep(1_000); // well past the debounce window
    // an explicit flush on top of an already-fired debounce must not re-write
    await flushPreferences();
    await sleep(20);
    stop = true;
    await watch;

    // absent, then committed exactly once — three patches, one write
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBeNull();
    expect(seen[1]).not.toBeNull();
    expect(JSON.parse(readFileSync(file(), "utf8"))).toEqual({ version: 1, a: 1, b: 2, c: 3 });
  }, 30_000);

  it("a missing parent directory is created on first write", async () => {
    freshDir();
    const nested = join(dir, "deep", ".pavilio", "preferences.json");
    loadPreferences(nested);
    patchPreferences({ theme: "dark" });
    await flushPreferences();
    expect(JSON.parse(readFileSync(nested, "utf8"))).toEqual({ version: 1, theme: "dark" });
  });
});

describe("non-serializable values", () => {
  it("an undefined value never reaches the file", async () => {
    freshDir();
    loadPreferences(file());

    patchPreferences({ good: 1, bad: undefined });
    await flushPreferences();

    const text = readFileSync(file(), "utf8");
    expect(text).not.toContain("undefined");
    expect(() => JSON.parse(text)).not.toThrow();
    expect(JSON.parse(text)).toEqual({ version: 1, good: 1 });

    // and the document survives a reload — the whole point of the bug
    _resetPreferencesForTests();
    expect(loadPreferences(file())).toEqual({ version: 1, good: 1 });
  });

  it("an undefined value deletes an existing key, like null", async () => {
    freshDir();
    loadPreferences(file());
    patchPreferences({ theme: "dark", locale: "pl" });
    await flushPreferences();

    patchPreferences({ theme: undefined });
    await flushPreferences();

    expect(getPreferences()).toEqual({ version: 1, locale: "pl" });
    expect(JSON.parse(readFileSync(file(), "utf8"))).toEqual({ version: 1, locale: "pl" });
  });

  it("a function or a symbol value never reaches the file", async () => {
    freshDir();
    loadPreferences(file());

    patchPreferences({ good: 1, fn: () => 42, sym: Symbol("nope") });
    await flushPreferences();

    const text = readFileSync(file(), "utf8");
    expect(() => JSON.parse(text)).not.toThrow();
    expect(JSON.parse(text)).toEqual({ version: 1, good: 1 });
    expect(getPreferences()).toEqual({ version: 1, good: 1 });
  });
});

describe("a failed write", () => {
  it("is logged, does not reject, and is retried by the next flush", async () => {
    freshDir();
    loadPreferences(file());
    // The target path is a directory, so the commit (whatever syscall performs
    // it) cannot replace it. Unlike chmod this also holds when the tests run
    // as root.
    mkdirSync(file());
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    patchPreferences({ theme: "dark" });
    await expect(flushPreferences()).resolves.toBeUndefined();

    expect(errors).toHaveBeenCalled();
    expect(statSync(file()).isDirectory()).toBe(true); // nothing was committed
    expect(getPreferences()).toEqual({ version: 1, theme: "dark" }); // memory intact

    // The change must not be forgotten: once the target is writable again, a
    // later flush — the shutdown one, with no new patch behind it — retries.
    rmSync(file(), { recursive: true, force: true });
    await flushPreferences();

    expect(JSON.parse(readFileSync(file(), "utf8"))).toEqual({ version: 1, theme: "dark" });

    // and nothing is left behind from the failed attempt
    expect(filesUnder(dir)).toEqual(["preferences.json"]);
  });
});

describe("document version", () => {
  it("a v1 file loads and is rewritten as v1", async () => {
    freshDir();
    writeFileSync(file(), JSON.stringify({ version: 1, theme: "dark" }), "utf8");
    expect(loadPreferences(file()).version).toBe(1);

    patchPreferences({ locale: "pl" });
    await flushPreferences();
    expect(JSON.parse(readFileSync(file(), "utf8"))).toEqual({
      version: 1,
      theme: "dark",
      locale: "pl",
    });
  });

  it("a missing or malformed version normalizes to 1 and still writes", async () => {
    for (const bad of [undefined, null, 0, -1, 1.5, "1", "2", true, {}] as unknown[]) {
      freshDir();
      const raw: Record<string, unknown> = { theme: "dark" };
      if (bad !== undefined) raw.version = bad;
      writeFileSync(file(), JSON.stringify(raw), "utf8");

      expect(loadPreferences(file())).toEqual({ version: 1, theme: "dark" });

      patchPreferences({ locale: "pl" });
      await flushPreferences();
      expect(JSON.parse(readFileSync(file(), "utf8"))).toEqual({
        version: 1,
        theme: "dark",
        locale: "pl",
      });
      _resetPreferencesForTests();
      rmSync(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  it("a newer version is kept in memory and the file is never rewritten", async () => {
    freshDir();
    const raw = JSON.stringify({ version: 2, newShape: { left: 240 } });
    writeFileSync(file(), raw, "utf8");

    expect(loadPreferences(file())).toEqual({ version: 2, newShape: { left: 240 } });
    expect(getPreferences().version).toBe(2);

    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    const inoBefore = statSync(file()).ino;

    patchPreferences({ theme: "dark" });
    await flushPreferences();

    // byte-for-byte untouched
    expect(readFileSync(file(), "utf8")).toBe(raw);
    expect(statSync(file()).ino).toBe(inoBefore);
    expect(filesUnder(dir)).toEqual(["preferences.json"]);

    // and the store said why, once
    const said = warnings.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(said).toMatch(/newer/i);
    expect(said).toMatch(/version/i);
    expect(warnings).toHaveBeenCalledTimes(1);

    patchPreferences({ locale: "pl" });
    await flushPreferences();
    expect(readFileSync(file(), "utf8")).toBe(raw);
    expect(warnings).toHaveBeenCalledTimes(1); // logged once, not per write
  });
});
