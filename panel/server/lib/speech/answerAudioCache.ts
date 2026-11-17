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
 * `*Units` count audio files only — one per cached answer unit, the number a
 * reader of the startup log cares about; `*Bytes` count every file (speaker
 * records and stray temp files included), the real disk footprint.
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
  /** Deletes files older than the TTL and reports what was removed and kept. */
  sweep(): Promise<AnswerSweepTotals>;
  /** Deletes every file under the root; a write overlapping the clear is dropped too. */
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
  // A write that overlaps a clear() must not outlive it: one whose rename lands
  // after the clear listed the root would otherwise survive a DELETE that
  // already answered 204. `clears` counts finished clears, `clearing` running ones.
  let clears = 0;
  let clearing = 0;

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
      const clearsAtStart = clears;
      const overlappedClear = () => clearing > 0 || clears !== clearsAtStart;
      try {
        await mkdir(root, { recursive: true });
        await writeFile(temp, bytes);
        // A clear already overlapped the write: never commit, or the rename
        // could replace a newer write that landed after the clear.
        if (overlappedClear()) {
          await rm(temp, { force: true });
          return;
        }
        const own = await stat(temp);
        await rename(temp, file);
        // A clear ran during the rename: drop what it may have missed, but only
        // while the path still holds this write's file, not a later write's.
        if (overlappedClear()) {
          const current = await stat(file).catch(() => undefined);
          if (current && current.ino === own.ino && current.dev === own.dev) await rm(file, { force: true });
        }
      } catch (err) {
        // ENOENT: a clear() removed the temp file (or the root) mid-write. That
        // is a lost race, not a broken disk, so it keeps the one warning.
        if (!isMissing(err)) warnOnce("write", err);
        await rm(temp, { force: true }).catch(() => {});
      }
    },

    async sweep() {
      const totals: AnswerSweepTotals = { removedUnits: 0, removedBytes: 0, keptUnits: 0, keptBytes: 0 };
      let names: string[];
      try {
        names = await readdir(root);
      } catch (err) {
        if (!isMissing(err)) warnOnce("sweep", err);
        return totals;
      }
      const at = now();
      const expired = (mtimeMs: number) => at - mtimeMs > ANSWER_CACHE_TTL_MS;
      for (const name of names) {
        const file = join(root, name);
        try {
          let info = await stat(file);
          if (!info.isFile()) continue;
          const unit = name.endsWith(EXTENSION.audio) ? 1 : 0;
          if (expired(info.mtimeMs)) {
            // A write may have replaced the file since the stat: move it aside
            // and judge what was actually moved, so fresh audio is never deleted.
            const aside = join(root, `.tmp-${randomBytes(6).toString("hex")}`);
            await rename(file, aside);
            info = await stat(aside);
            if (expired(info.mtimeMs)) {
              await unlink(aside);
              totals.removedUnits += unit;
              totals.removedBytes += info.size;
              continue;
            }
            await rename(aside, file);
          }
          totals.keptUnits += unit;
          totals.keptBytes += info.size;
        } catch (err) {
          if (!isMissing(err)) warnOnce("sweep", err);
        }
      }
      return totals;
    },

    async clear() {
      clearing += 1;
      try {
        let names: string[];
        try {
          names = await readdir(root);
        } catch (err) {
          if (isMissing(err)) return;
          throw err;
        }
        await Promise.all(names.map((name) => rm(join(root, name), { recursive: true, force: true })));
      } finally {
        clearing -= 1;
        clears += 1;
      }
    },
  };
}
