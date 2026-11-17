import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The answer audio disk store: one `<sha256(key)>.mp3` per synthesized answer
 * unit, flat under the root. A file lives for {@link ANSWER_CACHE_TTL_MS}
 * from its last write (its mtime); reading never touches the mtime, so a
 * replayed answer does not stay forever. Expired files are a miss on read and
 * are removed by {@link AnswerAudioCache.sweep}.
 *
 * The store is a best-effort accelerator: a disk failure turns a read into a
 * miss and a write into a no-op, logging one warning per failure kind for the
 * life of the store instead of one per request.
 */

export const ANSWER_CACHE_DIR = ".pavilio/speech-cache/answers"; // under os.homedir()
export const ANSWER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface AnswerKey {
  engine: string;
  voice?: string;
  lang?: string;
  text: string;
}

export interface AnswerSweepTotals {
  removedFiles: number;
  removedBytes: number;
  keptFiles: number;
  keptBytes: number;
}

export interface AnswerAudioCache {
  /** `undefined` = miss: absent, expired, or a disk error. */
  read(key: AnswerKey): Promise<Uint8Array | undefined>;
  /** Atomic (temp file + rename); errors are swallowed. */
  write(key: AnswerKey, bytes: Uint8Array): Promise<void>;
  /** Deletes files older than the TTL and reports what was removed and kept. */
  sweep(): Promise<AnswerSweepTotals>;
  /** Deletes every file under the root. */
  clear(): Promise<void>;
}

type FailureKind = "read" | "write" | "sweep";

function fileName(key: AnswerKey): string {
  const id = JSON.stringify([key.engine, key.voice ?? "", key.lang ?? "", key.text]);
  return `${createHash("sha256").update(id).digest("hex")}.mp3`;
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}

export function createAnswerAudioCache(opts: { root?: string; now?: () => number } = {}): AnswerAudioCache {
  const root = opts.root ?? join(homedir(), ANSWER_CACHE_DIR);
  const now = opts.now ?? Date.now;
  const warned = new Set<FailureKind>();

  function warnOnce(kind: FailureKind, err: unknown): void {
    if (warned.has(kind)) return;
    warned.add(kind);
    console.warn(`[answer-audio-cache] ${kind} failed under ${root}:`, (err as Error)?.message ?? err);
  }

  return {
    async read(key) {
      const file = join(root, fileName(key));
      try {
        const info = await stat(file);
        if (now() - info.mtimeMs > ANSWER_CACHE_TTL_MS) return undefined;
        return new Uint8Array(await readFile(file));
      } catch (err) {
        if (!isMissing(err)) warnOnce("read", err);
        return undefined;
      }
    },

    async write(key, bytes) {
      const file = join(root, fileName(key));
      const temp = join(root, `.tmp-${randomBytes(6).toString("hex")}`);
      try {
        await mkdir(root, { recursive: true });
        await writeFile(temp, bytes);
        await rename(temp, file);
      } catch (err) {
        warnOnce("write", err);
        await rm(temp, { force: true }).catch(() => {});
      }
    },

    async sweep() {
      const totals: AnswerSweepTotals = { removedFiles: 0, removedBytes: 0, keptFiles: 0, keptBytes: 0 };
      let names: string[];
      try {
        names = await readdir(root);
      } catch (err) {
        if (!isMissing(err)) warnOnce("sweep", err);
        return totals;
      }
      const at = now();
      for (const name of names) {
        const file = join(root, name);
        try {
          const info = await stat(file);
          if (!info.isFile()) continue;
          if (at - info.mtimeMs > ANSWER_CACHE_TTL_MS) {
            await unlink(file);
            totals.removedFiles += 1;
            totals.removedBytes += info.size;
          } else {
            totals.keptFiles += 1;
            totals.keptBytes += info.size;
          }
        } catch (err) {
          if (!isMissing(err)) warnOnce("sweep", err);
        }
      }
      return totals;
    },

    async clear() {
      let names: string[];
      try {
        names = await readdir(root);
      } catch (err) {
        if (isMissing(err)) return;
        throw err;
      }
      await Promise.all(names.map((name) => rm(join(root, name), { recursive: true, force: true })));
    },
  };
}
