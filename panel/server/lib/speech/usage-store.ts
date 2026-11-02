import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getConfig } from "../../config.js";
import { machineHostname } from "../hostname.js";

/**
 * Speech usage: characters sent to speech engines, kept per month × engine in one JSON file per
 * host (`<dir>/<host>.json` = `{ "YYYY-MM": { "<engine>": chars } }`). Each host writes only its
 * own file, so auto-sync never has to merge; readers sum every host file.
 */

export interface UsageMonth {
  month: string;
  engines: Record<string, number>;
  total: number;
}

export interface UsageStore {
  record(engine: string, chars: number, now?: Date): Promise<void>;
  /** At most USAGE_MONTHS_KEPT months, newest first, summed across hosts. */
  readAll(): Promise<UsageMonth[]>;
}

export const USAGE_MONTHS_KEPT = 6;

type Counts = Record<string, number>;
type HostData = Record<string, Counts>;

const MONTH_KEY = /^\d{4}-\d{2}$/;

// Engine ids are external strings, so every map is prototype-less: "constructor" or
// "__proto__" must be plain keys, not inherited members.
function emptyMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** Month key in the server's local time, e.g. "2026-10". */
function monthKey(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Parses one host file into prototype-less maps, keeping only month keys and
 * non-negative integer counts. Throws on invalid JSON.
 */
function parseHost(raw: string): HostData {
  const parsed: unknown = JSON.parse(raw);
  const data = emptyMap<Counts>();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return data;
  for (const [month, engines] of Object.entries(parsed)) {
    if (!MONTH_KEY.test(month) || !engines || typeof engines !== "object") continue;
    const counts = emptyMap<number>();
    for (const [engine, chars] of Object.entries(engines as object)) {
      if (Number.isSafeInteger(chars) && (chars as number) >= 0) counts[engine] = chars as number;
    }
    data[month] = counts;
  }
  return data;
}

/** Month keys sort lexically in time order; newest first. */
function newestMonths(months: Iterable<string>): string[] {
  return [...months].sort().reverse().slice(0, USAGE_MONTHS_KEPT);
}

export function createUsageStore(opts: { dir?: string; host?: string } = {}): UsageStore {
  const dir = opts.dir ?? join(getConfig().projectsDir, ".panel", "tts-usage");
  const host = opts.host ?? machineHostname();
  const file = join(dir, `${host}.json`);

  // Every record is a read-modify-write of the host file; chaining them keeps
  // concurrent callers from reading the same snapshot and dropping an increment.
  // Serialization is per store instance (per process): two stores on one file are not.
  let chain: Promise<void> = Promise.resolve();

  async function readOwn(): Promise<HostData> {
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (err) {
      // Missing file → start fresh. Any other read error (EACCES, EIO, EISDIR) rejects the
      // record instead: treating it as empty would overwrite the file and wipe its history.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyMap<Counts>();
      throw err;
    }
    try {
      return parseHost(raw);
    } catch (err) {
      // A malformed own file is overwritten by this record.
      console.warn(`[tts-usage] resetting malformed ${file}:`, (err as Error).message);
      return emptyMap<Counts>();
    }
  }

  async function write(data: HostData): Promise<void> {
    await mkdir(dir, { recursive: true });
    // Tmp file in the same dir, then rename over the host file: a crash never leaves half a file.
    const temp = join(dir, `.${host}.json.${randomBytes(6).toString("hex")}.tmp`);
    try {
      await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`);
      await rename(temp, file);
    } catch (err) {
      await rm(temp, { force: true });
      throw err;
    }
  }

  async function apply(engine: string, chars: number, month: string): Promise<void> {
    const data = await readOwn();
    const counts = data[month] ?? emptyMap<number>();
    counts[engine] = (counts[engine] ?? 0) + chars;
    data[month] = counts;
    const kept = emptyMap<Counts>();
    for (const m of newestMonths(Object.keys(data))) kept[m] = data[m];
    await write(kept);
  }

  return {
    record(engine, chars, now = new Date()) {
      if (typeof engine !== "string" || engine === "") return Promise.resolve();
      if (!Number.isSafeInteger(chars) || chars <= 0) return Promise.resolve();
      const month = monthKey(now);
      const next = chain.then(() => apply(engine, chars, month));
      // Keep the chain alive after a failed write; the caller still sees the rejection.
      chain = next.catch(() => {});
      return next;
    },

    async readAll() {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      }
      const sums = emptyMap<Counts>();
      for (const name of names) {
        if (!name.endsWith(".json") || name.startsWith(".")) continue;
        let data: HostData;
        try {
          data = parseHost(await readFile(join(dir, name), "utf8"));
        } catch (err) {
          console.warn(`[tts-usage] skipping malformed ${name}:`, (err as Error).message);
          continue;
        }
        for (const month of Object.keys(data)) {
          const into = (sums[month] ??= emptyMap<number>());
          for (const [engine, chars] of Object.entries(data[month])) {
            into[engine] = (into[engine] ?? 0) + chars;
          }
        }
      }
      return newestMonths(Object.keys(sums)).map((month) => {
        const engines = sums[month];
        const total = Object.values(engines).reduce((a, b) => a + b, 0);
        return { month, engines, total };
      });
    },
  };
}
