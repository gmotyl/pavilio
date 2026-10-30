import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPageCacheStore, PageCacheEpochError } from "../pageCache";

// The store root is a not-yet-existing child of a temp dir, so writes have to create it.
let tmp: string;
let root: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "panel-page-cache-"));
  root = join(tmp, "speech-cache");
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const hex = (char: string) => char.repeat(64);
const PAGE = hex("a");
const OTHER_PAGE = hex("b");
const U1 = hex("1");
const U2 = hex("2");
const U3 = hex("3");
const DOC_KEY = "doc:pavilio/notes/today.md";

describe("page cache store", () => {
  it("write then read round-trips the bytes", async () => {
    const store = createPageCacheStore({ root });
    const bytes = Buffer.from([1, 2, 3, 4, 5]);
    await store.write(PAGE, U1, bytes, DOC_KEY, store.epoch(PAGE));

    expect(readFileSync(join(root, PAGE, `${U1}.mp3`))).toEqual(bytes);
    expect(await store.read(PAGE, U1)).toEqual(bytes);
    expect(await store.read(PAGE, U2)).toBeUndefined();
    expect(await store.read(OTHER_PAGE, U1)).toBeUndefined();
  });

  it("write leaves no .tmp- files behind", async () => {
    const store = createPageCacheStore({ root });
    await store.write(PAGE, U1, Buffer.from("one"), DOC_KEY, store.epoch(PAGE));
    await store.write(PAGE, U2, Buffer.from("two"), DOC_KEY, store.epoch(PAGE));
    await store.write(PAGE, U1, Buffer.from("one again"), DOC_KEY, store.epoch(PAGE));

    expect(readdirSync(join(root, PAGE)).sort()).toEqual([`${U1}.mp3`, `${U2}.mp3`, "page.json"]);
    expect(await store.read(PAGE, U1)).toEqual(Buffer.from("one again"));
  });

  it("write records the doc key in page.json", async () => {
    const store = createPageCacheStore({ root });
    await store.write(PAGE, U1, Buffer.from("x"), DOC_KEY, store.epoch(PAGE));

    expect(JSON.parse(readFileSync(join(root, PAGE, "page.json"), "utf8"))).toEqual({ docKey: DOC_KEY });
  });

  it("list and totals are empty when the root is missing", async () => {
    const store = createPageCacheStore({ root });

    expect(await store.list(PAGE)).toEqual([]);
    expect(await store.totals()).toEqual({ pages: 0, units: 0, bytes: 0 });
    expect(existsSync(root)).toBe(false);
  });

  it("prune keeps only the listed hashes", async () => {
    const store = createPageCacheStore({ root });
    await store.write(PAGE, U1, Buffer.from("1"), DOC_KEY, store.epoch(PAGE));
    await store.write(PAGE, U2, Buffer.from("22"), DOC_KEY, store.epoch(PAGE));
    await store.write(PAGE, U3, Buffer.from("333"), DOC_KEY, store.epoch(PAGE));

    expect(await store.prune(PAGE, [U2])).toBe(2);
    expect(await store.list(PAGE)).toEqual([{ hash: U2, bytes: 2 }]);
    expect(existsSync(join(root, PAGE, "page.json"))).toBe(true);
    // An unknown page prunes nothing.
    expect(await store.prune(OTHER_PAGE, [])).toBe(0);
  });

  it("clearPage removes the page folder", async () => {
    const store = createPageCacheStore({ root });
    await store.write(PAGE, U1, Buffer.from("1"), DOC_KEY, store.epoch(PAGE));
    await store.write(OTHER_PAGE, U1, Buffer.from("1"), DOC_KEY, store.epoch(OTHER_PAGE));

    await store.clearPage(PAGE);
    expect(existsSync(join(root, PAGE))).toBe(false);
    expect(existsSync(join(root, OTHER_PAGE))).toBe(true);
    // Clearing an absent page is not an error.
    await store.clearPage(PAGE);
  });

  it("a clear asked for while a write is queued fences it off, so nothing is recreated", async () => {
    const store = createPageCacheStore({ root });
    const write = store.write(PAGE, U1, Buffer.from("late"), DOC_KEY, store.epoch(PAGE));
    const clear = store.clearPage(PAGE);

    await expect(write).rejects.toBeInstanceOf(PageCacheEpochError);
    await clear;
    expect(existsSync(join(root, PAGE))).toBe(false);
  });

  it("a write whose epoch predates a clear is refused, even when it arrives after the clear", async () => {
    const store = createPageCacheStore({ root });
    await store.write(PAGE, U1, Buffer.from("1"), DOC_KEY, store.epoch(PAGE));
    const before = store.epoch(PAGE);
    await store.clearPage(PAGE);

    // The late PUT body: its epoch was read before the clear.
    await expect(store.write(PAGE, U2, Buffer.from("late"), DOC_KEY, before)).rejects.toBeInstanceOf(
      PageCacheEpochError,
    );
    expect(existsSync(join(root, PAGE))).toBe(false);
    // Another page's epoch is untouched, and a fresh epoch writes again.
    expect(store.epoch(PAGE)).not.toBe(before);
    await store.write(PAGE, U2, Buffer.from("new"), DOC_KEY, store.epoch(PAGE));
    expect(await store.read(PAGE, U2)).toEqual(Buffer.from("new"));
  });

  it("a write queued behind another is re-checked when its turn comes", async () => {
    const store = createPageCacheStore({ root });
    const epoch = store.epoch(PAGE);
    // The first write holds the chain; the second is queued with the same epoch.
    const first = store.write(PAGE, U1, Buffer.from("1"), DOC_KEY, epoch);
    const queued = store.write(PAGE, U2, Buffer.from("2"), DOC_KEY, epoch);
    const wiped = store.wipe();

    await expect(first).rejects.toBeInstanceOf(PageCacheEpochError);
    await expect(queued).rejects.toBeInstanceOf(PageCacheEpochError);
    expect(await wiped).toEqual({ pages: 0, units: 0, bytes: 0 });
    expect(existsSync(root) ? readdirSync(root) : []).toEqual([]);
  });

  it("a write whose epoch predates a wipe is refused for every page", async () => {
    const store = createPageCacheStore({ root });
    const before = store.epoch(OTHER_PAGE);
    await store.wipe();

    await expect(store.write(OTHER_PAGE, U1, Buffer.from("late"), DOC_KEY, before)).rejects.toBeInstanceOf(
      PageCacheEpochError,
    );
    expect(existsSync(join(root, OTHER_PAGE))).toBe(false);
  });

  it("epochs do not survive a restart", () => {
    const one = createPageCacheStore({ root });
    const two = createPageCacheStore({ root });
    expect(one.epoch(PAGE)).not.toBe(two.epoch(PAGE));
  });

  it("wipe returns freed totals and empties the root", async () => {
    const store = createPageCacheStore({ root });
    await store.write(PAGE, U1, Buffer.from("1"), DOC_KEY, store.epoch(PAGE));
    await store.write(PAGE, U2, Buffer.from("22"), DOC_KEY, store.epoch(PAGE));
    await store.write(OTHER_PAGE, U3, Buffer.from("333"), DOC_KEY, store.epoch(OTHER_PAGE));

    expect(await store.totals()).toEqual({ pages: 2, units: 3, bytes: 6 });
    expect(await store.wipe()).toEqual({ pages: 2, units: 3, bytes: 6 });
    expect(existsSync(root) ? readdirSync(root) : []).toEqual([]);
    expect(await store.totals()).toEqual({ pages: 0, units: 0, bytes: 0 });
  });

  it("wipe asked for while a write is queued fences it off and leaves nothing behind", async () => {
    const store = createPageCacheStore({ root });
    await store.write(PAGE, U2, Buffer.from("old"), DOC_KEY, store.epoch(PAGE));
    const write = store.write(PAGE, U1, Buffer.from("late"), DOC_KEY, store.epoch(PAGE));
    const wiped = store.wipe();

    await expect(write).rejects.toBeInstanceOf(PageCacheEpochError);
    expect(await wiped).toEqual({ pages: 1, units: 1, bytes: 3 });
    expect(existsSync(root) ? readdirSync(root) : []).toEqual([]);
  });

  it("a write asked for during a wipe lands after it", async () => {
    const store = createPageCacheStore({ root });
    await store.write(PAGE, U1, Buffer.from("old"), DOC_KEY, store.epoch(PAGE));
    const wiped = store.wipe();
    const write = store.write(OTHER_PAGE, U2, Buffer.from("new"), DOC_KEY, store.epoch(OTHER_PAGE));
    await Promise.all([wiped, write]);

    expect(readdirSync(root)).toEqual([OTHER_PAGE]);
    expect(await store.read(OTHER_PAGE, U2)).toEqual(Buffer.from("new"));
  });

  it("a non-hex id is rejected before touching disk", async () => {
    const store = createPageCacheStore({ root });
    const bad = ["../etc", hex("A"), hex("a").slice(1), `${hex("a")}0`, "", hex("g")];
    for (const id of bad) {
      await expect(store.list(id)).rejects.toThrow(RangeError);
      await expect(store.read(id, U1)).rejects.toThrow(RangeError);
      await expect(store.read(PAGE, id)).rejects.toThrow(RangeError);
      await expect(store.write(id, U1, Buffer.from("x"), DOC_KEY, store.epoch(id))).rejects.toThrow(RangeError);
      await expect(store.write(PAGE, id, Buffer.from("x"), DOC_KEY, store.epoch(PAGE))).rejects.toThrow(RangeError);
      await expect(store.prune(id, [])).rejects.toThrow(RangeError);
      await expect(store.clearPage(id)).rejects.toThrow(RangeError);
    }
    expect(existsSync(root)).toBe(false);
  });
});
