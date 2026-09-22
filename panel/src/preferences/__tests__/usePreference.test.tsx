import { useEffect } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bool, num } from "../codecs";
import { definePreference } from "../types";
import { PREFERENCE_PATCH_DEBOUNCE_MS, __resetPreferenceStoreForTests } from "../store";
import { usePreference } from "../usePreference";

/**
 * The rendering half of the store: the first-render guarantee that makes the
 * blocking script worth having, and the realtime fan-out.
 *
 * The realtime channel is stubbed rather than driven through a WebSocket —
 * jsdom has none, and the store only cares that frames arrive.
 */
const { frameListeners, attachments } = vi.hoisted(() => ({
  frameListeners: new Set<(frame: { type: string; [key: string]: unknown }) => void>(),
  // Every `subscribeRealtime` call, not just the distinct listeners: the real
  // channel keeps a `Set` keyed by function identity, so a store that attached
  // once per subscriber would be invisible in `frameListeners.size` while
  // leaking an unsubscribe handle for every hook that ever mounted.
  attachments: { count: 0 },
}));

vi.mock("../../features/realtime/channel", () => ({
  subscribeRealtime: (listener: (frame: { type: string; [key: string]: unknown }) => void) => {
    attachments.count += 1;
    frameListeners.add(listener);
    return () => frameListeners.delete(listener);
  },
  __resetRealtimeChannelForTests: () => frameListeners.clear(),
}));

type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

const watched = definePreference({
  key: "test.watched",
  scope: "global",
  default: true,
  codec: bool,
  portable: true,
});

const other = definePreference({
  key: "test.other",
  scope: "global",
  default: true,
  codec: bool,
  portable: true,
});

const width = definePreference({
  key: "test.hookWidth",
  scope: "global",
  default: 240,
  codec: num,
  portable: true,
});

/** The body `GET /api/preferences.js` serves for `doc`. */
function scriptBody(doc: Record<string, unknown>): string {
  return (
    `window.__PAVILIO_PREFS__ = ${JSON.stringify(doc)};\n` +
    `window.__PAVILIO_HOME__ = "/root";\n`
  );
}

function serveDoc(doc: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(scriptBody(doc), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function deliverFrame(keys: string[]): Promise<void> {
  await act(async () => {
    for (const listener of [...frameListeners]) {
      listener({ type: "preferences-change", keys });
    }
    // Let the refetch and its listener notifications land.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  globals.__PAVILIO_PREFS__ = { version: 1 };
  attachments.count = 0;
});

afterEach(() => {
  delete globals.__PAVILIO_PREFS__;
  __resetPreferenceStoreForTests();
  frameListeners.clear();
  vi.unstubAllGlobals();
});

describe("usePreference", () => {
  it("the value is correct on first render with no effects run", () => {
    globals.__PAVILIO_PREFS__ = { version: 1, "test.watched": false };
    const renders: Array<{ value: boolean; effectsSoFar: number }> = [];
    let effects = 0;

    function Probe() {
      const [value] = usePreference(watched);
      renders.push({ value, effectsSoFar: effects });
      useEffect(() => {
        effects += 1;
      });
      return null;
    }

    render(<Probe />);

    // The first render already holds the stored value, and it got there
    // without an effect — the whole point of the blocking script.
    expect(renders[0]).toEqual({ value: false, effectsSoFar: 0 });
  });

  it("a change frame for a subscribed key re-renders the hook", async () => {
    globals.__PAVILIO_PREFS__ = { version: 1, "test.watched": true };
    serveDoc({ version: 1, "test.watched": false });
    const seen: boolean[] = [];

    function Probe() {
      const [value] = usePreference(watched);
      seen.push(value);
      return null;
    }

    render(<Probe />);
    expect(seen.at(-1)).toBe(true);

    await deliverFrame(["test.watched"]);

    await waitFor(() => expect(seen.at(-1)).toBe(false));
  });

  it("a change frame for an unsubscribed key does not re-render", async () => {
    globals.__PAVILIO_PREFS__ = { version: 1, "test.watched": true };
    // The refetched document moves BOTH keys, while the frame names only the
    // unsubscribed one. That is what makes this test discriminate: if the
    // watched key stayed put in the served document, React's `Object.is`
    // bail-out would suppress the re-render whether or not the store filters
    // its notifications by key, and a store that woke every subscriber on
    // every frame would pass. Here it cannot — waking the watched hook makes
    // it re-read the merged document and render `false`.
    serveDoc({ version: 1, "test.watched": false, [other.key]: false });
    const seen: boolean[] = [];

    function Probe() {
      const [value] = usePreference(watched);
      seen.push(value);
      return null;
    }

    render(<Probe />);
    const rendersBefore = seen.length;

    await deliverFrame([other.key]);

    expect(seen.length).toBe(rendersBefore);
    // ...and the hook still shows what it was last told, not the new document.
    expect(seen.at(-1)).toBe(true);
    // The frame did land — the store's copy of both keys moved.
    expect(globals.__PAVILIO_PREFS__?.[other.key]).toBe(false);
    expect(globals.__PAVILIO_PREFS__?.["test.watched"]).toBe(false);
  });

  it("the setter updates the value and the store together", async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    let set: ((value: boolean) => void) | null = null;
    const seen: boolean[] = [];

    function Probe() {
      const [value, setValue] = usePreference(watched);
      set = setValue;
      seen.push(value);
      return null;
    }

    render(<Probe />);
    expect(seen.at(-1)).toBe(true);

    act(() => set?.(false));

    expect(seen.at(-1)).toBe(false);
    expect(globals.__PAVILIO_PREFS__?.["test.watched"]).toBe(false);
  });

  it("two hooks on the same key stay in step", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
    );
    let set: ((value: boolean) => void) | null = null;
    const mirror: boolean[] = [];

    function Writer() {
      const [, setValue] = usePreference(watched);
      set = setValue;
      return null;
    }

    function Mirror() {
      const [value] = usePreference(watched);
      mirror.push(value);
      return null;
    }

    render(
      <>
        <Writer />
        <Mirror />
      </>,
    );
    expect(mirror.at(-1)).toBe(true);
    // Exactly one channel listener for the two hooks, from exactly one attach.
    // The store attaches to the realtime channel once and fans out internally.
    // Dropping the `if (!channelUnsubscribe)` guard leaves the listener count
    // at 1 — the channel's `Set` is keyed by function identity — while leaking
    // one unsubscribe handle per subscriber, so the count of attaches is the
    // assertion that actually bites.
    expect(frameListeners.size).toBe(1);
    expect(attachments.count).toBe(1);

    act(() => set?.(false));

    expect(mirror.at(-1)).toBe(false);
  });

  it("unmounting the last hook releases the realtime subscription", () => {
    function Probe() {
      usePreference(watched);
      return null;
    }

    const view = render(<Probe />);
    expect(frameListeners.size).toBe(1);

    view.unmount();
    expect(frameListeners.size).toBe(0);
  });

  it("an unused preference never subscribes", () => {
    expect(frameListeners.size).toBe(0);
  });

  it("changing the scope argument re-reads under the new key", () => {
    const scoped = definePreference({
      key: "test.scoped",
      scope: "project",
      default: true,
      codec: bool,
      portable: true,
    });
    globals.__PAVILIO_PREFS__ = {
      version: 1,
      "test.scoped@alpha": false,
      "test.scoped@beta": true,
    };
    const seen: boolean[] = [];

    function Probe({ project }: { project: string }) {
      const [value] = usePreference(scoped, project);
      seen.push(value);
      return null;
    }

    const view = render(<Probe project="alpha" />);
    expect(seen.at(-1)).toBe(false);

    view.rerender(<Probe project="beta" />);
    expect(seen.at(-1)).toBe(true);
  });
});

