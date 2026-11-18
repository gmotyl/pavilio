import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANSWER_CACHE_TTL_MS, createAnswerAudioCache, type AnswerKey } from "../answerAudioCache";

// rename runs `beforeRename` (awaited) between the temp file write and the
// rename, handed the rename's source. stat runs `afterStat` once, with the
// stat'ed path, after the real stat resolved. Each hook fires once and clears
// itself.
//
// `events` records, in call order, the fs calls whose interleaving the lock
// tests assert on: `readdir <names>` (after it resolved), `stat <name>` (after
// it resolved), `writeFile <name>` (after the data is on disk), `unlink <name>`
// and `rename <from>` (when called). Names are basenames. Tests assert on it
// outside the hooks: a throw inside a hook would be swallowed by the store's
// own error handling.
const hooks = vi.hoisted(() => ({
  beforeRename: undefined as ((from: string) => void | Promise<void>) | undefined,
  afterStat: undefined as ((path: string) => void | Promise<void>) | undefined,
  events: [] as string[],
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const base = (path: unknown) => String(path).split(/[\\/]/).pop();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      hooks.events.push(`rename ${base(from)}`);
      const hook = hooks.beforeRename;
      hooks.beforeRename = undefined;
      await hook?.(from);
      return actual.rename(from, to);
    },
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      await actual.writeFile(...args);
      hooks.events.push(`writeFile ${base(args[0])}`);
    },
    stat: async (path: string) => {
      const info = await actual.stat(path);
      hooks.events.push(`stat ${base(path)}`);
      const hook = hooks.afterStat;
      hooks.afterStat = undefined;
      await hook?.(path);
      return info;
    },
    readdir: async (path: string) => {
      const names = await actual.readdir(path);
      hooks.events.push(`readdir ${[...names].sort().join(",")}`);
      return names;
    },
    unlink: async (path: string) => {
      hooks.events.push(`unlink ${base(path)}`);
      return actual.unlink(path);
    },
  };
});

/** A promise plus its resolver, for barriers between a test and a hook. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Lets every queued promise continuation run (a macrotask turn drains them all). */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Index of the first event that starts with `prefix` and satisfies `test`; -1 if none. */
function eventIndex(prefix: string, test: (rest: string) => boolean = () => true): number {
  return hooks.events.findIndex((e) => e.startsWith(`${prefix} `) && test(e.slice(prefix.length + 1)));
}

