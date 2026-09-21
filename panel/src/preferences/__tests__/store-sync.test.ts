import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bool, num } from "../codecs";
import { definePreference } from "../types";
import {
  PREFERENCE_PATCH_DEBOUNCE_MS,
  __resetPreferenceStoreForTests,
  readPreference,
  subscribePreference,
  writePreference,
} from "../store";

/**
 * Where a write and a refetch meet.
 *
 * `store.test.ts` covers a write on its own and `usePreference.test.tsx` the
 * rendering; neither drives a `preferences-change` frame *while* a PATCH is
 * outstanding, which is where the document and the session can diverge. The
 * realtime channel is mocked — jsdom has no WebSocket, and the store only cares
 * that frames arrive.
 */
const { frameListeners } = vi.hoisted(() => ({
  frameListeners: new Set<(frame: { type: string; [key: string]: unknown }) => void>(),
}));

vi.mock("../../features/realtime/channel", () => ({
  subscribeRealtime: (listener: (frame: { type: string; [key: string]: unknown }) => void) => {
    frameListeners.add(listener);
    return () => frameListeners.delete(listener);
  },
}));

type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

const portableWidth = definePreference({
  key: "test.width",
  scope: "global",
  default: 240,
  codec: num,
  portable: true,
});

const portableFlag = definePreference({
  key: "test.flag",
  scope: "global",
  default: true,
  codec: bool,
  portable: true,
});

/** The body `GET /api/preferences.js` serves for `doc`. */
function scriptBody(doc: Record<string, unknown>): string {
  return `window.__PAVILIO_PREFS__ = ${JSON.stringify(doc)};\nwindow.__PAVILIO_HOME__ = "/root";\n`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One debounce window plus slack — long enough for the PATCH to have left. */
function afterDebounce(): Promise<void> {
  return sleep(PREFERENCE_PATCH_DEBOUNCE_MS + 60);
}

/** Wake the store with a `preferences-change` frame and let the refetch land. */
async function deliverFrame(keys: string[]): Promise<void> {
  for (const listener of [...frameListeners]) listener({ type: "preferences-change", keys });
  await sleep(0);
}

/** Keeps the store attached to the mocked channel for the length of a test. */
function attach(): () => void {
  return subscribePreference(portableFlag, undefined, () => {});
}

beforeEach(() => {
  globals.__PAVILIO_PREFS__ = { version: 1 };
});

afterEach(() => {
  delete globals.__PAVILIO_PREFS__;
  __resetPreferenceStoreForTests();
  frameListeners.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a refetch racing a write", () => {
  it("does not clobber a write whose PATCH is still in flight", async () => {
    // The server has not applied the PATCH yet — it is still holding it — so
    // the document it serves is the pre-PATCH one. Nothing but the store's own
    // memory knows about the new width.
    let releasePatch!: () => void;
    const held = new Promise<void>((resolve) => {
      releasePatch = resolve;
    });
    const serverDoc: Record<string, unknown> = { version: 1 };
    const patched: Array<Record<string, unknown>> = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/preferences.js") {
          return new Response(scriptBody(serverDoc), { status: 200 });
        }
        patched.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        await held;
        Object.assign(serverDoc, patched.at(-1));
        return new Response('{"ok":true}', { status: 200 });
      }),
    );
    const unsubscribe = attach();

    writePreference(portableWidth, 512);
    await afterDebounce();
    // Flushed: `pending` is empty, the PATCH is in flight and unacked.
    expect(patched).toEqual([{ "test.width": 512 }]);

    // A frame for an UNRELATED key — so nothing re-renders to expose the loss.
    await deliverFrame(["something.else"]);

    expect(readPreference(portableWidth)).toBe(512);
    expect(globals.__PAVILIO_PREFS__?.["test.width"]).toBe(512);

    releasePatch();
    await sleep(0);
    unsubscribe();
  });

  it("the newest refetch wins, however slowly the older one answers", async () => {
    // Two frames, two unsequenced fetches. The first answers last and with the
    // older document; taking it would walk the store backwards.
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let call = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url !== "/api/preferences.js") return new Response('{"ok":true}', { status: 200 });
        call += 1;
        if (call === 1) {
          await first;
          return new Response(scriptBody({ version: 1, "test.flag": false }), { status: 200 });
        }
        return new Response(scriptBody({ version: 1, "test.flag": true }), { status: 200 });
      }),
    );
    const unsubscribe = attach();

    await deliverFrame(["test.flag"]);
    await deliverFrame(["test.flag"]);
    expect(call).toBe(2);

    releaseFirst();
    await sleep(10);

    expect(readPreference(portableFlag)).toBe(true);
    unsubscribe();
  });
});

describe("unsubscribing", () => {
  it("is idempotent — a second call cannot detach a later subscriber", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
    );
    const first = vi.fn();
    const second = vi.fn();

    const off = subscribePreference(portableFlag, undefined, first);
    off();
    // The set for this key was dropped when it emptied, so this subscriber gets
    // a brand-new one. A stale unsubscribe still holds the old set.
    subscribePreference(portableFlag, undefined, second);
    off();

    writePreference(portableFlag, false);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});

describe("a failed PATCH", () => {
  it("is re-sent by the next flush, alongside whatever else is pending", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const patched: Array<Record<string, unknown>> = [];
    let fail = true;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        patched.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        if (fail) throw new TypeError("Failed to fetch");
        return new Response('{"ok":true}', { status: 200 });
      }),
    );

    writePreference(portableWidth, 512);
    await afterDebounce();
    expect(patched).toEqual([{ "test.width": 512 }]);
    expect(warn).toHaveBeenCalled();

    fail = false;
    writePreference(portableFlag, false);
    await afterDebounce();

    // The lost key rides along: without this it stays divergent for the whole
    // session and silently reverts on the next reload.
    expect(patched.at(-1)).toEqual({ "test.width": 512, "test.flag": false });
  });

  it("is re-sent at its latest value, never the one that was superseded", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const patched: Array<Record<string, unknown>> = [];
    let fail = true;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        patched.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        if (fail) throw new TypeError("Failed to fetch");
        return new Response('{"ok":true}', { status: 200 });
      }),
    );

    writePreference(portableWidth, 512);
    await afterDebounce();
    expect(patched).toEqual([{ "test.width": 512 }]);

    fail = false;
    writePreference(portableWidth, 640);
    await afterDebounce();

    // A retry queue that replayed the old *body* would resurrect 512.
    expect(patched.at(-1)).toEqual({ "test.width": 640 });
    expect(readPreference(portableWidth)).toBe(640);
    expect(warn).toHaveBeenCalled();
  });
});
