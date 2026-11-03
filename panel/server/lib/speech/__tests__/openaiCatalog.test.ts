import { afterEach, describe, it, expect, vi } from "vitest";
import type { VoiceInfo } from "anytts";
import { createOpenaiCatalog, resolveVoiceMap, type OpenaiCatalog } from "../openaiCatalog";
import type { OmniVoiceRecord } from "../../../../src/features/speech/openaiVoices";

const BASE = "http://127.0.0.1:8890";

/** An omnivoice-server voice record; the fields not given come back as the server sends them. */
function record(id: string, over: Partial<OmniVoiceRecord> = {}): OmniVoiceRecord {
  return {
    id,
    source: "bundled",
    language: "pl",
    locale: "pl-PL",
    gender: "female",
    label: `Voice ${id}`,
    multilingual: false,
    ref_text: "hello",
    description: null,
    ...over,
  };
}

/** `GET /v1/voices` as omnivoice-server answers it: `auto` first, then the saved voices. */
function listing(records: OmniVoiceRecord[]) {
  return {
    default: "auto",
    voices: [{ id: "auto", language: null, description: "model-chosen, varies per call" }, ...records],
  };
}

function jsonFetch(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch &
    ReturnType<typeof vi.fn>;
}

const voice = (id: string, locale: string, multilingual = false): VoiceInfo => ({
  id,
  locale,
  gender: "female",
  label: id,
  multilingual,
});

// Every catalog a test builds, disposed after it so no recovery timer outlives the test.
const built: OpenaiCatalog[] = [];
function track(catalog: OpenaiCatalog): OpenaiCatalog {
  built.push(catalog);
  return catalog;
}
const create: typeof createOpenaiCatalog = (options) => track(createOpenaiCatalog(options));
afterEach(() => {
  for (const catalog of built.splice(0)) catalog.dispose();
  vi.useRealTimers();
});

