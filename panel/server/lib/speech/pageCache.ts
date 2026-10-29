import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The page audio cache: one folder per page (`sha256(docKey)` hex) under the
 * root, holding `page.json` (`{ "docKey": … }`) and one `<sha256(unit text)>.mp3`
 * per cached unit. Every id is checked against `HASH_RE` before any path is
 * built, so no caller can address a file outside the root.
 */

export const PAGE_CACHE_DIR = ".pavilio/speech-cache"; // under os.homedir()
export const HASH_RE = /^[0-9a-f]{64}$/;

export interface PageCacheTotals {
  pages: number;
  units: number;
  bytes: number;
}

export interface PageCacheStore {
  list(page: string): Promise<{ hash: string; bytes: number }[]>;
  read(page: string, unit: string): Promise<Buffer | undefined>;
  write(page: string, unit: string, bytes: Buffer, docKey: string): Promise<void>;
  prune(page: string, keep: readonly string[]): Promise<number>; // files removed
  clearPage(page: string): Promise<void>;
  totals(): Promise<PageCacheTotals>;
  wipe(): Promise<PageCacheTotals>; // freed
}

const UNIT_FILE = /^([0-9a-f]{64})\.mp3$/;

function checkId(kind: "page" | "unit", id: string): void {
  if (typeof id !== "string" || !HASH_RE.test(id)) {
    throw new RangeError(`page cache: ${kind} id must be 64 lowercase hex chars`);
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

/** Directory entries, or none when the directory does not exist. */
async function entries(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

/** Write to a `.tmp-<random>` sibling, then rename into place, so no reader sees half a file. */
async function writeAtomic(file: string, data: Buffer | string): Promise<void> {
  const temp = `${file}.tmp-${randomBytes(6).toString("hex")}`;
  try {
    await writeFile(temp, data, { flag: "wx" });
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export function createPageCacheStore(opts: { root?: string } = {}): PageCacheStore {
  const root = opts.root ?? join(homedir(), PAGE_CACHE_DIR);
  const pageDir = (page: string) => join(root, page);
  /**
   * page → the tail of its mutation chain. A write, a prune and a clear of the
   * same page run one after another, so a clear never interleaves with a write
   * that would recreate the folder under it.
   */
  const chains = new Map<string, Promise<void>>();
  /**
   * Settles when the last wipe asked for has run. Every page's mutations wait
   * for it, so a write asked for after a wipe cannot interleave with its
   * removal — and a wipe waits for every page's queue before it starts.
   */
  let wiping: Promise<void> = Promise.resolve();

  function serial<T>(page: string, work: () => Promise<T>): Promise<T> {
    const next = Promise.all([chains.get(page), wiping]).then(work);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    chains.set(page, tail);
    void tail.then(() => {
      if (chains.get(page) === tail) chains.delete(page);
    });
    return next;
  }

  async function list(page: string): Promise<{ hash: string; bytes: number }[]> {
    checkId("page", page);
    const dir = pageDir(page);
    const units: { hash: string; bytes: number }[] = [];
    for (const name of await entries(dir)) {
      const hash = UNIT_FILE.exec(name)?.[1];
      if (!hash) continue;
      try {
        units.push({ hash, bytes: (await stat(join(dir, name))).size });
      } catch (error) {
        // Removed by a concurrent prune or clear between readdir and stat.
        if (!isMissing(error)) throw error;
      }
    }
    return units;
  }

  async function totals(): Promise<PageCacheTotals> {
    const sum: PageCacheTotals = { pages: 0, units: 0, bytes: 0 };
    for (const page of await entries(root)) {
      if (!HASH_RE.test(page)) continue;
      sum.pages += 1;
      for (const unit of await list(page)) {
        sum.units += 1;
        sum.bytes += unit.bytes;
      }
    }
    return sum;
  }

  return {
    list,
    totals,

    async read(page, unit) {
      checkId("page", page);
      checkId("unit", unit);
      try {
        return await readFile(join(pageDir(page), `${unit}.mp3`));
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
    },

    async write(page, unit, bytes, docKey) {
      checkId("page", page);
      checkId("unit", unit);
      const dir = pageDir(page);
      await serial(page, async () => {
        await mkdir(dir, { recursive: true });
        await writeAtomic(join(dir, "page.json"), JSON.stringify({ docKey }));
        await writeAtomic(join(dir, `${unit}.mp3`), bytes);
      });
    },

    async prune(page, keep) {
      checkId("page", page);
      const kept = new Set(keep);
      const dir = pageDir(page);
      return serial(page, async () => {
        let removed = 0;
        for (const name of await entries(dir)) {
          const hash = UNIT_FILE.exec(name)?.[1];
          if (!hash || kept.has(hash)) continue;
          await rm(join(dir, name), { force: true });
          removed += 1;
        }
        return removed;
      });
    },

    async clearPage(page) {
      checkId("page", page);
      await serial(page, () => rm(pageDir(page), { recursive: true, force: true }));
    },

    async wipe() {
      // Taken before `wiping` is replaced, so it holds only work asked for before this wipe.
      const before = Promise.all([...chains.values(), wiping]);
      const run = before.then(async () => {
        const freed = await totals();
        for (const name of await entries(root)) {
          await rm(join(root, name), { recursive: true, force: true });
        }
        return freed;
      });
      wiping = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}
