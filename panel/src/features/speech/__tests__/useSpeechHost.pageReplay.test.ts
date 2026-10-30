/**
 * The page audio cache end to end: the real `pageCache` (hashing, list,
 * prune, fetch, upload) between the host and the fake synthesizer, with a
 * `fetch` stub standing in for the panel server's page-cache routes — PUT
 * stores the body, GET serves it back, the list reports what was stored. A
 * reload is simulated by dropping every in-memory cache (the page cache's and
 * the synthesizer's) and mounting a fresh host.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  drain,
  elements,
  played,
  requestedTexts,
  resetSpeechHarness,
  response,
  synth,
  synthMock,
  unitsOf,
  useWebSocketMock,
} from "./speech.harness";

vi.mock("../synth", () => synthMock());
vi.mock("../../realtime/useWebSocket", () => useWebSocketMock());

import { voiceForSession } from "../../terminal/sessionVoice";
import { docSpeechKey } from "../docKey";
import { __resetPageCacheForTests } from "../pageCache";
import { useSpeechHost, type SpeechHost } from "../useSpeechHost";
import { storeAnswerWaiting } from "./answerWaitingPort";

const PAGE = docSpeechKey("p/wiki/page.md");
const BASE = "/api/speech/page-cache";

/**
 * A minimal response whose body readers resolve on microtasks — the host
 * suites settle on the microtask ladder, and a real `Response` body read can
 * take a task.
 */
function reply(status: number, body?: ArrayBuffer | unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    // Every page-cache answer names the page's epoch, as the server's GETs do.
    headers: new Headers({ "x-cache-epoch": "boot.0.0" }),
    json: async () => body,
    arrayBuffer: async () => (body instanceof ArrayBuffer ? body : new ArrayBuffer(0)),
  } as Response;
}

/** The panel server's page-cache routes over an in-memory disk: page hash → unit hash → bytes. */
function stubServer() {
  const disk = new Map<string, Map<string, ArrayBuffer>>();
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    if (!url.startsWith(BASE)) return reply(200, { utterances: [] });
    const [page, unit] = url.slice(BASE.length + 1).split("/");
    const units = disk.get(page);
    if (method === "PUT") {
      const stored = disk.get(page) ?? new Map<string, ArrayBuffer>();
      stored.set(unit, (init?.body as ArrayBuffer).slice(0));
      disk.set(page, stored);
      return reply(204);
    }
    if (method === "POST" && unit === "prune") return reply(200, { removed: 0 });
    if (method === "GET" && unit === undefined) {
      return reply(200, {
        units: [...(units ?? new Map()).entries()].map(([hash, bytes]) => ({ hash, bytes: bytes.byteLength })),
        seq: units?.size ?? 0,
      });
    }
    if (method === "GET") {
      const bytes = units?.get(unit);
      return bytes ? reply(200, bytes.slice(0)) : reply(404);
    }
    return reply(404);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return { disk, fetchMock };
}

/**
 * Lets the work settle, real tasks included: `crypto.subtle.digest` resolves
 * on a task, not a microtask, so the microtask ladder alone never sees a hash.
 */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await drain();
    }
  });
}

/** Plays the page from its first unit to its end, as the browser's `ended` would. */
async function playThrough(host: () => SpeechHost, text: string): Promise<void> {
  const count = unitsOf(text).length;
  const start = played.length;
  await act(async () => host().speakDocument({ key: PAGE, text }));
  await flush();
  while (played.length - start < count) {
    const before = played.length;
    await act(async () => {
      elements[elements.length - 1]?.dispatchEvent(new Event("ended"));
    });
    await flush();
    if (played.length === before) break;
  }
  expect(played.length - start).toBe(count);
}

function renderHost() {
  return renderHook(() =>
    useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting, onAnswer: vi.fn() }),
  );
}

beforeEach(() => {
  resetSpeechHarness();
  __resetPageCacheForTests();
});

describe("useSpeechHost — page audio cache end to end", () => {
  it("a page replayed after a reload never synthesizes", async () => {
    const { disk } = stubServer();
    const text = response(3, "Page");
    const units = unitsOf(text);

    const first = renderHost();
    await playThrough(() => first.result.current, text);
    await flush();
    // The first play synthesized every unit once and uploaded each of them.
    expect([...new Set(requestedTexts())].sort()).toEqual([...units].sort());
    expect([...disk.values()].reduce((sum, page) => sum + page.size, 0)).toBe(units.length);
    first.unmount();

    // The reload: nothing in memory survives, only the server's disk.
    __resetPageCacheForTests();
    synth.reset();
    const second = renderHost();
    await playThrough(() => second.result.current, text);

    expect(requestedTexts()).toEqual([]);
  });
});