describe("openaiCatalog", () => {
  it("refresh maps records to voices and drops auto", async () => {
    const records = Array.from({ length: 18 }, (_, i) => record(`voice-${i}`));
    records[0] = record("my-voice", {
      source: "custom",
      locale: "pl-PL",
      gender: "male",
      label: "My voice (own recording)",
      multilingual: true,
    });
    const fetch = jsonFetch(listing(records));
    const onChange = vi.fn();
    const catalog = create({ baseUrl: () => `${BASE}/`, fetch, onChange });

    expect(catalog.current()).toEqual([]);
    const result = await catalog.refresh();

    expect(result).toEqual({ changed: true });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]![0])).toBe(`${BASE}/v1/voices`);
    expect(catalog.unreachable()).toBe(false);
    const current = catalog.current();
    expect(current).toHaveLength(18);
    expect(current.some((v) => v.id === "auto")).toBe(false);
    expect(current[0]).toEqual({
      id: "my-voice",
      locale: "pl-PL",
      gender: "male",
      label: "My voice (own recording)",
      multilingual: true,
      source: "custom",
    });
    expect(current[1]).toMatchObject({ id: "voice-1", source: "bundled", multilingual: false });
  });

  it("identical refresh reports no change", async () => {
    const fetch = jsonFetch(listing([record("pl-female"), record("en-male", { locale: "en-US" })]));
    const onChange = vi.fn();
    const catalog = create({ baseUrl: () => BASE, fetch, onChange });

    expect(await catalog.refresh()).toEqual({ changed: true });
    expect(await catalog.refresh()).toEqual({ changed: false });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("unreachable server keeps the last list", async () => {
    let mode: "up" | "down" | "hang" | "500" = "up";
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      if (mode === "up") return Promise.resolve(new Response(JSON.stringify(listing([record("pl-female")]))));
      if (mode === "500") return Promise.resolve(new Response("boom", { status: 500 }));
      if (mode === "down") return Promise.reject(new TypeError("fetch failed"));
      // Hangs until the catalog's timeout aborts it.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      });
    }) as unknown as typeof globalThis.fetch;
    const onChange = vi.fn();
    const catalog = create({ baseUrl: () => BASE, fetch, onChange, timeoutMs: 20 });

    await catalog.refresh();
    expect(catalog.current().map((v) => v.id)).toEqual(["pl-female"]);

    for (const next of ["down", "hang", "500"] as const) {
      mode = next;
      await expect(catalog.refresh()).resolves.toEqual({ changed: false });
      expect(catalog.unreachable()).toBe(true);
      expect(catalog.current().map((v) => v.id)).toEqual(["pl-female"]);
    }
    expect(onChange).toHaveBeenCalledTimes(1);

    // Back up: reachable again, list unchanged.
    mode = "up";
    await catalog.refresh();
    expect(catalog.unreachable()).toBe(false);
  });

  it("no address makes no request", async () => {
    let address: string | undefined;
    const fetch = jsonFetch(listing([record("pl-female")]));
    const onChange = vi.fn();
    const catalog = create({ baseUrl: () => address, fetch, onChange });

    expect(await catalog.refresh()).toEqual({ changed: false });
    expect(fetch).not.toHaveBeenCalled();
    expect(catalog.current()).toEqual([]);
    expect(catalog.unreachable()).toBe(false);
    expect(onChange).not.toHaveBeenCalled();

    // Once the address is removed again, the old list goes with it.
    address = BASE;
    await catalog.refresh();
    expect(catalog.current()).toHaveLength(1);
    address = undefined;
    expect(await catalog.refresh()).toEqual({ changed: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(catalog.current()).toEqual([]);
  });

  it("an address switch with a failed first refresh drops the old server's voices", async () => {
    let address = BASE;
    const OTHER = "http://127.0.0.1:9999";
    const fetch = vi.fn((url: string) => {
      if (url.startsWith(BASE)) return Promise.resolve(new Response(JSON.stringify(listing([record("a-only")]))));
      return Promise.reject(new TypeError("fetch failed"));
    }) as unknown as typeof globalThis.fetch;
    const onChange = vi.fn();
    const catalog = create({ baseUrl: () => address, fetch, onChange });

    await catalog.refresh();
    expect(catalog.current().map((v) => v.id)).toEqual(["a-only"]);
    expect(onChange).toHaveBeenCalledTimes(1);

    // Server B's address is saved while B is down: A's voices must not be offered to B.
    address = OTHER;
    expect(await catalog.refresh()).toEqual({ changed: true });
    expect(catalog.unreachable()).toBe(true);
    expect(catalog.current()).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(2);

    // Still down at the same address: nothing more to drop.
    expect(await catalog.refresh()).toEqual({ changed: false });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("a server down at startup is picked up by the recovery retries", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let up = false;
    const fetch = vi.fn(() =>
      up
        ? Promise.resolve(new Response(JSON.stringify(listing([record("pl-female")]))))
        : Promise.reject(new TypeError("fetch failed")),
    ) as unknown as typeof globalThis.fetch & ReturnType<typeof vi.fn>;
    const onChange = vi.fn();
    const catalog = create({ baseUrl: () => BASE, fetch, onChange });

    await catalog.refresh();
    expect(catalog.unreachable()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);

    // Backoff: 15 s, 30 s, then every 60 s.
    await vi.advanceTimersByTimeAsync(14_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(onChange).not.toHaveBeenCalled();

    // The server comes up: the next retry lands its voices and rebuilds the holder.
    up = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(catalog.unreachable()).toBe(false);
    expect(catalog.current().map((v) => v.id)).toEqual(["pl-female"]);
    expect(onChange).toHaveBeenCalledTimes(1);

    // Reachable: the retries stop.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("no address or a reachable server schedules no recovery", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let address: string | undefined;
    const fetch = jsonFetch(listing([record("pl-female")]));
    const catalog = create({ baseUrl: () => address, fetch, onChange: vi.fn() });

    await catalog.refresh();
    expect(vi.getTimerCount()).toBe(0);
    address = BASE;
    await catalog.refresh();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolveVoiceMap falls back by language then first voice", () => {
    const map = { pl: "my-voice", en: "my-voice", de: "my-voice", default: "my-voice" };

    // A voice that exists is kept.
    const withMine = [voice("en-male", "en-US"), voice("my-voice", "pl-PL", true)];
    expect(resolveVoiceMap(map, withMine)).toEqual(map);

    // Missing: the first voice in that language, a multilingual one counting for every language,
    // then the first voice overall.
    const catalog = [voice("en-male", "en-US"), voice("pl-female", "pl-PL"), voice("comic", "fr-FR", true)];
    expect(resolveVoiceMap(map, catalog)).toEqual({
      pl: "pl-female",
      en: "en-male",
      de: "comic",
      default: "comic",
    });
    expect(resolveVoiceMap(map, [voice("en-male", "en-US")])).toEqual({
      pl: "en-male",
      en: "en-male",
      de: "en-male",
      default: "en-male",
    });

    // No voices at all: nothing to pick from, the map is returned unchanged.
    expect(resolveVoiceMap(map, [])).toEqual(map);
  });
});
