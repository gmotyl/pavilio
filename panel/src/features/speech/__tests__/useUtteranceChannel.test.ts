import { act, renderHook, waitFor } from "@testing-library/react";
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
const { SPEECH_ARMED_STORAGE_KEY } = await import("../voices");

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

/** The four playback/synthesis inputs, as of whatever the variables now say. */
const options = () => ({
  speakingSessionId: speaking,
  pausedSessionId: paused,
  waitingForSynthesis: waiting,
  preparingSessionIds: preparing,
});

/** Renders the hook and lets the mount fetch settle, so no assertion races hydration. */
async function renderChannel() {
  const rendered = renderHook(() => useUtteranceChannel(options()));
  await act(async () => {
    await Promise.resolve();
  });
  return rendered;
}

beforeEach(() => {
  lastMessage = null;
  speaking = null;
  paused = null;
  waiting = false;
  preparing = new Set<string>();
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

  it("arming one session clears the previously armed one", async () => {
    const { result } = await renderChannel();

    expect(result.current.armedSessionId).toBeNull();

    await act(async () => {
      result.current.setArmed("cell-a");
    });
    expect(result.current.armedSessionId).toBe("cell-a");
    expect(SPEECH_ARMED_STORAGE_KEY).toBe("panel-speech-armed");
    expect(localStorage.getItem(SPEECH_ARMED_STORAGE_KEY)).toBe("cell-a");

    // DECISION 12: one armed cell, so arming another IS disarming the first.
    await act(async () => {
      result.current.setArmed("cell-b");
    });
    expect(result.current.armedSessionId).toBe("cell-b");
    expect(localStorage.getItem(SPEECH_ARMED_STORAGE_KEY)).toBe("cell-b");

    await act(async () => {
      result.current.setArmed(null);
    });
    expect(result.current.armedSessionId).toBeNull();
    expect(localStorage.getItem(SPEECH_ARMED_STORAGE_KEY)).toBeNull();
  });

  it("restores the armed session from storage", async () => {
    localStorage.setItem(SPEECH_ARMED_STORAGE_KEY, "cell-b");

    const { result, unmount } = await renderChannel();
    expect(result.current.armedSessionId).toBe("cell-b");

    unmount();
    const { result: remounted } = await renderChannel();
    expect(remounted.current.armedSessionId).toBe("cell-b");
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

  it("keeps arming usable when localStorage throws", async () => {
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

    expect(result.current.armedSessionId).toBeNull();
    await act(async () => {
      expect(() => result.current.setArmed("cell-a")).not.toThrow();
    });
    // Nothing was persisted, but arming still holds for this page.
    expect(result.current.armedSessionId).toBe("cell-a");
    await act(async () => {
      expect(() => result.current.setArmed(null)).not.toThrow();
    });
    expect(result.current.armedSessionId).toBeNull();
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

  it("lists every speakable utterance, from both arrival paths", async () => {
    // This is what the host warms from, so both paths have to land in it — a
    // list carrying only live frames would leave a hydrated tab's control lit
    // and cold. A session whose arrival had nothing to say is not in it: there
    // is no unit 0 to warm.
    serveLatest([utterance("cell-a", "a1")]);
    const { result, rerender } = await renderChannel();

    await waitFor(() => expect(result.current.speakableUtterances).toHaveLength(1));

    lastMessage = frame(utterance("cell-b", "b1"));
    await act(async () => {
      rerender();
    });
    lastMessage = frame(codeOnly("cell-c", "c1"));
    await act(async () => {
      rerender();
    });

    expect(result.current.speakableUtterances).toEqual([
      utterance("cell-a", "a1"),
      utterance("cell-b", "b1"),
    ]);
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

    lastMessage = frame(utterance("cell-a", "a1"));
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
    const utterances = result.current.speakableUtterances;
    const language = result.current.languageFor;

    await act(async () => {
      result.current.markHeard("cell-a");
    });
    expect(result.current.stateFor("cell-a")).toBe("heard");

    expect(result.current.speakableUtterances).toBe(utterances);
    expect(result.current.languageFor).toBe(language);

    // A genuinely new arrival still moves the list — stability must not mean
    // staleness, or nothing would ever be warmed again.
    lastMessage = frame(utterance("cell-b", "b1"));
    await act(async () => {
      rerender();
    });
    expect(result.current.speakableUtterances).not.toBe(utterances);
    expect(result.current.speakableUtterances).toHaveLength(2);
  });
});
