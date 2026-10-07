import { act, renderHook, waitFor } from "@testing-library/react";
import { useEffect, useReducer } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Utterance } from "../types";

/**
 * The channel's only live input is `useWebSocket`'s `lastMessage`, so frames are
 * fed from a module-level variable the tests reassign before a `rerender` — the
 * pattern `features/projects/__tests__/sectionTabsFileChange.test.ts` uses.
 */
let lastMessage: Record<string, unknown> | null = null;
vi.mock("../../realtime/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage }),
}));

/**
 * The neutral reconnect frame cannot arrive through `useWebSocket`: the channel
 * publishes it alongside the file-change one and React batches both into a
 * single render, so only whichever was published last is ever visible in
 * `lastMessage` — deliberately the file-change frame. The catch-up therefore
 * subscribes to the realtime channel directly, and this stands in for that
 * subscription, which would otherwise open a socket.
 */
const { realtimeListeners } = vi.hoisted(() => ({
  realtimeListeners: new Set<(frame: Record<string, unknown>) => void>(),
}));
vi.mock("../../realtime/channel", async () => {
  const actual =
    await vi.importActual<typeof import("../../realtime/channel")>("../../realtime/channel");
  return {
    ...actual,
    subscribeRealtime: (listener: (frame: Record<string, unknown>) => void) => {
      realtimeListeners.add(listener);
      return () => {
        realtimeListeners.delete(listener);
      };
    },
  };
});

/**
 * Playback lives in `useSpeechPlayer` and synthesis in the host's warming
 * effect, not here, so all four are *inputs*: whatever the caller says.
 * `useSpeechHost` passes the player's `speakingSessionId`, `pausedSessionId`
 * and `waitingForSynthesis` plus its own `preparingSessionIds`; these tests
 * pass these variables.
 */
let speaking: string | null = null;
let paused: string | null = null;
let waiting = false;
let preparing: ReadonlySet<string> = new Set<string>();

const { useUtteranceChannel } = await import("../useUtteranceChannel");
const { setStoredSpeechMode } = await import("../voices");
const { unplayedSinceLastPlayed } = await import("../unreadAnswers");
const { REALTIME_RECONNECT_FRAME } = await import("../../realtime/channel");
const { preferences } = await import("../../../preferences/declarations");
const { storageKey } = await import("../../../preferences/types");

/**
 * Speech modes are keyed by LIVE SESSION, so they are `portable: false` and
 * stay in `localStorage` — never in the workspace file, which is committed and
 * carried to a machine where that session does not exist.
 */
const MODES_KEY = storageKey(preferences.speechModes);

const utterance = (sessionId: string, id: string, at = 1_000): Utterance => ({
  id,
  sessionId,
  text: `response ${id}`,
  at,
});

/**
 * A response that is only code. It strips to nothing and prepares to zero
 * units, so it has nothing to say — and the Polish comment inside the fence is
 * still evidence of the session's language, which `voteLanguage` reads off the
 * raw text.
 */
const CODE_ONLY_PL = "```ts\n// zażółć gęślą jaźń\nconst x = 1;\n```\n";

const codeOnly = (sessionId: string, id: string, at = 1_000): Utterance => ({
  id,
  sessionId,
  text: CODE_ONLY_PL,
  at,
});

/** The WS broadcast shape: `speech-utterance` plus the utterance's own fields. */
const frame = (u: Utterance) => ({ type: "speech-utterance", ...u });

