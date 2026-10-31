import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Wrap rename so the tests can prove the write goes through tmp file + rename.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

import { rename } from "node:fs/promises";
import { createUsageStore, USAGE_MONTHS_KEPT } from "../usage-store";

let root: string;
let dir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "panel-usage-"));
  // Not created up front: record has to create it.
  dir = join(root, "tts-usage");
  vi.mocked(rename).mockClear();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const hostFile = (host = "spock") => join(dir, `${host}.json`);
const readHost = (host = "spock") => JSON.parse(readFileSync(hostFile(host), "utf8"));
// Local-time constructor, so the expected key is the local month by construction.
const at = (year: number, month1: number, day = 15) => new Date(year, month1 - 1, day, 12);

describe("usage store", () => {
  it("record creates the host file with the local month key", async () => {
    const store = createUsageStore({ dir, host: "spock" });
    // Last minute of the local month: a UTC-based key would roll over in UTC+ zones.
    await store.record("azure", 5, new Date(2026, 9, 31, 23, 59));

    expect(readHost()).toEqual({ "2026-10": { azure: 5 } });
    // Atomic write: tmp file in the same dir renamed over the host file, nothing left behind.
    expect(rename).toHaveBeenCalledTimes(1);
    const [from, to] = vi.mocked(rename).mock.calls[0];
    expect(String(from).startsWith(dir)).toBe(true);
    expect(String(from)).not.toBe(hostFile());
    expect(to).toBe(hostFile());
    expect(readdirSync(dir)).toEqual(["spock.json"]);
  });

  it("record adds to an existing engine/month", async () => {
    const store = createUsageStore({ dir, host: "spock" });
    await store.record("azure", 5, at(2026, 10));
    await store.record("azure", 7, at(2026, 10));
    await store.record("eleven", 3, at(2026, 10));

    expect(readHost()).toEqual({ "2026-10": { azure: 12, eleven: 3 } });
  });

  it("concurrent records lose no increment", async () => {
    const store = createUsageStore({ dir, host: "spock" });
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.record("azure", i + 1, at(2026, 10))));

    expect(readHost()).toEqual({ "2026-10": { azure: 210 } });
  });

  it("a seventh month prunes the oldest", async () => {
    const store = createUsageStore({ dir, host: "spock" });
    for (let m = 1; m <= USAGE_MONTHS_KEPT + 1; m++) await store.record("azure", m, at(2026, m));

    const months = Object.keys(readHost()).sort();
    expect(months).toEqual(["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]);
  });

  it("invalid engine or chars are ignored", async () => {
    const store = createUsageStore({ dir, host: "spock" });
    await store.record("azure", 0, at(2026, 10));
    await store.record("azure", -3, at(2026, 10));
    await store.record("azure", 2.5, at(2026, 10));
    await store.record("azure", Number.NaN, at(2026, 10));
    await store.record("", 5, at(2026, 10));
    await store.record(undefined as unknown as string, 5, at(2026, 10));

    expect(readdirSync(root)).toEqual([]);
    expect(rename).not.toHaveBeenCalled();
  });

  it("readAll sums hosts per month and engine, newest first", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(hostFile("spock"), JSON.stringify({ "2026-09": { edge: 10 }, "2026-10": { edge: 1000 } }));
    writeFileSync(hostFile("laptop"), JSON.stringify({ "2026-10": { edge: 500, azure: 200 } }));

    const months = await createUsageStore({ dir, host: "spock" }).readAll();

    expect(months).toEqual([
      { month: "2026-10", engines: { edge: 1500, azure: 200 }, total: 1700 },
      { month: "2026-09", engines: { edge: 10 }, total: 10 },
    ]);

    // Older months from any host are cut at USAGE_MONTHS_KEPT, newest kept.
    const old: Record<string, Record<string, number>> = {};
    for (let m = 3; m <= 8; m++) old[`2026-0${m}`] = { edge: 1 };
    writeFileSync(hostFile("old"), JSON.stringify(old));
    const capped = await createUsageStore({ dir, host: "spock" }).readAll();
    expect(capped.map((m) => m.month)).toEqual(["2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05"]);
  });

  it("readAll skips a malformed host file", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(hostFile("spock"), "{ not json");
    writeFileSync(hostFile("laptop"), JSON.stringify({ "2026-10": { edge: 500 } }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const months = await createUsageStore({ dir, host: "spock" }).readAll();

    expect(months).toEqual([{ month: "2026-10", engines: { edge: 500 }, total: 500 }]);
    warn.mockRestore();
  });

  it("readAll on a missing dir returns empty", async () => {
    expect(await createUsageStore({ dir, host: "spock" }).readAll()).toEqual([]);
  });

  it("prototype-named engine ids are counted", async () => {
    const store = createUsageStore({ dir, host: "spock" });
    await store.record("constructor", 4, at(2026, 10));
    await store.record("constructor", 6, at(2026, 10));
    await store.record("__proto__", 2, at(2026, 10));

    expect(readHost()["2026-10"].constructor).toBe(10);
    const months = await store.readAll();
    expect(months).toHaveLength(1);
    expect(months[0].engines.constructor).toBe(10);
    expect(Object.getOwnPropertyDescriptor(months[0].engines, "__proto__")?.value).toBe(2);
    expect(months[0].total).toBe(12);
  });
});
