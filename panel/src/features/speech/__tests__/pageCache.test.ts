import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpeechUnit } from "../types";

/**
 * `pageCache.ts` sits beside the seam: `synth.ts` is mocked (never anytts) and
 * `fetch` is a stub routed by method and path, so these tests pin what the
 * client asks the server for and what it falls back to.
 */
const synth = vi.hoisted(() => ({
  synthesizeSpeech: vi.fn(async (_text: string, _options?: unknown) => new Uint8Array([9, 9]).buffer),
  resetSpeechCache: vi.fn(),
  SPEECH_AUDIO_MIME_TYPE: "audio/mpeg",
}));

vi.mock("../synth", () => synth);

import {
  __resetPageCacheForTests,
  clearPage,
  loadPageList,
  pageAudio,
  pageCachedShare,
  pageUnitState,
  prunePage,
  subscribePageCache,
  wipeCache,
} from "../pageCache";

const BASE = "/api/speech/page-cache";
const DOC = "doc:pavilio/wiki/x.md";

function unit(text: string): SpeechUnit {
  return { text, chars: text.length, source: text };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

/** Routes `METHOD path` to a handler; anything unrouted answers 404. */
function stubFetch(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const handler = routes[`${init?.method ?? "GET"} ${url}`];
    return handler ? handler(init) : new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function calls(fetchMock: ReturnType<typeof stubFetch>, method: string): string[] {
  return fetchMock.mock.calls
    .filter(([, init]) => (init?.method ?? "GET") === method)
    .map(([input]) => String(input));
}

/** Lets fire-and-forget work (the upload) settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

let page: string;

beforeEach(async () => {
  __resetPageCacheForTests();
  synth.synthesizeSpeech.mockClear();
  synth.resetSpeechCache.mockClear();
  page = await sha256(DOC);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("pageAudio", () => {
  it("a disk hit returns the cached bytes without synthesizing", async () => {
    const u = unit("Hello there.");
    const hash = await sha256(u.text);
    stubFetch({
      [`GET ${BASE}/${page}/${hash}`]: () =>
        new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } }),
    });

    const bytes = await pageAudio(DOC, u, { voice: "v" });

    expect(Array.from(new Uint8Array(bytes))).toEqual([1, 2, 3]);
    expect(synth.synthesizeSpeech).not.toHaveBeenCalled();
    expect(pageUnitState(DOC, u)).toBe("ready");
  });

  it("a miss synthesizes and uploads", async () => {
    const u = unit("Not cached yet.");
    const hash = await sha256(u.text);
    const fetchMock = stubFetch({
      [`PUT ${BASE}/${page}/${hash}`]: () => new Response(null, { status: 204 }),
    });
    const listener = vi.fn();
    subscribePageCache(listener);

    const bytes = await pageAudio(DOC, u, { voice: "v", lang: "en" });
    await settle();

    expect(Array.from(new Uint8Array(bytes))).toEqual([9, 9]);
    expect(synth.synthesizeSpeech).toHaveBeenCalledWith(u.text, { voice: "v", lang: "en" });
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(put?.[0]).toBe(`${BASE}/${page}/${hash}`);
    const headers = new Headers(put?.[1]?.headers);
    expect(headers.get("Content-Type")).toBe("audio/mpeg");
    expect(decodeURIComponent(headers.get("x-doc-key") ?? "")).toBe(DOC);
    // The landed upload counts as cached and is in hand.
    expect(pageCachedShare(DOC, [u])).toEqual({ cached: 1, bytes: 2 });
    expect(pageUnitState(DOC, u)).toBe("ready");
    expect(listener).toHaveBeenCalled();
  });

  it("a failed fetch falls back to synthesis", async () => {
    const network = unit("Network down.");
    const empty = unit("Empty body.");
    const emptyHash = await sha256(empty.text);
    const networkHash = await sha256(network.text);
    stubFetch({
      [`GET ${BASE}/${page}/${networkHash}`]: () => {
        throw new TypeError("Failed to fetch");
      },
      [`GET ${BASE}/${page}/${emptyHash}`]: () => new Response(new Uint8Array(0)),
      [`PUT ${BASE}/${page}/${networkHash}`]: () => new Response(null, { status: 204 }),
      [`PUT ${BASE}/${page}/${emptyHash}`]: () => new Response(null, { status: 204 }),
    });

    await expect(pageAudio(DOC, network, {})).resolves.toBeInstanceOf(ArrayBuffer);
    await expect(pageAudio(DOC, empty, {})).resolves.toBeInstanceOf(ArrayBuffer);

    expect(synth.synthesizeSpeech).toHaveBeenCalledTimes(2);
  });

  it("a failed upload does not reject", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = unit("First.");
    const b = unit("Second.");
    const c = unit("Third.");
    const [ha, hb, hc] = await Promise.all([a, b, c].map((u) => sha256(u.text)));
    stubFetch({
      [`PUT ${BASE}/${page}/${ha}`]: () => new Response(null, { status: 503 }),
      [`PUT ${BASE}/${page}/${hb}`]: () => new Response(null, { status: 503 }),
      [`PUT ${BASE}/${page}/${hc}`]: () => {
        throw new TypeError("Failed to fetch");
      },
    });

    await expect(pageAudio(DOC, a, {})).resolves.toBeInstanceOf(ArrayBuffer);
    await expect(pageAudio(DOC, b, {})).resolves.toBeInstanceOf(ArrayBuffer);
    await expect(pageAudio(DOC, c, {})).resolves.toBeInstanceOf(ArrayBuffer);
    await settle();

    // Two kinds — an HTTP 503 (twice) and a network error — two warnings.
    expect(warn).toHaveBeenCalledTimes(2);
    expect(pageCachedShare(DOC, [a, b, c]).cached).toBe(0);
  });

  it("a synthesis landing after clearPage is not uploaded", async () => {
    const u = unit("Slow synthesis.");
    const hash = await sha256(u.text);
    let finish: (bytes: ArrayBuffer) => void = () => {};
    synth.synthesizeSpeech.mockImplementationOnce(
      () => new Promise<ArrayBuffer>((resolve) => (finish = resolve)),
    );
    const fetchMock = stubFetch({
      [`DELETE ${BASE}/${page}`]: () => new Response(null, { status: 204 }),
      [`PUT ${BASE}/${page}/${hash}`]: () => new Response(null, { status: 204 }),
    });

    const audio = pageAudio(DOC, u, {});
    await settle();
    await clearPage(DOC);
    finish(new Uint8Array([4]).buffer);
    await audio;
    await settle();

    expect(calls(fetchMock, "PUT")).toEqual([]);
    expect(pageUnitState(DOC, u)).toBeUndefined();
  });

  it("concurrent calls for one unit share its fetch and its upload", async () => {
    const u = unit("Asked twice.");
    const hash = await sha256(u.text);
    const misses: Array<() => void> = [];
    const fetchMock = stubFetch({
      // Held open, so the second call is asked for while the first is still out.
      [`GET ${BASE}/${page}/${hash}`]: () =>
        new Promise<Response>((resolve) => misses.push(() => resolve(new Response(null, { status: 404 })))),
      [`PUT ${BASE}/${page}/${hash}`]: () => new Response(null, { status: 204 }),
    });

    // The lookahead warm and the ladder ask for the same unit at once.
    const first = pageAudio(DOC, u, {});
    const second = pageAudio(DOC, u, {});
    await settle();
    for (const miss of misses) miss();
    const [a, b] = await Promise.all([first, second]);
    await settle();

    expect(a).toBeInstanceOf(ArrayBuffer);
    expect(b).toBeInstanceOf(ArrayBuffer);
    expect(calls(fetchMock, "GET")).toEqual([`${BASE}/${page}/${hash}`]);
    expect(calls(fetchMock, "PUT")).toEqual([`${BASE}/${page}/${hash}`]);
  });

  it("a fetch in flight is not shared across a clear", async () => {
    const u = unit("Cleared mid-fetch.");
    const hash = await sha256(u.text);
    const answers: Array<(res: Response) => void> = [];
    const fetchMock = stubFetch({
      [`GET ${BASE}/${page}/${hash}`]: () => new Promise<Response>((resolve) => answers.push(resolve)),
      [`DELETE ${BASE}/${page}`]: () => new Response(null, { status: 204 }),
    });

    const before = pageAudio(DOC, u, {});
    await settle();
    await clearPage(DOC);
    const after = pageAudio(DOC, u, {});
    await settle();

    expect(calls(fetchMock, "GET")).toEqual([`${BASE}/${page}/${hash}`, `${BASE}/${page}/${hash}`]);
    for (const answer of answers) answer(new Response(new Uint8Array([1])));
    await Promise.all([before, after]);
  });

  it("a miss landing after clearPage does not synthesize", async () => {
    const u = unit("Missed after clear.");
    const hash = await sha256(u.text);
    let answer: (res: Response) => void = () => {};
    stubFetch({
      [`GET ${BASE}/${page}/${hash}`]: () => new Promise<Response>((resolve) => (answer = resolve)),
      [`DELETE ${BASE}/${page}`]: () => new Response(null, { status: 204 }),
    });

    const audio = pageAudio(DOC, u, {});
    await settle();
    await clearPage(DOC);
    answer(new Response(null, { status: 404 }));

    // The run that asked was stopped by the clear; synthesizing now would
    // refill the speech cache the clear just rebuilt.
    await expect(audio).rejects.toMatchObject({ name: "AbortError" });
    expect(synth.synthesizeSpeech).not.toHaveBeenCalled();
  });

  it("a miss landing after wipeCache does not synthesize", async () => {
    const u = unit("Missed after wipe.");
    const hash = await sha256(u.text);
    let answer: (res: Response) => void = () => {};
    stubFetch({
      [`GET ${BASE}/${page}/${hash}`]: () => new Promise<Response>((resolve) => (answer = resolve)),
      [`DELETE ${BASE}`]: () => Response.json({ pages: 0, units: 0, bytes: 0 }),
    });

    const audio = pageAudio(DOC, u, {});
    await settle();
    await wipeCache();
    answer(new Response(null, { status: 404 }));

    await expect(audio).rejects.toMatchObject({ name: "AbortError" });
    expect(synth.synthesizeSpeech).not.toHaveBeenCalled();
  });

  it("a stalled disk fetch times out into a synthesis", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const u = unit("Stalled server.");
      const hash = await sha256(u.text);
      const fetchMock = stubFetch({
        // Never answers, and ignores any signal: only a deadline gets past it.
        [`GET ${BASE}/${page}/${hash}`]: () => new Promise<Response>(() => {}),
        [`PUT ${BASE}/${page}/${hash}`]: () => new Response(null, { status: 503 }),
      });

      let done = false;
      const audio = pageAudio(DOC, u, {}).finally(() => (done = true));
      // Hashing resolves on a real task, so wait for the GET before the clock moves.
      await vi.waitFor(() => expect(calls(fetchMock, "GET")).toHaveLength(1));
      await vi.advanceTimersByTimeAsync(3_000);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(audio).resolves.toBeInstanceOf(ArrayBuffer);
      expect(synth.synthesizeSpeech).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(0);

      // The timed-out flight is gone: a later ask starts its own GET rather
      // than joining the stalled one forever. (The upload failed, so the unit
      // is not in hand.)
      const again = pageAudio(DOC, u, {});
      await vi.waitFor(() => expect(calls(fetchMock, "GET")).toHaveLength(2));
      await vi.advanceTimersByTimeAsync(4_000);
      await expect(again).resolves.toBeInstanceOf(ArrayBuffer);
      expect(calls(fetchMock, "GET")).toEqual([`${BASE}/${page}/${hash}`, `${BASE}/${page}/${hash}`]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a body that stalls after the headers times out too", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const u = unit("Stalled body.");
      const hash = await sha256(u.text);
      const fetchMock = stubFetch({
        // Headers arrive, the body never does.
        [`GET ${BASE}/${page}/${hash}`]: () => new Response(new ReadableStream({ start() {} })),
        [`PUT ${BASE}/${page}/${hash}`]: () => new Response(null, { status: 204 }),
      });

      const audio = pageAudio(DOC, u, {});
      await vi.waitFor(() => expect(calls(fetchMock, "GET")).toHaveLength(1));
      await vi.advanceTimersByTimeAsync(4_000);

      await expect(audio).resolves.toBeInstanceOf(ArrayBuffer);
      expect(synth.synthesizeSpeech).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an aborted caller stops waiting on a shared fetch", async () => {
    const u = unit("Called off.");
    const hash = await sha256(u.text);
    stubFetch({
      [`GET ${BASE}/${page}/${hash}`]: () => new Promise<Response>(() => {}),
    });
    const controller = new AbortController();

    const audio = pageAudio(DOC, u, { signal: controller.signal });
    await settle();
    controller.abort();

    await expect(audio).rejects.toMatchObject({ name: "AbortError" });
    expect(synth.synthesizeSpeech).not.toHaveBeenCalled();
  });

  it("a fetch landing after wipeCache does not mark the unit ready", async () => {
    const u = unit("Slow fetch.");
    const hash = await sha256(u.text);
    let answer: (res: Response) => void = () => {};
    stubFetch({
      [`GET ${BASE}/${page}/${hash}`]: () => new Promise<Response>((resolve) => (answer = resolve)),
      [`DELETE ${BASE}`]: () => Response.json({ pages: 0, units: 0, bytes: 0 }),
    });

    const audio = pageAudio(DOC, u, {});
    await settle();
    await wipeCache();
    answer(new Response(new Uint8Array([1])));
    await audio;

    expect(pageUnitState(DOC, u)).toBeUndefined();
    expect(pageCachedShare(DOC, [u]).cached).toBe(0);
  });
});

describe("unit state and share", () => {
  it("a listed unit is warming until fetched, then ready", async () => {
    const u = unit("Listed unit.");
    const hash = await sha256(u.text);
    stubFetch({
      [`GET ${BASE}/${page}`]: () => Response.json({ units: [{ hash, bytes: 3 }] }),
      [`POST ${BASE}/${page}/prune`]: () => Response.json({ removed: 0 }),
      [`GET ${BASE}/${page}/${hash}`]: () => new Response(new Uint8Array([1, 2, 3])),
    });

    await loadPageList(DOC);
    await prunePage(DOC, [u]);
    expect(pageUnitState(DOC, u)).toBe("warming");

    await pageAudio(DOC, u, {});
    expect(pageUnitState(DOC, u)).toBe("ready");
  });

  it("the cached share counts current units only", async () => {
    const kept = unit("Still on the page.");
    const fresh = unit("New paragraph.");
    const [hk, hg] = await Promise.all([sha256(kept.text), sha256("Edited away.")]);
    stubFetch({
      [`GET ${BASE}/${page}`]: () =>
        Response.json({ units: [{ hash: hk, bytes: 100 }, { hash: hg, bytes: 50 }] }),
      [`POST ${BASE}/${page}/prune`]: () => Response.json({ removed: 1 }),
    });

    await loadPageList(DOC);
    await prunePage(DOC, [kept, fresh]);

    expect(pageCachedShare(DOC, [kept, fresh])).toEqual({ cached: 1, bytes: 100 });
  });

  it("a unit recorded while the list is out survives the list landing", async () => {
    const uploaded = unit("Uploaded meanwhile.");
    const fetched = unit("Fetched meanwhile.");
    const [hu, hf] = await Promise.all([sha256(uploaded.text), sha256(fetched.text)]);
    let answerList: (res: Response) => void = () => {};
    stubFetch({
      [`GET ${BASE}/${page}`]: () => new Promise<Response>((resolve) => (answerList = resolve)),
      [`PUT ${BASE}/${page}/${hu}`]: () => new Response(null, { status: 204 }),
      [`GET ${BASE}/${page}/${hf}`]: () => new Response(new Uint8Array([7, 7, 7])),
    });

    const listing = loadPageList(DOC);
    await settle();
    await pageAudio(DOC, uploaded, {});
    await pageAudio(DOC, fetched, {});
    await settle();
    expect(pageUnitState(DOC, uploaded)).toBe("ready");
    // The snapshot was taken before either landed, so it names neither.
    answerList(Response.json({ units: [] }));
    await listing;

    expect(pageUnitState(DOC, uploaded)).toBe("ready");
    expect(pageUnitState(DOC, fetched)).toBe("ready");
    expect(pageCachedShare(DOC, [uploaded, fetched])).toEqual({ cached: 2, bytes: 5 });
  });

  it("a prune no longer current once hashed sends no POST", async () => {
    const u = unit("Older revision unit.");
    const fetchMock = stubFetch({
      [`POST ${BASE}/${page}/prune`]: () => Response.json({ removed: 0 }),
    });

    let current = true;
    const pruning = prunePage(DOC, [u], { isCurrent: () => current });
    // Superseded while it hashes.
    current = false;
    await pruning;

    expect(calls(fetchMock, "POST")).toEqual([]);
  });

  it("a prune superseded while its POST is out deletes nothing locally", async () => {
    const older = unit("Older revision unit.");
    const newer = unit("Newer revision unit.");
    const hn = await sha256(newer.text);
    let answerPrune: (res: Response) => void = () => {};
    let prunes = 0;
    stubFetch({
      [`GET ${BASE}/${page}`]: () => Response.json({ units: [{ hash: hn, bytes: 4 }] }),
      // The newer revision's prune answers at once; the older one's hangs.
      [`POST ${BASE}/${page}/prune`]: () =>
        (prunes += 1) === 1
          ? Response.json({ removed: 0 })
          : new Promise<Response>((resolve) => (answerPrune = resolve)),
    });
    await loadPageList(DOC);
    await prunePage(DOC, [newer]);
    expect(pageCachedShare(DOC, [newer])).toEqual({ cached: 1, bytes: 4 });

    let current = true;
    const pruning = prunePage(DOC, [older], { isCurrent: () => current });
    await settle();
    current = false;
    answerPrune(Response.json({ removed: 0 }));
    await pruning;

    expect(pageCachedShare(DOC, [newer])).toEqual({ cached: 1, bytes: 4 });
  });

  it("a failed list leaves the page with nothing cached", async () => {
    const u = unit("Anything.");
    stubFetch({
      [`GET ${BASE}/${page}`]: () => new Response(null, { status: 503 }),
      [`POST ${BASE}/${page}/prune`]: () => new Response(null, { status: 503 }),
    });

    await expect(loadPageList(DOC)).resolves.toBeUndefined();
    await expect(prunePage(DOC, [u])).resolves.toBeUndefined();

    expect(pageUnitState(DOC, u)).toBeUndefined();
    expect(pageCachedShare(DOC, [u])).toEqual({ cached: 0, bytes: 0 });
  });
});

describe("without crypto.subtle (plain-http origin)", () => {
  /** An insecure context: `crypto` exists, `crypto.subtle` does not. */
  function stubInsecureContext(): void {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  }

  it("a page unit still plays via synthesis", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = stubFetch({});
    stubInsecureContext();
    const a = unit("First.");
    const b = unit("Second.");

    await expect(loadPageList(DOC)).resolves.toBeUndefined();
    await expect(prunePage(DOC, [a, b])).resolves.toBeUndefined();
    const bytes = await pageAudio(DOC, a, { voice: "v" });
    await expect(pageAudio(DOC, b, { voice: "v" })).resolves.toBeInstanceOf(ArrayBuffer);
    await settle();

    expect(Array.from(new Uint8Array(bytes))).toEqual([9, 9]);
    expect(synth.synthesizeSpeech).toHaveBeenCalledTimes(2);
    expect(synth.synthesizeSpeech).toHaveBeenCalledWith(a.text, { voice: "v" });
    // The cache steps aside entirely: no list, no prune, no fetch, no upload.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(pageUnitState(DOC, a)).toBeUndefined();
    expect(pageCachedShare(DOC, [a, b])).toEqual({ cached: 0, bytes: 0 });
  });

  it("clearPage resets the speech cache and rejects with the reason", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = stubFetch({});
    stubInsecureContext();

    await expect(clearPage(DOC)).rejects.toThrow(/secure context/);

    expect(synth.resetSpeechCache).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("wipeCache still works", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = stubFetch({
      [`DELETE ${BASE}`]: () => Response.json({ pages: 1, units: 2, bytes: 6 }),
    });
    stubInsecureContext();

    await expect(wipeCache()).resolves.toEqual({ pages: 1, units: 2, bytes: 6 });

    expect(calls(fetchMock, "DELETE")).toEqual([BASE]);
    expect(synth.resetSpeechCache).toHaveBeenCalledTimes(1);
  });
});

