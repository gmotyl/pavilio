import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ANSWER_SUBDIR, PAGE_CACHE_DIR } from "./pageCache.js";

/**
 * The answer audio disk store, flat under the root: one `<sha256(key)>.mp3`
 * per synthesized answer unit and, beside it, an optional
 * `<sha256(key)>.speaker.json` record (see {@link AnswerRecordKind}). A file lives for {@link ANSWER_CACHE_TTL_MS}
 * from its last write (its mtime); reading never touches the mtime, so a
 * replayed answer does not stay forever. Expired files are a miss on read and
 * are removed by {@link AnswerAudioCache.sweep}.
 *
 * The store is a best-effort accelerator: a disk failure turns a read into a
 * miss and a write into a no-op, logging one warning per failure kind for the
 * life of the store instead of one per request.
 */

export const ANSWER_CACHE_DIR = join(PAGE_CACHE_DIR, ANSWER_SUBDIR); // under os.homedir()
export const ANSWER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface AnswerKey {
  engine: string;
  voice?: string;
  lang?: string;
  text: string;
}

/**
 * What a file under a key holds: the unit's audio (`.mp3`) or the JSON record
 * of who spoke it (`.speaker.json`). Both share the key's hash, so a unit's
 * files sit side by side and every kind is swept and cleared alike.
 */
export type AnswerRecordKind = "audio" | "speaker";

const EXTENSION: Record<AnswerRecordKind, string> = { audio: ".mp3", speaker: ".speaker.json" };

/**
 * `*Units` count committed audio files only — one per cached answer unit, the
 * number a reader of the startup log cares about. `*Bytes` count every file
 * under the root at sweep time, the real disk footprint, speaker records
 * included. Every write runs entirely under the store lock, so the sweep never
 * sees a write half done and the totals are exact for the directory it saw: a
 * write queued during the sweep lands after it and is not counted. A `.tmp-*`
 * file the sweep sees is an orphan of a crashed process and is judged by age
 * like any other file.
 */
export interface AnswerSweepTotals {
  removedUnits: number;
  removedBytes: number;
  keptUnits: number;
  keptBytes: number;
}

export interface AnswerAudioCache {
  /** `undefined` = miss: absent, expired, or a disk error. */
  read(key: AnswerKey, kind?: AnswerRecordKind): Promise<Uint8Array | undefined>;
  /** Atomic (temp file + rename); errors are swallowed. `kind` defaults to `"audio"`. */
  write(key: AnswerKey, bytes: Uint8Array, kind?: AnswerRecordKind): Promise<void>;
  /** Deletes files older than the TTL and reports what was removed and kept (see {@link AnswerSweepTotals}). */
  sweep(): Promise<AnswerSweepTotals>;
  /** Deletes every file under the root; a write started before the clear never lands after it. */
  clear(): Promise<void>;
}

type FailureKind = "read" | "write" | "sweep";

function fileName(key: AnswerKey, kind: AnswerRecordKind): string {
  const id = JSON.stringify([key.engine, key.voice ?? "", key.lang ?? "", key.text]);
  return `${createHash("sha256").update(id).digest("hex")}${EXTENSION[kind]}`;
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}

export function createAnswerAudioCache(opts: { root?: string; now?: () => number } = {}): AnswerAudioCache {
  const root = opts.root ?? join(homedir(), ANSWER_CACHE_DIR);
  const now = opts.now ?? Date.now;
  const warned = new Set<FailureKind>();
  // Every mutation of the root (a whole write, sweep, clear) runs through one
  // in-process FIFO lock, so none of them interleave. The server is a single
  // process; reads stay lock-free because commits are atomic renames. Writes
  // are small and synthesis happens before them, so serializing the disk
  // write costs next to nothing.
  let tail: Promise<unknown> = Promise.resolve();
  function serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn, fn);
    tail = run.catch(() => {});
    return run;
  }
  // Clear generation, bumped when clear() is called. A write remembers it at
  // its start and commits only if no clear was called since.
  let generation = 0;

  function warnOnce(kind: FailureKind, err: unknown): void {
    if (warned.has(kind)) return;
    warned.add(kind);
    console.warn(`[answer-audio-cache] ${kind} failed under ${root}:`, (err as Error)?.message ?? err);
  }

  return {
    async read(key, kind = "audio") {
      const file = join(root, fileName(key, kind));
      try {
        const info = await stat(file);
        if (now() - info.mtimeMs > ANSWER_CACHE_TTL_MS) return undefined;
        return new Uint8Array(await readFile(file));
      } catch (err) {
        if (!isMissing(err)) warnOnce("read", err);
        return undefined;
      }
    },

    async write(key, bytes, kind = "audio") {
      const file = join(root, fileName(key, kind));
      const temp = join(root, `.tmp-${randomBytes(6).toString("hex")}`);
      const startedAt = generation;
      await serialize(async () => {
        // A clear was called after this write started: it must not land.
        if (generation !== startedAt) return;
        try {
          await mkdir(root, { recursive: true });
          await writeFile(temp, bytes);
          await rename(temp, file);
        } catch (err) {
          // ENOENT: the root vanished under the write. A lost race, not a
          // broken disk, so it keeps the one warning.
          if (!isMissing(err)) warnOnce("write", err);
          await rm(temp, { force: true }).catch(() => {});
        }
      });
    },

    sweep() {
      return serialize(async () => {
        const totals: AnswerSweepTotals = { removedUnits: 0, removedBytes: 0, keptUnits: 0, keptBytes: 0 };
        let names: string[];
        try {
          names = await readdir(root);
        } catch (err) {
          if (!isMissing(err)) warnOnce("sweep", err);
          return totals;
        }
        const at = now();
        for (const name of names) {
          try {
            const file = join(root, name);
            const info = await stat(file);
            if (!info.isFile()) continue;
            const unit = name.endsWith(EXTENSION.audio) ? 1 : 0;
            if (at - info.mtimeMs > ANSWER_CACHE_TTL_MS) {
              await unlink(file);
              totals.removedUnits += unit;
              totals.removedBytes += info.size;
            } else {
              totals.keptUnits += unit;
              totals.keptBytes += info.size;
            }
          } catch (err) {
            if (!isMissing(err)) warnOnce("sweep", err);
          }
        }
        return totals;
      });
    },

    clear() {
      generation += 1;
      return serialize(async () => {
        let names: string[];
        try {
          names = await readdir(root);
        } catch (err) {
          if (isMissing(err)) return;
          throw err;
        }
        // No write is half done under the lock, so every file here (an
        // orphaned temp file included) is fair game.
        await Promise.all(names.map((name) => rm(join(root, name), { recursive: true, force: true })));
      });
    },
  };
}