/** `GET /api/speech/latest` → `{ utterances: [...] }`, per the locked wire format. */
function serveLatest(utterances: Utterance[]) {
  const fetchMock = vi.fn(
    async () => ({ ok: true, json: async () => ({ utterances }) }) as Response,
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

/**
 * The host's `recordAutoplayed`: an input like the four above, because
 * `autoplayedRef` lives in `useSpeechHost` and the channel imports nothing from
 * it. A catch-up calls it so an armed cell does not speak what it recovered.
 */
let recordAutoplayed = vi.fn();

/** The host's answer listener: live frames and recoveries, told apart. */
let onAnswer = vi.fn();

/** The playback/synthesis inputs, as of whatever the variables now say. */
const options = () => ({
  speakingSessionId: speaking,
  pausedSessionId: paused,
  waitingForSynthesis: waiting,
  preparingSessionIds: preparing,
  recordAutoplayed,
  onAnswer,
});

/** Renders the hook and lets the mount fetch settle, so no assertion races hydration. */
async function renderChannel() {
  const rendered = renderHook(() => useUtteranceChannel(options()));
  await act(async () => {
    await Promise.resolve();
  });
  return rendered;
}

/** What a panel server that is simply down throws, and how a rejection names it. */
const UNREACHABLE = "panel server unreachable";
const reasonOf = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason);

/** What the channel sees when the socket comes back: the neutral frame, nothing else. */
async function reconnected() {
  await act(async () => {
    for (const listener of [...realtimeListeners]) listener({ ...REALTIME_RECONNECT_FRAME });
  });
  // A macrotask, so the re-fetch and its `json()` have both settled.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * React's "am I inside a test?" flag. Switched off for the one test that has to
 * observe the browser's own scheduling: inside `act` an update made from an
 * effect is flushed synchronously, which closes the very window that test pins.
 *
 * Returns what it displaced, so the `finally` that puts it back restores the
 * value that was actually there rather than a literal `true` — the flag is set
 * by the test setup, not by this file, and writing a guess back into a global
 * is how one test's cleanup starts deciding for the next.
 */
function actEnvironment(enabled: boolean | undefined): boolean | undefined {
  const flags = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = flags.IS_REACT_ACT_ENVIRONMENT;
  flags.IS_REACT_ACT_ENVIRONMENT = enabled;
  return previous;
}

/**
 * `waitFor` for the one test that runs OUTSIDE `act`. RTL polls from inside its
 * own `asyncWrapper`, which is `act` — precisely what that test switches off —
 * so the wait is written out here: one macrotask per pass, the same drain as
 * before, but bounded by a CONDITION instead of by a guessed number of passes.
 * A scheduler that needs one more pass under load is then waited out rather
 * than failing, and a real stall still fails, with a message that says what it
 * was waiting for.
 */
async function drainUntil(
  settled: () => boolean,
  description: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (settled()) return;
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms of macrotasks waiting for ${description}`);
    }
  }
}

beforeEach(() => {
  lastMessage = null;
  speaking = null;
  paused = null;
  waiting = false;
  preparing = new Set<string>();
  recordAutoplayed = vi.fn();
  onAnswer = vi.fn();
  realtimeListeners.clear();
  serveLatest([]);
});

describe("useUtteranceChannel", () => {
  it("hydrates from /api/speech/latest on mount", async () => {
    const fetchMock = serveLatest([utterance("cell-a", "a1"), utterance("cell-b", "b1")]);

    const { result } = await renderChannel();

    expect(fetchMock).toHaveBeenCalledWith("/api/speech/latest");
    // A tab that mounts after the broadcast has not heard the utterance, and
    // the server keeps only the latest — so a seeded cell is ready, not heard.
    await waitFor(() => expect(result.current.stateFor("cell-a")).toBe("ready"));
    expect(result.current.stateFor("cell-b")).toBe("ready");
    expect(result.current.utteranceFor("cell-b")).toEqual(utterance("cell-b", "b1"));
  });

  it("marks a session ready when a frame arrives", async () => {
    const { result, rerender } = await renderChannel();

    // Nothing has ever told the hook this session exists — the frame itself
    // registers it, because an utterance can be the first news of a terminal.
    expect(result.current.stateFor("cell-x")).toBe("empty");

    lastMessage = frame(utterance("cell-x", "x1"));
    await act(async () => {
      rerender();
    });

    expect(result.current.stateFor("cell-x")).toBe("ready");
    expect(result.current.utteranceFor("cell-x")).toEqual(utterance("cell-x", "x1"));
  });

  it("keeps the utterance retrievable after it is heard", async () => {
    const { result, rerender } = await renderChannel();

    const spoken = utterance("cell-a", "a1");
    lastMessage = frame(spoken);
    await act(async () => {
      rerender();
    });
    await act(async () => {
      result.current.markHeard("cell-a");
    });

    expect(result.current.stateFor("cell-a")).toBe("heard");
    // DECISION 9: being heard flips a flag only. The utterance is retained so a
    // click replays it from the LRU cache instead of re-synthesizing.
    expect(result.current.utteranceFor("cell-a")).toEqual(spoken);
  });

  it("returns a heard session to ready when a newer utterance arrives", async () => {
    const { result, rerender } = await renderChannel();

    lastMessage = frame(utterance("cell-a", "a1", 1_000));
    await act(async () => {
      rerender();
    });
    await act(async () => {
      result.current.markHeard("cell-a");
    });
    expect(result.current.stateFor("cell-a")).toBe("heard");

    lastMessage = frame(utterance("cell-a", "a2", 2_000));
    await act(async () => {
      rerender();
    });

    expect(result.current.stateFor("cell-a")).toBe("ready");
    expect(result.current.utteranceFor("cell-a")).toEqual(utterance("cell-a", "a2", 2_000));
  });

  it("does not announce a response that has nothing to say", async () => {
    const { result, rerender } = await renderChannel();

    lastMessage = frame(codeOnly("cell-a", "a1"));
    await act(async () => {
      rerender();
    });

    // No pulse, no pip, no audio: the cell is as inert as one that never
    // received anything, and nothing can be handed to the player either.
    expect(result.current.stateFor("cell-a")).toBe("empty");
    expect(result.current.utteranceFor("cell-a")).toBeNull();
  });

  it("does not announce a stored response that has nothing to say", async () => {
    // Hydration is an arrival too — `/latest` keeps the last response per
    // session whether or not it was speakable.
    serveLatest([codeOnly("cell-a", "a1"), utterance("cell-b", "b1")]);

    const { result } = await renderChannel();

    await waitFor(() => expect(result.current.stateFor("cell-b")).toBe("ready"));
    expect(result.current.stateFor("cell-a")).toBe("empty");
    expect(result.current.utteranceFor("cell-a")).toBeNull();
  });

  it("a response with nothing to say still casts its language vote", async () => {
    const { result, rerender } = await renderChannel();

    // The frame was processed — it just was not announced. Language is a
    // property of the SESSION, not of one response, so a pure-code answer
    // written in Polish is still evidence about the session.
    lastMessage = frame(codeOnly("cell-a", "a1"));
    await act(async () => {
      rerender();
    });
    expect(result.current.languageFor("cell-a")).toBe("en");
    expect(result.current.stateFor("cell-a")).toBe("empty");

    lastMessage = frame(codeOnly("cell-a", "a2"));
    await act(async () => {
      rerender();
    });
    // Two votes are the threshold, exactly as for a spoken response.
    expect(result.current.languageFor("cell-a")).toBe("pl");
    expect(result.current.stateFor("cell-a")).toBe("empty");
  });

  it("a response with nothing to say changes no control state", async () => {
    const { result, rerender } = await renderChannel();

    const spoken = utterance("cell-a", "a1");
    lastMessage = frame(spoken);
    await act(async () => {
      rerender();
    });
    await act(async () => {
      result.current.markHeard("cell-a");
    });
    expect(result.current.stateFor("cell-a")).toBe("heard");

    lastMessage = frame(codeOnly("cell-a", "a2", 2_000));
    await act(async () => {
      rerender();
    });

    // A newer utterance un-hears a cell; one with nothing to say is not news,
    // so the cell keeps both its state and the response it already had.
    expect(result.current.stateFor("cell-a")).toBe("heard");
    expect(result.current.utteranceFor("cell-a")).toEqual(spoken);
  });

  it("reports empty for a session that never received one", async () => {
    serveLatest([utterance("cell-a", "a1")]);

    // `speakingSessionId: null` — nothing is speaking — is the caller's way of
    // saying so, and it is the only way to say it: the field is required, so a
    // call site cannot omit it and quietly lose the `speaking` state.
    speaking = null;
    const { result, rerender } = await renderChannel();
    lastMessage = frame(utterance("cell-b", "b1"));
    await act(async () => {
      rerender();
    });

    expect(result.current.stateFor("cell-a")).toBe("ready");
    expect(result.current.stateFor("cell-b")).toBe("ready");
    expect(result.current.stateFor("cell-never")).toBe("empty");
    expect(result.current.utteranceFor("cell-never")).toBeNull();
  });

  it("persists each step of a cell's speech mode", async () => {
    const { result } = await renderChannel();

    expect(result.current.speechModeOf("cell-a")).toBe("off");

    await act(async () => {
      result.current.cycleSpeechMode("cell-a");
    });
    expect(result.current.speechModeOf("cell-a")).toBe("armed");
    expect(localStorage.getItem(MODES_KEY)).toBe('{"cell-a":"armed"}');

    // Not exclusive: a second cell joins rather than displacing the first.
    await act(async () => {
      result.current.cycleSpeechMode("cell-b");
      result.current.cycleSpeechMode("cell-b");
    });
    expect(result.current.speechModeOf("cell-a")).toBe("armed");
    expect(result.current.speechModeOf("cell-b")).toBe("autoplay");
    expect(result.current.autoplaySessionIds).toEqual(["cell-b"]);
  });

  it("restores speech modes from storage", async () => {
    setStoredSpeechMode("cell-b", "autoplay");

    const { result, unmount } = await renderChannel();
    expect(result.current.speechModeOf("cell-b")).toBe("autoplay");

    unmount();
    const { result: remounted } = await renderChannel();
    expect(remounted.current.speechModeOf("cell-b")).toBe("autoplay");
  });

  it("reports speaking for the session the caller says is speaking", async () => {
    const { result, rerender } = await renderChannel();

    lastMessage = frame(utterance("cell-a", "a1"));
    await act(async () => {
      rerender();
    });

    speaking = "cell-a";
    await act(async () => {
      rerender();
    });
    expect(result.current.stateFor("cell-a")).toBe("speaking");
    // A cell with nothing to say cannot be speaking, whatever the caller claims.
    speaking = "cell-never";
    await act(async () => {
      rerender();
    });
    expect(result.current.stateFor("cell-never")).toBe("empty");
    expect(result.current.stateFor("cell-a")).toBe("ready");
  });

  it("stays usable when /api/speech/latest cannot be reached", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("panel server unreachable");
    }) as unknown as typeof fetch;

    const { result, rerender } = await renderChannel();

    expect(result.current.stateFor("cell-a")).toBe("empty");

    lastMessage = frame(utterance("cell-a", "a1"));
    await act(async () => {
      rerender();
    });
    expect(result.current.stateFor("cell-a")).toBe("ready");
  });

  it("keeps speech modes usable when localStorage throws", async () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("site data blocked");
    });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("site data blocked");
    });
    vi.spyOn(localStorage, "removeItem").mockImplementation(() => {
      throw new Error("site data blocked");
    });

    const { result } = await renderChannel();

    expect(result.current.speechModeOf("cell-a")).toBe("off");
    await act(async () => {
      expect(() => result.current.cycleSpeechMode("cell-a")).not.toThrow();
    });
    // Nothing was persisted, but the mode still holds — and still steps — for
    // this page.
    expect(result.current.speechModeOf("cell-a")).toBe("armed");
    await act(async () => {
      expect(() => result.current.cycleSpeechMode("cell-a")).not.toThrow();
    });
    expect(result.current.speechModeOf("cell-a")).toBe("autoplay");
    expect(localStorage.getItem).toHaveBeenCalled();
  });

  it("ignores frames that are not utterances and re-delivery of a heard one", async () => {
    const { result, rerender } = await renderChannel();

    lastMessage = { type: "file-change", event: "reconnect", path: "" };
    await act(async () => {
      rerender();
    });
    expect(result.current.stateFor("cell-a")).toBe("empty");

    const spoken = utterance("cell-a", "a1");
    lastMessage = frame(spoken);
    await act(async () => {
      rerender();
    });
    await act(async () => {
      result.current.markHeard("cell-a");
    });

    // The same utterance re-delivered must not make a heard cell pulse again.
    lastMessage = { ...frame(spoken) };
    await act(async () => {
      rerender();
    });
    expect(result.current.stateFor("cell-a")).toBe("heard");

    // Same id, different `at` and text: the guard must key on the id. `at` is
    // `Date.now()`, so an `at`-keyed guard would both miss this replay and
    // wrongly conflate two genuinely different utterances that land in the
    // same millisecond.
    lastMessage = frame({ ...spoken, at: spoken.at + 5_000, text: "replayed body" });
    await act(async () => {
      rerender();
    });
    expect(result.current.stateFor("cell-a")).toBe("heard");
    expect(result.current.utteranceFor("cell-a")).toEqual(spoken);
  });

  it("does not let a slow hydration response overwrite a live frame", async () => {
    let deliver: (utterances: Utterance[]) => void = () => {};
    global.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          deliver = (utterances) =>
            resolve({ ok: true, json: async () => ({ utterances }) } as Response);
        }),
    ) as unknown as typeof fetch;

    const { result, rerender } = renderHook(() => useUtteranceChannel(options()));

    const live = utterance("cell-a", "a2", 2_000);
    lastMessage = frame(live);
    await act(async () => {
      rerender();
    });
    await act(async () => {
      result.current.markHeard("cell-a");
    });

    await act(async () => {
      deliver([utterance("cell-a", "a1", 1_000), utterance("cell-b", "b1")]);
      await Promise.resolve();
    });

    expect(result.current.utteranceFor("cell-a")).toEqual(live);
    expect(result.current.stateFor("cell-a")).toBe("heard");
    expect(result.current.stateFor("cell-b")).toBe("ready");
  });

  it("lists what the host warms, from both arrival paths", async () => {
    // Both paths have to land in it — a
    // list carrying only live frames would leave a hydrated tab's control lit
    // and cold. A session whose arrival had nothing to say is not in it: there
    // is no unit 0 to warm.
    serveLatest([utterance("cell-a", "a1")]);
    const { result, rerender } = await renderChannel();

    await waitFor(() => expect(result.current.warmableUtterances).toHaveLength(1));

    lastMessage = frame(utterance("cell-b", "b1"));
    await act(async () => {
      rerender();
    });
    lastMessage = frame(codeOnly("cell-c", "c1"));
    await act(async () => {
      rerender();
    });

    expect(result.current.warmableUtterances.map((entry) => entry.utterance)).toEqual([
      utterance("cell-a", "a1"),
      utterance("cell-b", "b1"),
    ]);
  });

  /**
   * The second warmable is where a `next` press LANDS, and from two steps back
   * that is the step in between — not `current`.
   *
   * The reading that compares the utterance under the cursor against
   * `queue.current` agrees at depth one and is wrong at every depth past it: it
   * warms an answer the transport will not touch for two more presses while
   * leaving cold the one the very next press plays. Restore that reading and
   * every other test in this file still passes; only this one fails.
   */
  it("warms the step a next press reaches, not `current`, from two steps back", async () => {
    const { result, rerender } = await renderChannel();

    for (const id of ["a1", "a2", "a3"]) {
      lastMessage = frame(utterance("cell-a", id, 1_000));
      await act(async () => {
        rerender();
      });
    }

    // Idle arrivals, so each one pushed its predecessor into the history:
    // previous is [a2, a1] and the cursor is on a3.
    expect(result.current.queueFor("cell-a").previous.map((step) => step.id)).toEqual(["a2", "a1"]);

    await act(async () => {
      result.current.dispatchQueue("cell-a", { type: "previous" });
      result.current.dispatchQueue("cell-a", { type: "previous" });
    });
    expect(result.current.queueFor("cell-a").cursor).toBe(2);

    // a1 is under the cursor; a2 — `previous[cursor - 2]` — is one press away.
    // a3 is two presses away and has no business being warmed ahead of it.
    const warmed = result.current.warmableUtterances.map((entry) => entry.utterance.id);
    expect(warmed).toEqual(["a1", "a2"]);
    expect(warmed).not.toContain("a3");
  });

  /**
   * The dedupe gate is wider than the cursor, and this is the test that says
   * so. An answer already WAITING behind the live run, or already stepped back
   * into history, is just as much a re-delivery as the one being spoken —
   * a reconnect replays the lot. Narrow `queueHolds` to `queue.current?.id`
   * and every other test in this file still passes; only this one fails.
   *
   * And the history half is walked to its DEPTH, not just to its head. The gate
   * has to ask every step the queue still holds: narrowing the scan to
   * `previous[0]` reads as covered for as long as the replayed answer is the
   * most recent one stepped back, and quietly appends a duplicate of anything
   * further down the list — which is the ordinary case for a reconnect, since a
   * reconnect replays the whole history at once.
   */
  it("re-delivering a queued or historical utterance does not duplicate it", async () => {
    const { result, rerender } = await renderChannel();

    const first = utterance("cell-a", "a1");
    lastMessage = frame(first);
    await act(async () => {
      rerender();
    });

    // Behind a live run the arrival is queued rather than taking the cursor.
    speaking = "cell-a";
    const queued = utterance("cell-a", "a2", 2_000);
    lastMessage = frame(queued);
    await act(async () => {
      rerender();
    });
    expect(result.current.queueFor("cell-a").pending.map((w) => w.id)).toEqual(["a2"]);

    // The reconnect replays it. Same id, later `at`: nothing may be appended.
    lastMessage = frame({ ...queued, at: queued.at + 5_000 });
    await act(async () => {
      rerender();
    });
    expect(result.current.queueFor("cell-a").pending.map((w) => w.id)).toEqual(["a2"]);
    expect(result.current.queueFor("cell-a").current?.id).toBe("a1");

    // Step a1 into history, then replay THAT: the one step behind the cursor
    // holds an id too, and a cell cannot queue the answer it just played.
    await act(async () => {
      result.current.dispatchQueue("cell-a", { type: "finished" });
    });
    expect(result.current.queueFor("cell-a").previous.map((step) => step.id)).toEqual(["a1"]);

    lastMessage = frame({ ...first, at: first.at + 9_000 });
    await act(async () => {
      rerender();
    });
    const after = result.current.queueFor("cell-a");
    expect(after.previous.map((step) => step.id)).toEqual(["a1"]);
    expect(after.current?.id).toBe("a2");
    expect(after.pending).toEqual([]);

    // Now push a1 DOWN the history, so the gate has to walk past the head to
    // find it. Two idle arrivals: each takes the cursor and shoves what it
    // superseded onto the front of the list.
    speaking = null;
    for (const id of ["a3", "a4"]) {
      lastMessage = frame(utterance("cell-a", id, 3_000));
      await act(async () => {
        rerender();
      });
    }
    expect(result.current.queueFor("cell-a").previous.map((step) => step.id)).toEqual([
      "a3",
      "a2",
      "a1",
    ]);

    // a1 is three steps back and a2 two. The reconnect replays them both, and
    // a gate that only checked `previous[0]` would take each one as news and
    // append it over the top of the history it is already in.
    for (const replayed of [first, queued]) {
      lastMessage = frame({ ...replayed, at: replayed.at + 20_000 });
      await act(async () => {
        rerender();
      });
    }
    const deep = result.current.queueFor("cell-a");
    expect(deep.previous.map((step) => step.id)).toEqual(["a3", "a2", "a1"]);
    expect(deep.current?.id).toBe("a4");
    expect(deep.pending).toEqual([]);
  });

  /**
   * The heard set is cut back to what the queue can still reach, on every
   * advance. Nothing used to take anything out of it: it grew for the life of
   * the tab, and `withHeard` rebuilds the whole of it on each mark.
   *
   * Both halves are asserted here — that the cut KEEPS what the cursor can
   * still be moved onto, and that it drops what the queue has let go of.
   */
  it("prunes heard to the ids the queue can still reach", async () => {
    const { result, rerender } = await renderChannel();

    lastMessage = frame(utterance("cell-a", "a1"));
    await act(async () => {
      rerender();
    });
    await act(async () => {
      result.current.markHeard("cell-a");
    });
    expect(result.current.stateFor("cell-a")).toBe("heard");

    // a1 steps into history and is still reachable, so stepping the cursor
    // back onto it says `heard` again: the cut keeps what can be asked for.
    lastMessage = frame(utterance("cell-a", "a2", 2_000));
    await act(async () => {
      rerender();
    });
    expect(result.current.stateFor("cell-a")).toBe("ready");
    await act(async () => {
      result.current.dispatchQueue("cell-a", { type: "previous" });
    });
    expect(result.current.stateFor("cell-a")).toBe("heard");
    await act(async () => {
      result.current.dispatchQueue("cell-a", { type: "next" });
    });

    // What it takes to drop a1 now: the history is five deep, so a1 has to be
    // pushed off the far end of it before anything can stop carrying its mark.
    // a3 alone used to do this; with a list it takes six answers behind a1,
    // and asserting the shallow version would be asserting the old shape.
    for (const [id, at] of [
      ["a3", 3_000],
      ["a4", 4_000],
      ["a5", 5_000],
      ["a6", 6_000],
    ] as const) {
      lastMessage = frame(utterance("cell-a", id, at));
      await act(async () => {
        rerender();
      });
    }
    // Still the oldest step the history holds, and still heard: nothing that
    // can be stepped onto has been forgotten.
    expect(result.current.queueFor("cell-a").previous.map((step) => step.id)).toEqual([
      "a5",
      "a4",
      "a3",
      "a2",
      "a1",
    ]);

    // a7 is the one that pushes a1 off the end. Nothing can ask about it
    // again, so the session stops carrying it — and a re-broadcast of it is
    // news, which is the one shadow the cut casts.
    lastMessage = frame(utterance("cell-a", "a7", 7_000));
    await act(async () => {
      rerender();
    });
    expect(result.current.queueFor("cell-a").previous.map((step) => step.id)).toEqual([
      "a6",
      "a5",
      "a4",
      "a3",
      "a2",
    ]);

    lastMessage = frame(utterance("cell-a", "a1", 8_000));
    await act(async () => {
      rerender();
    });
    expect(result.current.queueFor("cell-a").current?.id).toBe("a1");
    expect(result.current.stateFor("cell-a")).toBe("ready");
  });

  /**
   * The retention half again, at the depth the list makes possible. The prune
   * reads the queue's reach; a reach that asks `queue.previous` for ONE id —
   * or, worse, asks an array for an `.id` it does not have — throws the mark
   * away for every answer but the newest, and the listener who walks back
   * through a run they already heard is told all of it is unheard news.
   *
   * Every step is asserted, not just the far end: a reach that kept only the
   * first step of history would pass an assertion taken at depth one.
   */
  it("keeps the heard flag for every answer the history can still reach", async () => {
    const { result, rerender } = await renderChannel();

    // Five answers, each played to its end as it lands — an agent that ran
    // ahead of a listener who was keeping up.
    for (const [id, at] of [
      ["h1", 1_000],
      ["h2", 2_000],
      ["h3", 3_000],
      ["h4", 4_000],
      ["h5", 5_000],
    ] as const) {
      lastMessage = frame(utterance("cell-a", id, at));
      await act(async () => {
        rerender();
      });
      await act(async () => {
        result.current.markHeard("cell-a");
      });
      expect(result.current.stateFor("cell-a")).toBe("heard");
    }

    expect(result.current.queueFor("cell-a").previous.map((step) => step.id)).toEqual([
      "h4",
      "h3",
      "h2",
      "h1",
    ]);

    // Walking back through the whole history: every one of them is still a
    // cell the listener has heard, all four steps of it.
    for (let step = 1; step <= 4; step += 1) {
      await act(async () => {
        result.current.dispatchQueue("cell-a", { type: "previous" });
      });
      expect(result.current.queueFor("cell-a").cursor).toBe(step);
      expect(result.current.stateFor("cell-a")).toBe("heard");
    }

    // And back out again, unchanged — the walk itself marks nothing and
    // forgets nothing.
    for (let step = 3; step >= 0; step -= 1) {
      await act(async () => {
        result.current.dispatchQueue("cell-a", { type: "next" });
      });
      expect(result.current.queueFor("cell-a").cursor).toBe(step);
      expect(result.current.stateFor("cell-a")).toBe("heard");
    }
  });

  /**
   * The retention half of `heard`. The prune above pins what falls OUT of the
   * set; this pins what has to stay IN it — a set that kept only the newest id
   * passes every other test in this file, because nothing else ever hears two
   * utterances and then steps back onto the older one. Only the transport makes
   * that reachable, so it is pinned here rather than left to the next reader.
   */
  it("hearing a newer utterance keeps the older one heard when the cursor steps back", async () => {
    const { result, rerender } = await renderChannel();

    lastMessage = frame(utterance("cell-a", "u-1"));
    await act(async () => {
      rerender();
    });
    await act(async () => {
      result.current.markHeard("cell-a");
    });
    expect(result.current.stateFor("cell-a")).toBe("heard");

    // u-1 steps into history, u-2 takes the cursor, and it is heard too.
    lastMessage = frame(utterance("cell-a", "u-2", 2_000));
    await act(async () => {
      rerender();
    });
    await act(async () => {
      result.current.markHeard("cell-a");
    });
    expect(result.current.stateFor("cell-a")).toBe("heard");

    await act(async () => {
      result.current.dispatchQueue("cell-a", { type: "previous" });
    });

    // Both are still reachable, so both are still heard: marking u-2 REPLACING
    // the set rather than adding to it would report the one the user has
    // already listened to as unheard news the moment they stepped back to it.
    expect(result.current.queueFor("cell-a").previous.map((step) => step.id)).toEqual(["u-1"]);
    expect(result.current.stateFor("cell-a")).toBe("heard");

    await act(async () => {
      result.current.dispatchQueue("cell-a", { type: "next" });
    });
    expect(result.current.stateFor("cell-a")).toBe("heard");
  });

  /**
   * Nothing about the queue is persisted. A reloaded tab hydrates from the
   * server's latest-per-session store, which keeps exactly one utterance per
   * cell — so the cell comes back holding that one, with nothing behind the
   * cursor and nothing waiting in front of it.
   */
  it("a reload leaves the queue and history empty", async () => {
    serveLatest([utterance("cell-a", "a7")]);

    const { result } = await renderChannel();

    await waitFor(() => expect(result.current.stateFor("cell-a")).toBe("ready"));
    const queue = result.current.queueFor("cell-a");
    expect(queue.current).toEqual(utterance("cell-a", "a7"));
    expect(queue.previous).toEqual([]);
    expect(queue.pending).toEqual([]);
    expect(queue.cursor).toBe(0);
    // A cell the tab has never heard of has an EMPTY queue, not an undefined
    // one: the transport is rendered in every cell, before any arrival.
    expect(result.current.queueFor("cell-z").current).toBeNull();
  });

  it("preparing and ready are distinguished for a waiting utterance", async () => {
    preparing = new Set(["cell-a"]);
    const { result, rerender } = await renderChannel();

    lastMessage = frame(utterance("cell-a", "a1"));
    await act(async () => {
      rerender();
    });
    // Red: the utterance is here but its first unit is still being synthesized,
    // so a click has nothing to start from.
    expect(result.current.stateFor("cell-a")).toBe("preparing");

    preparing = new Set<string>();
    await act(async () => {
      rerender();
    });
    // Green carries the promise: the audio is in hand.
    expect(result.current.stateFor("cell-a")).toBe("ready");
  });

  it("speaking and stalled are distinguished by the waiting input", async () => {
    const { result, rerender } = await renderChannel();

    // The arrival first, then the run: a cell can only be speaking something
    // that already reached it, and an arrival for a cell that IS speaking is
    // queued behind the run rather than put under the cursor.
    lastMessage = frame(utterance("cell-a", "a1"));
    await act(async () => {
      rerender();
    });
    speaking = "cell-a";
    await act(async () => {
      rerender();
    });
    expect(result.current.stateFor("cell-a")).toBe("speaking");

    // One state for both waits — the first unit of a live run and a
    // mid-response underrun are the same question: is the audio here yet?
    waiting = true;
    await act(async () => {
      rerender();
    });
    expect(result.current.stateFor("cell-a")).toBe("stalled");

    waiting = false;
    await act(async () => {
      rerender();
    });
    expect(result.current.stateFor("cell-a")).toBe("speaking");
  });

  it("paused outranks speaking", async () => {
    const { result, rerender } = await renderChannel();

    lastMessage = frame(utterance("cell-a", "a1"));
    // A paused run is still the *speaking* run — the player keeps naming it,
    // because a pause suspends the element rather than ending the ladder. So
    // the channel has to read `paused` first or a held run reads as playing.
    speaking = "cell-a";
    paused = "cell-a";
    await act(async () => {
      rerender();
    });
    expect(result.current.stateFor("cell-a")).toBe("paused");

    // And it outranks `stalled` too: pausing a run that is blocked on
    // synthesis is legal, and what the user did is the more useful answer.
    waiting = true;
    await act(async () => {
      rerender();
    });
    expect(result.current.stateFor("cell-a")).toBe("paused");
  });

  it("a live run outranks a stale preparing id", async () => {
    const { result, rerender } = await renderChannel();

    lastMessage = frame(utterance("cell-a", "a1"));
    await act(async () => {
      rerender();
    });
    // `preparing` is the control's INERT red — a click raises nothing. So it
    // must never mask a run the user has to be able to pause, however late a
    // warm reports itself.
    preparing = new Set(["cell-a"]);
    speaking = "cell-a";
    await act(async () => {
      rerender();
    });
    expect(result.current.stateFor("cell-a")).toBe("speaking");

    paused = "cell-a";
    await act(async () => {
      rerender();
    });
    expect(result.current.stateFor("cell-a")).toBe("paused");
  });

  it("a paused cell is never heard", async () => {
    const { result, rerender } = await renderChannel();

    lastMessage = frame(utterance("cell-a", "a1"));
    speaking = "cell-a";
    paused = "cell-a";
    await act(async () => {
      rerender();
    });
    expect(result.current.stateFor("cell-a")).toBe("paused");

    // Letting go of a paused run without ever reaching the last unit is an
    // interruption like any other: the cell falls back to green, not yellow.
    speaking = null;
    paused = null;
    await act(async () => {
      rerender();
    });
    expect(result.current.stateFor("cell-a")).toBe("ready");
  });

  it("an empty cell ignores a stray preparing or speaking id", async () => {
    const { result, rerender } = await renderChannel();

    // Nothing has arrived for this cell, so nothing the host or the player
    // says about it can invent a state for it.
    preparing = new Set(["cell-never"]);
    speaking = "cell-never";
    paused = "cell-never";
    waiting = true;
    await act(async () => {
      rerender();
    });
    expect(result.current.stateFor("cell-never")).toBe("empty");

    // A record that exists only to carry a language tally is just as inert.
    lastMessage = frame(codeOnly("cell-never", "c1"));
    await act(async () => {
      rerender();
    });
    expect(result.current.stateFor("cell-never")).toBe("empty");
  });

  it("the host's warming inputs keep their identity across a markHeard", async () => {
    const { result, rerender } = await renderChannel();

    lastMessage = frame(utterance("cell-a", "a1"));
    await act(async () => {
      rerender();
    });

    // The host's warming effect is keyed on both of these. If either changes
    // identity on every `sessions` update the effect churns on every heard
    // cell — and stabilising only one of them changes nothing, because the
    // effect re-runs when *either* moves.
    const utterances = result.current.warmableUtterances;
    const language = result.current.languageFor;

    await act(async () => {
      result.current.markHeard("cell-a");
    });
    expect(result.current.stateFor("cell-a")).toBe("heard");

    expect(result.current.warmableUtterances).toBe(utterances);
    expect(result.current.languageFor).toBe(language);

    // A genuinely new arrival still moves the list — stability must not mean
    // staleness, or nothing would ever be warmed again.
    lastMessage = frame(utterance("cell-b", "b1"));
    await act(async () => {
      rerender();
    });
    expect(result.current.warmableUtterances).not.toBe(utterances);
    expect(result.current.warmableUtterances).toHaveLength(2);
  });

  it("re-fetches the retained utterances when the neutral reconnect frame arrives", async () => {
    const onMount = serveLatest([]);
    const { result } = await renderChannel();
    expect(onMount).toHaveBeenCalledTimes(1);

    // What the Stop hook posted while the tab was frozen. It was broadcast to a
    // dead socket, and the server has been holding it ever since.
    const onReturn = serveLatest([utterance("cell-a", "a1")]);
    await reconnected();

    expect(onReturn).toHaveBeenCalledWith("/api/speech/latest");
    await waitFor(() => expect(result.current.stateFor("cell-a")).toBe("ready"));
    expect(result.current.utteranceFor("cell-a")).toEqual(utterance("cell-a", "a1"));
  });

  it("unsubscribes from the realtime channel when the hook unmounts", async () => {
    const { unmount } = await renderChannel();
    expect(realtimeListeners.size).toBe(1);

    // The effect RETURNS the unsubscribe, so a remount does not leave the
    // previous mount's listener behind re-fetching `/latest` forever.
    unmount();
    expect(realtimeListeners.size).toBe(0);

    const afterUnmount = serveLatest([utterance("cell-a", "a1")]);
    await reconnected();
    expect(afterUnmount).not.toHaveBeenCalled();
  });

  it("still hydrates once on mount", async () => {
    const fetchMock = serveLatest([utterance("cell-a", "a1")]);

    const { result } = await renderChannel();

    // The reconnect subscription must not turn the mount into two fetches.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/speech/latest");
    await waitFor(() => expect(result.current.stateFor("cell-a")).toBe("ready"));
  });

  it("takes up a newer utterance for a session it already has a record for", async () => {
    serveLatest([utterance("cell-a", "a1")]);
    const { result } = await renderChannel();
    await waitFor(() => expect(result.current.stateFor("cell-a")).toBe("ready"));

    // A returning tab ALWAYS has a record for the session — it is the state a
    // freeze leaves behind — so a gate on the session id skips precisely the
    // answer the user came back for.
    serveLatest([utterance("cell-a", "a2", 2_000)]);
    await reconnected();

    await waitFor(() =>
      expect(result.current.utteranceFor("cell-a")).toEqual(utterance("cell-a", "a2", 2_000)),
    );
    expect(result.current.queueFor("cell-a").previous.map((step) => step.id)).toEqual(["a1"]);
  });

  it("does not append an utterance the queue already holds", async () => {
    serveLatest([utterance("cell-a", "a1")]);
    const { result, rerender } = await renderChannel();
    await waitFor(() => expect(result.current.stateFor("cell-a")).toBe("ready"));

    // Under the cursor: the server retains it and hands it back on every
    // catch-up, so this is the case that repeats forever if it is not gated.
    await reconnected();
    expect(result.current.queueFor("cell-a").previous).toHaveLength(0);
    expect(result.current.queueFor("cell-a").pending).toHaveLength(0);

    // In `previous`: a newer answer superseded it, and a replay must not walk
    // it back in front of the one the cell is on.
    lastMessage = frame(utterance("cell-a", "a2", 2_000));
    await act(async () => {
      rerender();
    });
    serveLatest([utterance("cell-a", "a1")]);
    await reconnected();
    expect(result.current.utteranceFor("cell-a")).toEqual(utterance("cell-a", "a2", 2_000));
    expect(result.current.queueFor("cell-a").previous.map((step) => step.id)).toEqual(["a1"]);

    // In `pending`: it queued behind a live run and has not been reached yet.
    speaking = "cell-a";
    lastMessage = frame(utterance("cell-a", "a3", 3_000));
    await act(async () => {
      rerender();
    });
    expect(result.current.queueFor("cell-a").pending.map((step) => step.id)).toEqual(["a3"]);

    serveLatest([utterance("cell-a", "a3", 3_000)]);
    await reconnected();
    expect(result.current.queueFor("cell-a").pending.map((step) => step.id)).toEqual(["a3"]);
  });

  it("does not re-take a catch-up the cell has already moved past", async () => {
    serveLatest([utterance("cell-a", "a1")]);
    const { result, rerender } = await renderChannel();
    await waitFor(() => expect(result.current.stateFor("cell-a")).toBe("ready"));

    // Six newer answers push a1 off the far end of a five-deep history, so its
    // id is nowhere in the queue any more — and the queue is the whole of a
    // `queueHolds` dedupe's reach.
    for (const step of [2, 3, 4, 5, 6, 7]) {
      lastMessage = frame(utterance("cell-a", `a${step}`, step * 1_000));
      await act(async () => {
        rerender();
      });
    }
    const history = ["a6", "a5", "a4", "a3", "a2"];
    expect(result.current.queueFor("cell-a").previous.map((step) => step.id)).toEqual(history);

    // The server retains one utterance per session and hands it back on every
    // catch-up. Aged out of the queue it would be taken as news: a duplicate in
    // the history, a pip for an answer already heard, and the cell showing one
    // the listener left behind six answers ago. What the cell is on is newer by
    // the clock, which is a fact the queue window cannot express.
    serveLatest([utterance("cell-a", "a1")]);
    await reconnected();

    expect(result.current.utteranceFor("cell-a")).toEqual(utterance("cell-a", "a7", 7_000));
    expect(result.current.queueFor("cell-a").previous.map((step) => step.id)).toEqual(history);
    expect(recordAutoplayed).not.toHaveBeenCalled();
  });

  it("does not append a snapshot entry a later utterance has overtaken", async () => {
    const { result, rerender } = await renderChannel();

    // The snapshot `/latest` will answer the catch-up with, taken before a2 was
    // posted.
    serveLatest([utterance("cell-a", "a1")]);

    // a2 was posted after that snapshot and won the race home.
    lastMessage = frame(utterance("cell-a", "a2", 2_000));
    await act(async () => {
      rerender();
    });
    expect(result.current.utteranceFor("cell-a")).toEqual(utterance("cell-a", "a2", 2_000));

    await reconnected();

    // The cell never held a1, so an id-only gate has nothing to compare against
    // and appends the older answer over the newer one — the cell then shows the
    // stale answer until the user presses next. Sub-second, and still wrong.
    expect(result.current.utteranceFor("cell-a")).toEqual(utterance("cell-a", "a2", 2_000));
    expect(result.current.queueFor("cell-a").previous).toHaveLength(0);
    expect(recordAutoplayed).not.toHaveBeenCalled();
  });

  it("does not re-announce an utterance that was already heard", async () => {
    serveLatest([utterance("cell-a", "a1")]);
    const { result } = await renderChannel();
    await waitFor(() => expect(result.current.stateFor("cell-a")).toBe("ready"));

    await act(async () => {
      result.current.markHeard("cell-a");
    });
    expect(result.current.stateFor("cell-a")).toBe("heard");

    await reconnected();

    // The server still retains it; the cell has already listened to it.
    expect(result.current.stateFor("cell-a")).toBe("heard");
    expect(result.current.queueFor("cell-a").previous).toHaveLength(0);
    expect(recordAutoplayed).not.toHaveBeenCalled();
  });

  it("marks a caught-up utterance as autoplayed so an autoplay cell stays silent", async () => {
    const { result } = await renderChannel();
    await act(async () => {
      result.current.cycleSpeechMode("cell-a"); // armed
      result.current.cycleSpeechMode("cell-a"); // autoplay
    });

    serveLatest([utterance("cell-a", "a1")]);
    await reconnected();

    await waitFor(() => expect(result.current.stateFor("cell-a")).toBe("ready"));
    // Returning to the app is not a user gesture, and an armed cell ABSORBS an
    // arrival it cannot play rather than deferring it — the recovered answer
    // would lose its spoken form for good. See ADR 0017.
    expect(recordAutoplayed).toHaveBeenCalledWith("cell-a", "a1");
  });

  it("does not mark a catch-up autoplayed when a live frame beat it to the commit", async () => {
    /**
     * The window this pins is the browser's, not `act`'s. A live frame's
     * `setSessions` is QUEUED, not applied, and the `/latest` continuation is a
     * promise callback that can run in between — so it decides against a
     * `sessionsRef` that predates the frame, React applies the frame first, and
     * the updater's own re-check drops the entry while `recordAutoplayed` has
     * already absorbed it. The answer then arrived as a genuine live frame on
     * an awake tab and is silent for good, which ADR 0017 calls worse than not
     * recovering it at all.
     *
     * `act` flushes an effect's update synchronously and so closes that window,
     * which is why this one test renders outside it. `afterCommit` is an effect
     * declared after the channel's own, so it runs in the same pass one line
     * past the frame's queued update — the exact moment the fetch has to land.
     *
     * Nothing flushes for us out here, so the wait is a drain of the browser's
     * own macrotask queue — bounded by the SETTLED STATE, the cell actually
     * holding the answer, rather than by a fixed pass count, which had no
     * margin left: `ready` arrived on the third of three passes. Draining
     * longer cannot re-close the window; it was opened by `afterCommit` landing
     * the fetch mid-commit and is shut long before the first pass returns. And
     * the failure this pins is observed strictly EARLIER than what we wait on:
     * a regression records the autoplay from the fetch's own continuation, a
     * microtask, while `ready` needs React to commit the frame.
     */
    let afterCommit: () => void = () => {};
    let forceRender: () => void = () => {};
    const { result } = renderHook(() => {
      const [, bump] = useReducer((n: number) => n + 1, 0);
      forceRender = bump;
      const channel = useUtteranceChannel(options());
      useEffect(() => {
        afterCommit();
      });
      return channel;
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      result.current.cycleSpeechMode("cell-a"); // armed
      result.current.cycleSpeechMode("cell-a"); // autoplay
    });

    // A catch-up that stays in flight until the live frame has been queued.
    let land: () => void = () => {};
    const body = new Promise<{ utterances: Utterance[] }>((resolve) => {
      land = () => resolve({ utterances: [utterance("cell-a", "a1")] });
    });
    global.fetch = vi.fn(
      async () => ({ ok: true, json: () => body }) as unknown as Response,
    ) as unknown as typeof fetch;
    await act(async () => {
      for (const listener of [...realtimeListeners]) listener({ ...REALTIME_RECONNECT_FRAME });
    });

    const restoreActEnvironment = actEnvironment(false);
    try {
      afterCommit = land;
      lastMessage = frame(utterance("cell-a", "a1"));
      forceRender();
      await drainUntil(
        () => result.current.stateFor("cell-a") === "ready",
        "the cell to take up the answer the live frame carried",
      );
    } finally {
      afterCommit = () => {};
      actEnvironment(restoreActEnvironment);
    }

    // The socket was back and the answer arrived as an ordinary broadcast, so
    // it is the arrival path's to autoplay. A catch-up that lost the race to it
    // took nothing up, and must not record what it did not deliver.
    expect(result.current.stateFor("cell-a")).toBe("ready");
    expect(recordAutoplayed).not.toHaveBeenCalled();
  });

  it("commits the catch-up ahead of a live frame landing in the same commit", async () => {
    /**
     * Pins the DECLARATION ORDER of the two arrival effects, which is
     * load-bearing and which nothing else in this file discriminates: the test
     * above lands its `setFetched` from an effect declared after the channel,
     * so the fetch always commits in a LATER commit than the live frame and the
     * same-commit interleave is never built.
     *
     * Here it is. `lastMessage` is a module variable read during render, so
     * staging the frame and then resolving the catch-up puts BOTH changed
     * dependencies in the one render `setFetched` triggers — the commit effect
     * and the arrival effect run back to back in that commit, in declaration
     * order.
     *
     * The commit effect is declared ABOVE the arrival effect, so the catch-up's
     * updater is queued first and the arrival's own `queueHolds` gate finds the
     * answer already in the queue and no-ops. Swap the two declarations and the
     * arrival is queued first while the catch-up still decides against a
     * `sessionsRef` that predates it — the mirror is written during render, so
     * it says the same thing whichever effect asks — and its updater, which no
     * longer re-checks `covers`, hands the same id to a reducer with no dedupe
     * of its own and the cell ends up holding the answer twice.
     */
    const { result } = await renderChannel();
    await act(async () => {
      result.current.cycleSpeechMode("cell-a"); // armed
      result.current.cycleSpeechMode("cell-a"); // autoplay
    });

    // A catch-up held in flight, so the frame can be staged before it lands.
    let land: () => void = () => {};
    const body = new Promise<{ utterances: Utterance[] }>((resolve) => {
      land = () => resolve({ utterances: [utterance("cell-a", "a1")] });
    });
    global.fetch = vi.fn(
      async () => ({ ok: true, json: () => body }) as unknown as Response,
    ) as unknown as typeof fetch;
    await act(async () => {
      for (const listener of [...realtimeListeners]) listener({ ...REALTIME_RECONNECT_FRAME });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // The broadcast of the very same answer, staged but not yet rendered: the
    // render `setFetched` triggers is the one that reads it, which is what puts
    // the two arrivals in a single commit.
    lastMessage = frame(utterance("cell-a", "a1"));
    await act(async () => {
      land();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const queue = result.current.queueFor("cell-a");
    const held = [...queue.previous, ...(queue.current ? [queue.current] : []), ...queue.pending];
    // Exactly one copy, anywhere in the queue. `utteranceQueueReducer` dedupes
    // nothing, so the order these two effects commit in is the whole of what
    // keeps the second copy out.
    expect(held.filter((entry) => entry.id === "a1")).toHaveLength(1);
    expect(queue.previous).toHaveLength(0);
    expect(result.current.stateFor("cell-a")).toBe("ready");
    // The catch-up committed first, so it is the path that actually delivered
    // the answer and the one whose `recordAutoplayed` is honest — once, for the
    // single entry the cell ends up holding.
    expect(recordAutoplayed).toHaveBeenCalledTimes(1);
    expect(recordAutoplayed).toHaveBeenCalledWith("cell-a", "a1");
  });

  it("leaves a caught-up utterance unheard and counted as unread", async () => {
    serveLatest([utterance("cell-a", "a1")]);
    const { result } = await renderChannel();
    await waitFor(() => expect(result.current.stateFor("cell-a")).toBe("ready"));
    await act(async () => {
      result.current.markHeard("cell-a");
    });

    serveLatest([utterance("cell-a", "a2", 2_000)]);
    await reconnected();

    // Not spoken is not the same as listened to: the pip and the count are the
    // only trace a silent recovery leaves.
    await waitFor(() => expect(result.current.stateFor("cell-a")).toBe("ready"));
    expect(result.current.heardFor("cell-a").has("a2")).toBe(false);
    expect(
      unplayedSinceLastPlayed(result.current.queueFor("cell-a"), result.current.heardFor("cell-a")),
    ).toBe(1);
  });

  it("queues a catch-up behind a live run, and supersedes a paused one", async () => {
    serveLatest([utterance("cell-a", "a1")]);
    const { result } = await renderChannel();
    await waitFor(() => expect(result.current.stateFor("cell-a")).toBe("ready"));

    // An `online` event can land in the middle of a run the user is listening
    // to. The recovered answer waits its turn there, exactly as a live frame
    // would — the catch-up takes the rule from the playback inputs rather than
    // assuming an arriving tab is idle.
    speaking = "cell-a";
    serveLatest([utterance("cell-a", "a2", 2_000)]);
    await reconnected();

    await waitFor(() =>
      expect(result.current.queueFor("cell-a").pending.map((step) => step.id)).toEqual(["a2"]),
    );
    expect(result.current.utteranceFor("cell-a")).toEqual(utterance("cell-a", "a1"));

    // A cell the user has PAUSED does not hold the next answer hostage, so the
    // arrival supersedes the held run instead of queueing behind it.
    paused = "cell-a";
    serveLatest([utterance("cell-a", "a3", 3_000)]);
    await reconnected();

    await waitFor(() =>
      expect(result.current.utteranceFor("cell-a")).toEqual(utterance("cell-a", "a3", 3_000)),
    );
    expect(result.current.queueFor("cell-a").pending.map((step) => step.id)).toEqual(["a2"]);
  });

  it("seeds no pip for a caught-up utterance with nothing to say", async () => {
    serveLatest([utterance("cell-a", "a1")]);
    const { result } = await renderChannel();
    await waitFor(() => expect(result.current.stateFor("cell-a")).toBe("ready"));
    await act(async () => {
      result.current.markHeard("cell-a");
    });
    expect(result.current.stateFor("cell-a")).toBe("heard");

    // A pure-code answer prepares to zero units, so announcing it would be a
    // notification that can never be met — on catch-up as on arrival.
    serveLatest([codeOnly("cell-a", "c1", 2_000)]);
    await reconnected();

    expect(result.current.stateFor("cell-a")).toBe("heard");
    expect(result.current.utteranceFor("cell-a")).toEqual(utterance("cell-a", "a1"));
    expect(
      unplayedSinceLastPlayed(result.current.queueFor("cell-a"), result.current.heardFor("cell-a")),
    ).toBe(0);
    expect(recordAutoplayed).not.toHaveBeenCalled();
  });

  it("surfaces no error when the catch-up fetch fails", async () => {
    // The other half of the same requirement: a failed catch-up is swallowed,
    // not merely survived. An unreachable panel server is the status quo ante,
    // and the fetch runs in a floating promise — so anything thrown past the
    // `catch` becomes an unhandled rejection with nobody to tell, which the
    // channel's own state cannot show.
    const rejected: unknown[] = [];
    const onRejection = (reason: unknown) => rejected.push(reason);
    process.on("unhandledRejection", onRejection);
    try {
      const { unmount } = await renderChannel();

      global.fetch = vi.fn(async () => {
        throw new Error(UNREACHABLE);
      }) as unknown as typeof fetch;
      await reconnected();
      // A further macrotask, so a rejection has had its turn to surface.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // The teardown is INSIDE the window, not left to RTL's shared
      // `cleanup()`: the fetch's continuation runs on the way down too, and a
      // rejection raised there would surface after the `finally` below had
      // already stopped listening — invisible to the one test that caused it.
      await act(async () => {
        unmount();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // THIS test's own rejection, not an empty worker. Asserting the array is
      // empty couples the test to every other one in the file — several install
      // a throwing `global.fetch`, and one of those left pending fails this
      // test for a reason that has nothing to do with it.
      expect(rejected.map(reasonOf).filter((reason) => reason.includes(UNREACHABLE))).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });

  it("survives a failed catch-up fetch and still registers later live frames", async () => {
    const { result, rerender } = await renderChannel();

    global.fetch = vi.fn(async () => {
      throw new Error(UNREACHABLE);
    }) as unknown as typeof fetch;
    await reconnected();

    // A failed catch-up is not an error state, it is the status quo ante.
    expect(result.current.stateFor("cell-a")).toBe("empty");

    lastMessage = frame(utterance("cell-a", "a1"));
    await act(async () => {
      rerender();
    });
    expect(result.current.stateFor("cell-a")).toBe("ready");
  });
});

describe("useUtteranceChannel — answers handed on", () => {
  it("a live frame is handed on once; recoveries are marked recovered", async () => {
    serveLatest([utterance("cell-a", "a1")]);
    const { rerender } = await renderChannel();
    // The mount hydration is a recovery, not news.
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(utterance("cell-a", "a1"), true));

    lastMessage = frame(utterance("cell-b", "b1", 2_000));
    await act(async () => {
      rerender();
    });
    expect(onAnswer).toHaveBeenLastCalledWith(utterance("cell-b", "b1", 2_000), false);

    // A re-delivery of a held answer and an answer with nothing to say are not news.
    onAnswer.mockClear();
    lastMessage = { ...frame(utterance("cell-b", "b1", 2_000)) };
    await act(async () => {
      rerender();
    });
    lastMessage = frame(codeOnly("cell-b", "b2", 3_000));
    await act(async () => {
      rerender();
    });
    expect(onAnswer).not.toHaveBeenCalled();

    // A catch-up's answer is recovered.
    serveLatest([utterance("cell-c", "c1", 4_000)]);
    await reconnected();
    expect(onAnswer).toHaveBeenCalledWith(utterance("cell-c", "c1", 4_000), true);
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });
});