describe("a refused non-finite write", () => {
  it("leaves the writing hook on the stored value, in step with its peers", () => {
    // `usePreference`'s setter adopts before it writes, so a refusal that
    // returned without notifying would leave the WRITER rendering NaN while
    // storage and every other hook on the key still held 320 — the one hook
    // that asked for the change being the only one that is wrong.
    globals.__PAVILIO_PREFS__ = { version: 1, "test.hookWidth": 320 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
    );
    let set: ((value: number) => void) | null = null;
    const writer: number[] = [];
    const mirror: number[] = [];

    function Writer() {
      const [value, setValue] = usePreference(width);
      set = setValue;
      writer.push(value);
      return null;
    }

    function Mirror() {
      const [value] = usePreference(width);
      mirror.push(value);
      return null;
    }

    render(
      <>
        <Writer />
        <Mirror />
      </>,
    );
    expect(writer.at(-1)).toBe(320);

    act(() => set?.(Number.NaN));

    expect(writer.at(-1)).toBe(320);
    expect(mirror.at(-1)).toBe(320);
    expect(globals.__PAVILIO_PREFS__?.["test.hookWidth"]).toBe(320);
  });
});

describe("a refetch answered before the PATCH it races was applied", () => {
  it("does not revert a just-acked write under a mounted hook", async () => {
    // The order that breaks the overlay: the GET is ANSWERED from the
    // pre-PATCH document, the PATCH then acks (emptying `inFlightKeys`), and
    // only afterwards does the stale GET resolve. At that point the key is in
    // neither pending nor in-flight, so an overlay that consults only those two
    // takes the server's older value — and the frame's notify makes the user
    // watch the change they just made revert.
    globals.__PAVILIO_PREFS__ = { version: 1, "test.hookWidth": 240 };
    let releaseGet!: () => void;
    const heldGet = new Promise<void>((resolve) => {
      releaseGet = resolve;
    });
    let releasePatch!: () => void;
    const heldPatch = new Promise<void>((resolve) => {
      releasePatch = resolve;
    });
    const serverDoc: Record<string, unknown> = { version: 1, "test.hookWidth": 240 };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/preferences.js") {
          // Read now — this is the server answering before it applies the
          // PATCH — and handed back late.
          const served = { ...serverDoc };
          await heldGet;
          return new Response(scriptBody(served), { status: 200 });
        }
        await heldPatch;
        Object.assign(serverDoc, JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response('{"ok":true}', { status: 200 });
      }),
    );

    let set: ((value: number) => void) | null = null;
    const seen: number[] = [];

    function Probe() {
      const [value, setValue] = usePreference(width);
      set = setValue;
      seen.push(value);
      return null;
    }

    render(<Probe />);
    act(() => set?.(512));
    expect(seen.at(-1)).toBe(512);

    // The debounce fires; the PATCH is out and unacked.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, PREFERENCE_PATCH_DEBOUNCE_MS + 60));
    });

    // A frame arrives and its GET is served from the pre-PATCH document.
    await act(async () => {
      for (const listener of [...frameListeners]) {
        listener({ type: "preferences-change", keys: ["test.hookWidth"] });
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // The PATCH acks — `inFlightKeys` no longer holds the key.
    await act(async () => {
      releasePatch();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Only now does the stale document land.
    await act(async () => {
      releaseGet();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(globals.__PAVILIO_PREFS__?.["test.hookWidth"]).toBe(512);
    expect(seen.at(-1)).toBe(512);
  });
});