// The store root is a not-yet-existing child of a temp dir, so writes have to create it.
let tmp: string;
let root: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "panel-answer-cache-"));
  root = join(tmp, "answers");
  hooks.events = [];
});
afterEach(() => {
  hooks.beforeRename = undefined;
  hooks.afterStat = undefined;
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

  it("a write whose temp file vanished does not use up the write warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache = createAnswerAudioCache({ root });
    mkdirSync(root, { recursive: true });
    // The root vanishes between the temp write and the rename.
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

  it("a write that started before a clear never lands after it", async () => {
    const cache = createAnswerAudioCache({ root });
    // The write is called first, but its turn under the lock comes only after
    // the clear was called.
    const writing = cache.write(KEY, new Uint8Array([1]));
    const clearing = cache.clear();
    await Promise.all([writing, clearing]);

    expect(await cache.read(KEY)).toBeUndefined();
    expect(existsSync(root) ? readdirSync(root) : []).toEqual([]);
  });

  it("a write that started before a clear does not replace a later write", async () => {
    const cache = createAnswerAudioCache({ root });
    // Write A starts, a clear is called, then write B of the same key starts.
    const first = cache.write(KEY, new Uint8Array([1]));
    const clearing = cache.clear();
    const second = cache.write(KEY, new Uint8Array([2]));
    await Promise.all([first, clearing, second]);

    expect(await cache.read(KEY)).toEqual(new Uint8Array([2]));
    expect(readdirSync(root)).toHaveLength(1);
  });

  it("a write that started after a clear lands", async () => {
    const cache = createAnswerAudioCache({ root });
    await cache.write(KEY, new Uint8Array([1]));
    const audio = readdirSync(root)[0];
    hooks.events = [];
    // The sweep holds the lock (paused on its stat of the committed file)
    // while a clear and then a write are called; both queue behind it.
    const release = deferred();
    hooks.afterStat = () => release.promise;
    const sweeping = cache.sweep();
    await settle();
    const clearing = cache.clear();
    const writing = cache.write(KEY, new Uint8Array([2]));
    release.resolve();
    await Promise.all([sweeping, clearing, writing]);

    // Order: the clear lists the old audio, and only then the write creates
    // and commits its temp file.
    const clearList = hooks.events.lastIndexOf(`readdir ${audio}`);
    const tempWrite = eventIndex("writeFile", (name) => name.startsWith(".tmp-"));
    const commit = eventIndex("rename", (name) => name.startsWith(".tmp-"));
    expect(clearList).toBeGreaterThan(eventIndex("readdir"));
    expect(tempWrite).toBeGreaterThan(clearList);
    expect(commit).toBeGreaterThan(tempWrite);
    expect(await cache.read(KEY)).toEqual(new Uint8Array([2]));
    expect(readdirSync(root)).toEqual([audio]);
  });

  it("a write during a sweep commits after it", async () => {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const cache = createAnswerAudioCache({ root, now: () => now });
    await cache.write(KEY, new Uint8Array([1]));
    ageAll(now - 25 * HOUR);
    const audio = readdirSync(root)[0];
    hooks.events = [];
    // Between the sweep's stat of the expired file and its delete, a write of
    // fresh audio to the same key is called. The sweep resumes once the write
    // has finished or had ample time to (it cannot finish while the lock is
    // held, so that wait is what an unserialized write would race through).
    let writing: Promise<void> | undefined;
    hooks.afterStat = async () => {
      writing = cache.write(KEY, new Uint8Array([2, 2]));
      await Promise.race([writing, new Promise((resolve) => setTimeout(resolve, 50))]);
    };

    // Exact totals: the queued write is not part of what the sweep saw.
    expect(await cache.sweep()).toEqual({ removedUnits: 1, removedBytes: 1, keptUnits: 0, keptBytes: 0 });
    expect(writing).toBeDefined();
    await writing;

    // Order: the sweep lists the root and deletes the expired file before
    // the write creates its temp file and renames it.
    const sweepList = eventIndex("readdir");
    const expiredDelete = eventIndex("unlink", (name) => name === audio);
    const tempWrite = eventIndex("writeFile", (name) => name.startsWith(".tmp-"));
    const commit = eventIndex("rename", (name) => name.startsWith(".tmp-"));
    expect(sweepList).toBeGreaterThanOrEqual(0);
    expect(expiredDelete).toBeGreaterThan(sweepList);
    expect(tempWrite).toBeGreaterThan(expiredDelete);
    expect(commit).toBeGreaterThan(tempWrite);
    expect(await cache.read(KEY)).toEqual(new Uint8Array([2, 2]));
    expect(readdirSync(root)).toEqual([audio]);
  });

  it("sweep removes an expired orphaned temp file and clear removes a fresh one", async () => {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const cache = createAnswerAudioCache({ root, now: () => now });
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, ".tmp-orphan"), new Uint8Array(4));
    ageAll(now - 25 * HOUR);
    writeFileSync(join(root, ".tmp-fresh"), new Uint8Array(2));

    expect(await cache.sweep()).toEqual({ removedUnits: 0, removedBytes: 4, keptUnits: 0, keptBytes: 2 });
    expect(readdirSync(root)).toEqual([".tmp-fresh"]);
    await cache.clear();
    expect(readdirSync(root)).toEqual([]);
  });

  it("clear removes what a concurrent sweep would have kept", async () => {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const cache = createAnswerAudioCache({ root, now: () => now });
    await cache.write(KEY, new Uint8Array([1]));
    // A clear is requested while the sweep is judging the fresh file.
    let clearing: Promise<void> | undefined;
    hooks.afterStat = () => {
      clearing = cache.clear();
    };

    expect(await cache.sweep()).toEqual({ removedUnits: 0, removedBytes: 0, keptUnits: 1, keptBytes: 1 });
    await clearing;
    expect(await cache.read(KEY)).toBeUndefined();
    expect(readdirSync(root)).toEqual([]);
  });
});