describe("clear and wipe", () => {
  it("clearPage resets the speech cache even when the delete fails", async () => {
    const u = unit("Cached.");
    const hash = await sha256(u.text);
    stubFetch({
      [`GET ${BASE}/${page}`]: () => Response.json({ units: [{ hash, bytes: 3 }] }),
      [`POST ${BASE}/${page}/prune`]: () => Response.json({ removed: 0 }),
      [`DELETE ${BASE}/${page}`]: () => new Response(null, { status: 503 }),
    });
    await loadPageList(DOC);
    await prunePage(DOC, [u]);
    const listener = vi.fn();
    subscribePageCache(listener);

    await expect(clearPage(DOC)).rejects.toThrow(/503/);

    expect(synth.resetSpeechCache).toHaveBeenCalledTimes(1);
    expect(pageUnitState(DOC, u)).toBeUndefined();
    expect(listener).toHaveBeenCalled();
  });

  it("clearPage waits for an upload in flight before sending the delete", async () => {
    const u = unit("Uploading while cleared.");
    const hash = await sha256(u.text);
    const order: string[] = [];
    let landPut: () => void = () => {};
    stubFetch({
      [`PUT ${BASE}/${page}/${hash}`]: () =>
        new Promise<Response>((resolve) => {
          order.push("put sent");
          landPut = () => {
            order.push("put landed");
            resolve(new Response(null, { status: 204 }));
          };
        }),
      [`DELETE ${BASE}/${page}`]: () => {
        order.push("delete sent");
        return new Response(null, { status: 204 });
      },
    });

    await pageAudio(DOC, u, {});
    await settle();
    const cleared = clearPage(DOC);
    await settle();
    // The delete must not overtake the PUT, or the PUT recreates the page on disk.
    expect(order).toEqual(["put sent"]);
    landPut();
    await cleared;

    expect(order).toEqual(["put sent", "put landed", "delete sent"]);
    expect(pageUnitState(DOC, u)).toBeUndefined();
  });

  it("wipeCache waits for every upload in flight before sending the delete", async () => {
    const u = unit("Uploading while wiped.");
    const hash = await sha256(u.text);
    const order: string[] = [];
    let landPut: () => void = () => {};
    stubFetch({
      [`PUT ${BASE}/${page}/${hash}`]: () =>
        new Promise<Response>((resolve) => {
          landPut = () => {
            order.push("put landed");
            resolve(new Response(null, { status: 204 }));
          };
        }),
      [`DELETE ${BASE}`]: () => {
        order.push("delete sent");
        return Response.json({ pages: 1, units: 1, bytes: 2 });
      },
    });

    await pageAudio(DOC, u, {});
    await settle();
    const wiped = wipeCache();
    await settle();
    expect(order).toEqual([]);
    landPut();
    await wiped;

    expect(order).toEqual(["put landed", "delete sent"]);
  });

  it("clearPage aborts a stuck upload after its cap, before sending the delete", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const u = unit("Stuck upload.");
      const hash = await sha256(u.text);
      const order: string[] = [];
      const fetchMock = stubFetch({
        // Never answers on its own; only its signal ends it, as a real fetch would.
        [`PUT ${BASE}/${page}/${hash}`]: (init) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () => {
              order.push("put aborted");
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
        [`DELETE ${BASE}/${page}`]: () => {
          order.push("delete sent");
          return new Response(null, { status: 204 });
        },
      });

      await pageAudio(DOC, u, {});
      await vi.advanceTimersByTimeAsync(0);
      const cleared = clearPage(DOC);
      await vi.advanceTimersByTimeAsync(0);
      expect(calls(fetchMock, "DELETE")).toEqual([]);
      await vi.advanceTimersByTimeAsync(5_000);
      await cleared;

      expect(order).toEqual(["put aborted", "delete sent"]);
      expect(calls(fetchMock, "DELETE")).toEqual([`${BASE}/${page}`]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("wipeCache aborts a stuck upload after its cap, even one whose fetch ignores the signal", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const u = unit("Stuck while wiped.");
      const hash = await sha256(u.text);
      let putSignal: AbortSignal | undefined;
      const fetchMock = stubFetch({
        [`PUT ${BASE}/${page}/${hash}`]: (init) => {
          putSignal = init?.signal ?? undefined;
          return new Promise<Response>(() => {});
        },
        [`DELETE ${BASE}`]: () => Response.json({ pages: 0, units: 0, bytes: 0 }),
      });

      await pageAudio(DOC, u, {});
      await vi.advanceTimersByTimeAsync(0);
      const wiped = wipeCache();
      await vi.advanceTimersByTimeAsync(5_000);
      await wiped;

      expect(putSignal?.aborted).toBe(true);
      expect(calls(fetchMock, "DELETE")).toEqual([BASE]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("wipeCache empties every page and resets the speech cache", async () => {
    const other = "doc:pavilio/other.md";
    const otherPage = await sha256(other);
    const u = unit("Shared text.");
    const hash = await sha256(u.text);
    const fetchMock = stubFetch({
      [`GET ${BASE}/${page}`]: () => Response.json({ units: [{ hash, bytes: 3 }] }),
      [`GET ${BASE}/${otherPage}`]: () => Response.json({ units: [{ hash, bytes: 3 }] }),
      [`POST ${BASE}/${page}/prune`]: () => Response.json({ removed: 0 }),
      [`DELETE ${BASE}`]: () => Response.json({ pages: 2, units: 2, bytes: 6 }),
    });
    await loadPageList(DOC);
    await loadPageList(other);
    await prunePage(DOC, [u]);
    expect(pageUnitState(other, u)).toBe("warming");

    await expect(wipeCache()).resolves.toEqual({ pages: 2, units: 2, bytes: 6 });

    expect(calls(fetchMock, "DELETE")).toEqual([BASE]);
    expect(synth.resetSpeechCache).toHaveBeenCalledTimes(1);
    expect(pageUnitState(DOC, u)).toBeUndefined();
    expect(pageUnitState(other, u)).toBeUndefined();
  });
});
