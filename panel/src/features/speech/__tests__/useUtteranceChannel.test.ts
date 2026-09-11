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
 * Playback lives in `useSpeechPlayer`, not here, so `speaking` is an input:
 * whatever the caller says is speaking. Task 11 passes the player's
 * `speakingSessionId`; these tests pass this variable.
 */
let speaking: string | null = null;

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

/** Renders the hook and lets the mount fetch settle, so no assertion races hydration. */
async function renderChannel() {
  const rendered = renderHook(() => useUtteranceChannel({ speakingSessionId: speaking }));
  await act(async () => {
    await Promise.resolve();
  });
  return rendered;
}

beforeEach(() => {
  lastMessage = null;
  speaking = null;
  serveLatest([]);
});

describe("useUtteranceChannel", () => {
  it("hydrates from /api/speech/latest on mount", async () => {
    const fetchMock = serveLatest([utterance("cell-a", "a1"), utterance("cell-b", "b1")]);

    const { result } = await renderChannel();

    expect(fetchMock).toHaveBeenCalledWith("/api/speech/latest");
    // A tab that mounts after the broadcast has not heard the utterance, and
    // the server keeps only the latest — so a seeded cell is unheard, not heard.
    await waitFor(() => expect(result.current.stateFor("cell-a")).toBe("unheard"));
    expect(result.current.stateFor("cell-b")).toBe("unheard");
    expect(result.current.utteranceFor("cell-b")).toEqual(utterance("cell-b", "b1"));
  });

  it("marks a session unheard when a frame arrives", async () => {
    const { result, rerender } = await renderChannel();

    // Nothing has ever told the hook this session exists — the frame itself
    // registers it, because an utterance can be the first news of a terminal.
    expect(result.current.stateFor("cell-x")).toBe("empty");

    lastMessage = frame(utterance("cell-x", "x1"));
    await act(async () => {
      rerender();
    });

    expect(result.current.stateFor("cell-x")).toBe("unheard");
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

  it("returns a heard session to unheard when a newer utterance arrives", async () => {
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

    expect(result.current.stateFor("cell-a")).toBe("unheard");
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

    await waitFor(() => expect(result.current.stateFor("cell-b")).toBe("unheard"));
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

    expect(result.current.stateFor("cell-a")).toBe("unheard");
    expect(result.current.stateFor("cell-b")).toBe("unheard");
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
    expect(result.current.stateFor("cell-a")).toBe("unheard");
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
    expect(result.current.stateFor("cell-a")).toBe("unheard");
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

    const { result, rerender } = renderHook(() => useUtteranceChannel({ speakingSessionId: speaking }));

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
    expect(result.current.stateFor("cell-b")).toBe("unheard");
  });
});
