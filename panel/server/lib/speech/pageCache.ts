import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The page audio cache: one folder per page (`sha256(docKey)` hex) under the
 * root, holding `page.json` and one `<sha256(unit text)>.mp3` per cached unit.
 * Every id is checked against `HASH_RE` before any path is built, so no caller
 * can address a file outside the root.
 *
 * `page.json` is `{ docKey, seq, units: { <hash>: <seq> } }`: `seq` ticks once
 * per write of the page, and each unit keeps the `seq` of its last write. A
 * listing answers the page's `seq`, and a prune names the `seq` it saw, so it
 * only removes what that listing could have shown — never a unit a newer
 * revision uploaded after it. A unit with no recorded `seq` (a cache from
 * before this was kept) counts as `0`, seen by every listing.
 */

export const PAGE_CACHE_DIR = ".pavilio/speech-cache"; // under os.homedir()
export const HASH_RE = /^[0-9a-f]{64}$/;

export interface PageCacheTotals {
  pages: number;
  units: number;
  bytes: number;
}

/**
 * A write whose epoch is no longer the page's: a clear of the page or a wipe
 * was asked for after the writer read its epoch. Nothing was written.
 */
export class PageCacheEpochError extends Error {
  constructor(page: string) {
    super(`page cache: page ${page} was cleared since its epoch was read`);
    this.name = "PageCacheEpochError";
  }
}

export interface PageListing {
  units: { hash: string; bytes: number }[];
  seq: number;
}

/** What `page.json` holds. */
interface PageMeta {
  docKey?: string;
  seq: number;
  units: Record<string, number>;
}

export interface PageCacheStore {
  /**
   * The page's current epoch: an opaque token that changes the moment a clear
   * of the page or a wipe is asked for, and with every restart. A writer reads
   * it before it starts (the GET that missed) and hands it to {@link write}.
   */
  epoch(page: string): string;
  /** The page's units and its current write `seq` (`0` for an unknown page). */
  list(page: string): Promise<PageListing>;
  read(page: string, unit: string): Promise<Buffer | undefined>;
  /** Rejects with {@link PageCacheEpochError}, writing nothing, when `epoch` is no longer the page's. */
  write(page: string, unit: string, bytes: Buffer, docKey: string, epoch: string): Promise<void>;
  /**
   * Removes the page's units not in `keep` that were written at or before
   * `seq` (the listing's), and resolves to how many. Rejects with
   * {@link PageCacheEpochError}, removing nothing, when `epoch` is stale.
   */
  prune(page: string, keep: readonly string[], seq: number, epoch: string): Promise<number>;
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

/** The page's `page.json`, or an empty one when it is missing, unreadable or from before `seq` was kept. */
async function readMeta(dir: string): Promise<PageMeta> {
  let raw: string;
  try {
    raw = await readFile(join(dir, "page.json"), "utf8");
  } catch (error) {
    if (isMissing(error)) return { seq: 0, units: {} };
    throw error;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PageMeta> | null;
    const seq = Number.isSafeInteger(parsed?.seq) && parsed!.seq! >= 0 ? parsed!.seq! : 0;
    const units: Record<string, number> = {};
    for (const [hash, at] of Object.entries(parsed?.units ?? {})) {
      if (HASH_RE.test(hash) && Number.isSafeInteger(at)) units[hash] = at;
    }
    return { docKey: typeof parsed?.docKey === "string" ? parsed.docKey : undefined, seq, units };
  } catch {
    return { seq: 0, units: {} };
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
  /**
   * The fence against a write that outlives a clear: a PUT body still in
   * flight when DELETE answered (a proxy holding it, a slow client) carries
   * the epoch read before the clear, so it is refused instead of recreating
   * the cleared audio. Both counters move when the clear or wipe is *asked
   * for*, not when it runs, so a write already queued behind it is refused
   * too. In memory only: `bootId` makes every token from before a restart
   * stale, so the counters never need persisting.
   */
  const bootId = randomBytes(6).toString("hex");
  let wipes = 0;
  /** page → clears asked for since the last wipe. */
  const clears = new Map<string, number>();
  const epoch = (page: string) => `${bootId}.${wipes}.${clears.get(page) ?? 0}`;

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

  async function list(page: string): Promise<PageListing> {
    checkId("page", page);
    // `seq` read first: a unit written meanwhile shows up with a newer seq than
    // the one answered, so a prune based on this listing still spares it.
    const { seq } = await readMeta(pageDir(page));
    return { units: await unitsOf(page), seq };
  }

  async function unitsOf(page: string): Promise<{ hash: string; bytes: number }[]> {
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
      for (const unit of await unitsOf(page)) {
        sum.units += 1;
        sum.bytes += unit.bytes;
      }
    }
    return sum;
  }

  return {
    epoch,
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

    async write(page, unit, bytes, docKey, writerEpoch) {
      checkId("page", page);
      checkId("unit", unit);
      const dir = pageDir(page);
      await serial(page, async () => {
        // Checked on its turn, not on arrival: a clear asked for while this
        // write waited in the queue has moved the epoch on by now.
        if (writerEpoch !== epoch(page)) throw new PageCacheEpochError(page);
        await mkdir(dir, { recursive: true });
        const meta = await readMeta(dir);
        const seq = meta.seq + 1;
        const units = { ...meta.units, [unit]: seq };
        await writeAtomic(join(dir, "page.json"), JSON.stringify({ docKey, seq, units }));
        await writeAtomic(join(dir, `${unit}.mp3`), bytes);
      });
    },

    async prune(page, keep, seenSeq, prunerEpoch) {
      checkId("page", page);
      const kept = new Set(keep);
      const dir = pageDir(page);
      return serial(page, async () => {
        // A clear starts the page's seq over, so a listing from before it would
        // cover the new writes too: the epoch refuses such a prune outright.
        if (prunerEpoch !== epoch(page)) throw new PageCacheEpochError(page);
        const meta = await readMeta(dir);
        let removed = 0;
        for (const name of await entries(dir)) {
          const hash = UNIT_FILE.exec(name)?.[1];
          if (!hash || kept.has(hash)) continue;
          // Written after the pruner's listing: a newer revision's, not an orphan it saw.
          if ((meta.units[hash] ?? 0) > seenSeq) continue;
          await rm(join(dir, name), { force: true });
          delete meta.units[hash];
          removed += 1;
        }
        if (removed > 0 && meta.docKey !== undefined) {
          await writeAtomic(join(dir, "page.json"), JSON.stringify(meta));
        }
        return removed;
      });
    },

    async clearPage(page) {
      checkId("page", page);
      clears.set(page, (clears.get(page) ?? 0) + 1);
      await serial(page, () => rm(pageDir(page), { recursive: true, force: true }));
    },

    async wipe() {
      // Every page's epoch moves at once; the per-page counts start over under the new wipe count.
      wipes += 1;
      clears.clear();
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
