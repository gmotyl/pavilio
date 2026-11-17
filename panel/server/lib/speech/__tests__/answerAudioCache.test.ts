import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANSWER_CACHE_TTL_MS, createAnswerAudioCache, type AnswerKey } from "../answerAudioCache";

// rename delegates to the real one unless a test sets `beforeRename`, which
// runs (and is awaited) between the temp file write and the rename (a racing
// clear()); it is handed the rename's source.
const hooks = vi.hoisted(() => ({
  beforeRename: undefined as ((from: string) => void | Promise<void>) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      const hook = hooks.beforeRename;
      hooks.beforeRename = undefined;
      await hook?.(from);
      return actual.rename(from, to);
    },
  };
});

// The store root is a not-yet-existing child of a temp dir, so writes have to create it.
let tmp: string;
let root: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "panel-answer-cache-"));
  root = join(tmp, "answers");
});
afterEach(() => {
  hooks.beforeRename = undefined;
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const KEY: AnswerKey = { engine: "edge", voice: "en-US-AvaNeural", lang: "en", text: "Hello there." };
const HOUR = 60 * 60 * 1000;

/** Sets every file under the root to the given mtime (ms since epoch). */
function ageAll(mtimeMs: number): void {
  for (const name of readdirSync(root)) {
    utimesSync(join(root, name), mtimeMs / 1000, mtimeMs / 1000);
  }
}

describe("answer audio cache", () => {
  it("write then read returns the stored bytes", async () => {
    const cache = createAnswerAudioCache({ root });
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    await cache.write(KEY, bytes);

    expect(Buffer.from((await cache.read(KEY))!)).toEqual(Buffer.from(bytes));
    expect(await cache.read({ ...KEY, text: "Something else." })).toBeUndefined();
    // One .mp3 named by a sha256 hex, no temp files left behind.
    expect(readdirSync(root)).toEqual([expect.stringMatching(/^[0-9a-f]{64}\.mp3$/)]);
  });

  it("another voice is a different entry", async () => {
    const cache = createAnswerAudioCache({ root });
    await cache.write(KEY, new Uint8Array([1]));

    expect(await cache.read({ ...KEY, voice: "en-US-AndrewNeural" })).toBeUndefined();
    expect(await cache.read({ ...KEY, engine: "openai" })).toBeUndefined();
    expect(await cache.read({ ...KEY, lang: "pl" })).toBeUndefined();
    expect(await cache.read({ engine: KEY.engine, text: KEY.text })).toBeUndefined();

    await cache.write({ ...KEY, voice: "en-US-AndrewNeural" }, new Uint8Array([2]));
    expect(Buffer.from((await cache.read(KEY))!)).toEqual(Buffer.from([1]));
    expect(Buffer.from((await cache.read({ ...KEY, voice: "en-US-AndrewNeural" }))!)).toEqual(Buffer.from([2]));
    expect(readdirSync(root)).toHaveLength(2);
  });

  it("a file older than 24 hours is a miss", async () => {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const cache = createAnswerAudioCache({ root, now: () => now });
    await cache.write(KEY, new Uint8Array([7]));

    ageAll(now - 23 * HOUR);
    expect(await cache.read(KEY)).toBeDefined();

    ageAll(now - ANSWER_CACHE_TTL_MS - 1000);
    expect(await cache.read(KEY)).toBeUndefined();
  });

  it("reading does not extend a file's life", async () => {
    let now = Math.floor(Date.now() / 1000) * 1000;
    const cache = createAnswerAudioCache({ root, now: () => now });
    await cache.write(KEY, new Uint8Array([7]));
    const written = now - 20 * HOUR;
    ageAll(written);

    expect(await cache.read(KEY)).toBeDefined();
    const [file] = readdirSync(root);
    expect(statSync(join(root, file)).mtimeMs).toBe(written);

    now += 5 * HOUR; // 25 h after the write
    expect(await cache.read(KEY)).toBeUndefined();
  });

  it("disk errors miss quietly with one warning per kind", async () => {
    // The root is a plain file: nothing under it can be created or read.
    writeFileSync(root, "not a directory");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache = createAnswerAudioCache({ root });

    expect(await cache.read(KEY)).toBeUndefined();
    expect(await cache.read(KEY)).toBeUndefined();
    await expect(cache.write(KEY, new Uint8Array([1]))).resolves.toBeUndefined();
    await expect(cache.write(KEY, new Uint8Array([1]))).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringContaining("read"),
      expect.stringContaining("write"),
    ]);
  });

  it("disk errors: an absent root is a quiet miss", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache = createAnswerAudioCache({ root });
    expect(await cache.read(KEY)).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("sweep removes expired files and reports removed and kept totals", async () => {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const cache = createAnswerAudioCache({ root, now: () => now });
    await cache.write({ ...KEY, text: "old one" }, new Uint8Array(10));
    await cache.write({ ...KEY, text: "old two" }, new Uint8Array(20));
    ageAll(now - 25 * HOUR);
    await cache.write({ ...KEY, text: "fresh" }, new Uint8Array(5));

    expect(await cache.sweep()).toEqual({ removedUnits: 2, removedBytes: 30, keptUnits: 1, keptBytes: 5 });
    expect(readdirSync(root)).toHaveLength(1);
    expect(await cache.read({ ...KEY, text: "fresh" })).toBeDefined();
  });

  it("a speaker record sits beside its audio as .speaker.json", async () => {
    const cache = createAnswerAudioCache({ root });
    const record = new TextEncoder().encode('{"engine":"edge","voice":"v"}');
    await cache.write(KEY, new Uint8Array([1, 2]));
    await cache.write(KEY, record, "speaker");

    const names = readdirSync(root).sort();
    expect(names).toEqual([
      expect.stringMatching(/^[0-9a-f]{64}\.mp3$/),
      expect.stringMatching(/^[0-9a-f]{64}\.speaker\.json$/),
    ]);
    // Same hash: the record names the unit it belongs to.
    expect(names[0]!.slice(0, 64)).toBe(names[1]!.slice(0, 64));
    expect(Buffer.from((await cache.read(KEY, "speaker"))!)).toEqual(Buffer.from(record));
    expect(Buffer.from((await cache.read(KEY))!)).toEqual(Buffer.from([1, 2]));
    expect(await cache.read({ ...KEY, text: "other" }, "speaker")).toBeUndefined();
  });

  it("sweep counts audio files as units and every file's bytes", async () => {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const cache = createAnswerAudioCache({ root, now: () => now });
    await cache.write({ ...KEY, text: "old" }, new Uint8Array(10));
    await cache.write({ ...KEY, text: "old" }, new Uint8Array(3), "speaker");
    ageAll(now - 25 * HOUR);
    await cache.write(KEY, new Uint8Array(5));
    await cache.write(KEY, new Uint8Array(2), "speaker");

    expect(await cache.sweep()).toEqual({ removedUnits: 1, removedBytes: 13, keptUnits: 1, keptBytes: 7 });
    expect(readdirSync(root)).toHaveLength(2);
  });

  it("a write whose temp file a clear removed does not use up the write warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache = createAnswerAudioCache({ root });
    mkdirSync(root, { recursive: true });
    // A clear() racing the write: the root vanishes between the temp write and the rename.
    let raced = false;
    hooks.beforeRename = () => {
      raced = true;
      rmSync(root, { recursive: true, force: true });
    };

    await expect(cache.write(KEY, new Uint8Array([1]))).resolves.toBeUndefined();
    expect(raced).toBe(true);
    expect(warn).not.toHaveBeenCalled();

    // A real disk failure afterwards still warns once.
    writeFileSync(root, "not a directory");
    await cache.write(KEY, new Uint8Array([1]));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("write");
  });

  it("sweep of a missing root reports zeros", async () => {
    const cache = createAnswerAudioCache({ root });
    expect(await cache.sweep()).toEqual({ removedUnits: 0, removedBytes: 0, keptUnits: 0, keptBytes: 0 });
  });

  it("clear deletes every answer file", async () => {
    const cache = createAnswerAudioCache({ root });
    await cache.write(KEY, new Uint8Array([1]));
    await cache.write({ ...KEY, text: "two" }, new Uint8Array([2]));
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "stray.tmp"), "x");

    await cache.clear();
    expect(existsSync(root) ? readdirSync(root) : []).toEqual([]);
    expect(await cache.read(KEY)).toBeUndefined();
  });

  it("a write that lands after a clear listed the root does not survive the clear", async () => {
    const cache = createAnswerAudioCache({ root });
    // The clear lists the root before the write's temp file is visible (it is
    // held outside the root while the clear runs), then the rename lands.
    hooks.beforeRename = async (from) => {
      const held = join(tmp, "held");
      renameSync(from, held);
      await cache.clear();
      renameSync(held, from);
    };

    await cache.write(KEY, new Uint8Array([1]));
    expect(await cache.read(KEY)).toBeUndefined();

    // A write after the clear is stored as usual.
    await cache.write(KEY, new Uint8Array([2]));
    expect(await cache.read(KEY)).toEqual(new Uint8Array([2]));
  });
});
