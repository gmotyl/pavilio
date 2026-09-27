/**
 * Stepping back is navigation, not playback.
 *
 * `onPrevious` used to move the cursor and then speak what it had moved onto,
 * which made the backward control the one transport press you could not use to
 * *look* at something. Greg's case is skimming: walk back through the answers
 * a cell is holding, read them, and hear the one that turns out to matter. A
 * press that starts audio makes that impossible — every step talks over the
 * last one, and the only way to read an older answer quietly was not to reach
 * it at all.
 *
 * So the press now moves the cursor and stops. The play control is how the
 * answer under the cursor is heard, which is exactly what it already did.
 *
 * `onNext` is now the same, and the file covers both directions. The asymmetry
 * used to be pinned here as deliberate — forward was "the way into what is
 * waiting and the gesture that releases the pane's hold". It is no longer only
 * that: the unread count says an answer is waiting and the play control speaks
 * it, while forward is also the single way back onto the wave, which made the
 * gesture that RETURNS to the waiting state the loudest control on the row.
 *
 * So the rule is one sentence in both directions — navigation moves the cursor,
 * and audio starts from the arm switch or the play button. Arming still governs
 * ARRIVALS, which is what it is for; it does not turn a step into a playback,
 * any more than it does for a backward one.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const synth = vi.hoisted(() => {
  const buffers = new Map<string, ArrayBuffer>();
  const bufferText = new Map<ArrayBuffer, string>();
  const blobText = new Map<Blob, string>();
  const cache = new Map<string, Promise<ArrayBuffer>>();

  function bufferFor(text: string): ArrayBuffer {
    const existing = buffers.get(text);
    if (existing) return existing;
    const buffer = new Uint8Array([text.length % 255]).buffer;
    buffers.set(text, buffer);
    bufferText.set(buffer, text);
    return buffer;
  }

  function synthesizeSpeech(text: string, options: { voice?: string } = {}): Promise<ArrayBuffer> {
    const key = `${options.voice ?? ""}::${text}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const promise = Promise.resolve(bufferFor(text));
    cache.set(key, promise);
    return promise;
  }

  return {
    synthesizeSpeech,
    prefetchSpeech: (text: string, options: { voice?: string } = {}): void => {
      void synthesizeSpeech(text, options).catch(() => {});
    },
    toSpeechBlob: (buffer: ArrayBuffer): Blob => {
      const blob = new Blob([buffer], { type: "audio/mpeg" });
      blobText.set(blob, bufferText.get(buffer) ?? "unknown");
      return blob;
    },
    textForBlob: (blob: Blob): string => blobText.get(blob) ?? "unknown",
    reset: (): void => {
      cache.clear();
    },
  };
});

vi.mock("../synth", () => ({
  synthesizeSpeech: synth.synthesizeSpeech,
  prefetchSpeech: synth.prefetchSpeech,
  toSpeechBlob: synth.toSpeechBlob,
  SPEECH_AUDIO_MIME_TYPE: "audio/mpeg",
}));

const ws = vi.hoisted(() => {
  const setters = new Set<(message: Record<string, unknown> | null) => void>();
  return {
    setters,
    emit(message: Record<string, unknown>): void {
      for (const set of setters) set(message);
    },
  };
});

vi.mock("../../realtime/useWebSocket", async () => {
  const React = await import("react");
  return {
    useWebSocket: () => {
      const [lastMessage, setLastMessage] = React.useState<Record<string, unknown> | null>(null);
      React.useEffect(() => {
        ws.setters.add(setLastMessage);
        return () => {
          ws.setters.delete(setLastMessage);
        };
      }, []);
      return { lastMessage };
    },
  };
});

import {
  __resetAnswerWaitingForTests,
  beginWaiting,
  getAnswerWaiting,
  holdAnswer,
  isAnswerHeld,
  noteAgentStarting,
} from "../../terminal/answerWaiting";
import { prepare } from "../prepare";
import { useSpeechHost } from "../useSpeechHost";
import { utteranceUnderCursor } from "../utteranceQueue";

/** The `src` of every started playback, in order. A silent press adds none. */
const played: string[] = [];
/** One entry per `unlock()` — a play on the source-less element. */
const unlocks: number[] = [];
const elements: HTMLMediaElement[] = [];

async function drain(): Promise<void> {
  for (let i = 0; i < 100; i += 1) await Promise.resolve();
}

async function emitUtterance(sessionId: string, id: string, text: string): Promise<void> {
  await act(async () => {
    ws.emit({ type: "speech-utterance", id, sessionId, text, at: Date.now() });
    await drain();
  });
}

async function settle(action: () => void): Promise<void> {
  await act(async () => {
    action();
    await drain();
  });
}

/** A response of `count` units, each comfortably inside the packing window. */
function response(count: number, word = "Paragraph"): string {
  return Array.from({ length: count }, (_, i) => {
    const head = `${word} ${String(i).padStart(2, "0")} `;
    return head + "x".repeat(238 - head.length) + ".";
  }).join("\n\n");
}

const unitsOf = (text: string): string[] =>
  prepare(text, { language: "en" }).units.map((unit) => unit.text);

const FIRST = response(2, "First");
const SECOND = response(2, "Second");
const THIRD = response(2, "Third");

/**
 * Three answers in one cell, none of them played: u-3 under the cursor, u-2 and
 * u-1 the two steps of history behind it. Deep enough that a press which
 * replayed `previous[0]` twice would show, rather than coincidentally agreeing
 * with a one-slot history.
 */
async function threeAnswers(sessionId: string): Promise<void> {
  await emitUtterance(sessionId, "u-1", FIRST);
  await emitUtterance(sessionId, "u-2", SECOND);
  await emitUtterance(sessionId, "u-3", THIRD);
  played.length = 0;
}

beforeEach(() => {
  synth.reset();
  played.length = 0;
  unlocks.length = 0;
  elements.length = 0;
  ws.setters.clear();
  localStorage.clear();
  __resetAnswerWaitingForTests();

  global.fetch = vi.fn(
    async () => ({ ok: true, json: async () => ({ utterances: [] }) }) as Response,
  ) as unknown as typeof fetch;

  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: (blob: Blob) => `blob:${synth.textForBlob(blob)}`,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: () => {},
  });

  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    const src = this.getAttribute("src");
    // `unlock()` plays a source-less element on purpose; that is not audio, so
    // it is counted apart rather than ignored. Silence is this file's first
    // subject, but a press that is silent AND never unlocks is the regression
    // the wave step nearly shipped — see "the wave step still spends the
    // autoplay grant".
    if (src) {
      played.push(src);
      elements.push(this);
    } else {
      unlocks.push(1);
    }
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

describe("useSpeechHost — stepping back navigates without playing", () => {
  it("previous moves the cursor", async () => {
    const { result } = renderHook(() => useSpeechHost());
    await threeAnswers("cell-a");

    await settle(() => result.current.onPrevious("cell-a"));
    expect(result.current.queueFor("cell-a").cursor).toBe(1);
    expect(utteranceUnderCursor(result.current.queueFor("cell-a"))?.id).toBe("u-2");

    // And the second press walks the list rather than re-reading `previous[0]`.
    await settle(() => result.current.onPrevious("cell-a"));
    expect(result.current.queueFor("cell-a").cursor).toBe(2);
    expect(utteranceUnderCursor(result.current.queueFor("cell-a"))?.id).toBe("u-1");
  });

  it("previous speaks nothing", async () => {
    const { result } = renderHook(() => useSpeechHost());
    await threeAnswers("cell-a");

    await settle(() => result.current.onPrevious("cell-a"));
    await settle(() => result.current.onPrevious("cell-a"));

    // Not "did not speak the wrong answer" — did not speak at all. The whole
    // point of the skim is that the backlog stays quiet while it is walked.
    expect(played).toEqual([]);
    expect(result.current.speakingSessionId).toBeNull();
  });

  it("previous speaks nothing on the ARMED cell either", async () => {
    const { result } = renderHook(() => useSpeechHost());
    await threeAnswers("cell-a");

    // Arming is the state Greg actually listens in, and it is the one route by
    // which a press with no `speakUtterance` in it can still make a sound: the
    // autoplay effect watches the utterance UNDER THE CURSOR, so a backward
    // step changes what it sees and it starts that answer on its own. A
    // `onPrevious` that merely dropped its own speak call would pass every
    // other test here and still talk over the skim.
    await settle(() => result.current.onArm("cell-a"));
    played.length = 0;

    await settle(() => result.current.onPrevious("cell-a"));

    expect(result.current.queueFor("cell-a").cursor).toBe(1);
    expect(played).toEqual([]);
  });

  it("previous does not record the answer as played", async () => {
    const { result } = renderHook(() => useSpeechHost());
    await threeAnswers("cell-a");

    await settle(() => result.current.onPrevious("cell-a"));

    // `heard` is what the unplayed count is derived from, so a silent step has
    // to leave it exactly where it was — landing on an answer is not listening
    // to it, and a skim that decremented the count would hide the very answers
    // it was looking for.
    expect([...result.current.heardFor("cell-a")]).toEqual([]);
    expect(result.current.stateFor("cell-a")).toBe("ready");
  });

  it("previous at the oldest answer moves nothing and speaks nothing", async () => {
    const { result } = renderHook(() => useSpeechHost());
    await threeAnswers("cell-a");

    await settle(() => result.current.onPrevious("cell-a"));
    await settle(() => result.current.onPrevious("cell-a"));
    expect(result.current.queueFor("cell-a").cursor).toBe(2);

    // The oldest answer the cell holds: the press is refused rather than
    // falling off the front of the list, and a refused press is still silent.
    await settle(() => result.current.onPrevious("cell-a"));
    expect(result.current.queueFor("cell-a").cursor).toBe(2);
    expect(utteranceUnderCursor(result.current.queueFor("cell-a"))?.id).toBe("u-1");
    expect(played).toEqual([]);
  });

  it("play after stepping back speaks the answer under the cursor", async () => {
    const second = unitsOf(SECOND);
    const { result } = renderHook(() => useSpeechHost());
    await threeAnswers("cell-a");

    await settle(() => result.current.onPrevious("cell-a"));
    expect(played).toEqual([]);

    // The play control is the half of the skim that makes a sound, and it
    // speaks what the cursor is on — from its first unit, because stepping
    // onto a whole answer never lands in the middle of one.
    await settle(() => result.current.onSpeak("cell-a"));
    expect(played).toEqual([`blob:${second[0]}`]);
  });

  it("next moves the cursor and speaks nothing", async () => {
    const { result } = renderHook(() => useSpeechHost());
    await threeAnswers("cell-a");

    await settle(() => result.current.onPrevious("cell-a"));
    await settle(() => result.current.onPrevious("cell-a"));
    expect(played).toEqual([]);

    // Symmetric now. The step comes back onto u-2 and stays quiet; the play
    // control is what speaks it, exactly as after a backward step.
    await settle(() => result.current.onNext("cell-a"));
    expect(result.current.queueFor("cell-a").cursor).toBe(1);
    expect(played).toEqual([]);
  });

  it("next speaks nothing on the ARMED cell either", async () => {
    const { result } = renderHook(() => useSpeechHost());
    await threeAnswers("cell-a");

    await settle(() => result.current.onPrevious("cell-a"));
    await settle(() => result.current.onPrevious("cell-a"));

    // The armed cell is the one route by which a press with no `speakUtterance`
    // in it can still make a sound — the autoplay effect watches the utterance
    // under the cursor, so a forward step looks like an arrival to it. An
    // `onNext` that merely dropped its own speak call would pass the test above
    // and still talk over the skim in the state Greg actually listens in.
    await settle(() => result.current.onArm("cell-a"));
    played.length = 0;

    await settle(() => result.current.onNext("cell-a"));

    expect(result.current.queueFor("cell-a").cursor).toBe(1);
    expect(played).toEqual([]);
  });

  it("next does not record the answer as played", async () => {
    const { result } = renderHook(() => useSpeechHost());
    await threeAnswers("cell-a");

    await settle(() => result.current.onPrevious("cell-a"));
    await settle(() => result.current.onNext("cell-a"));

    // `recordAutoplayed` is what keeps the armed cell quiet above, and it must
    // not be mistaken for "the user heard this": `heard` is where the unplayed
    // count comes from, and a walk that decremented it would hide the answers
    // the walk was looking for.
    expect([...result.current.heardFor("cell-a")]).toEqual([]);
    expect(result.current.stateFor("cell-a")).toBe("ready");
  });

  it("play speaks what a forward step navigated to", async () => {
    const second = unitsOf(SECOND);
    const { result } = renderHook(() => useSpeechHost());
    await threeAnswers("cell-a");

    await settle(() => result.current.onPrevious("cell-a"));
    await settle(() => result.current.onPrevious("cell-a"));
    await settle(() => result.current.onNext("cell-a"));
    expect(played).toEqual([]);

    // The other half of silencing a control: the answer it landed on is still
    // reachable, from its first unit.
    await settle(() => result.current.onSpeak("cell-a"));
    expect(played).toEqual([`blob:${second[0]}`]);
  });

  it("stepping back while busy still holds the body", async () => {
    const { result } = renderHook(() => useSpeechHost());
    await threeAnswers("cell-a");

    // The hold is taken by the BAR, right before it calls `onPrevious` — it is
    // a claim on the pane's body, not on playback, so silencing the press must
    // not touch it. This is the guard against "fixed" meaning "the answer
    // flashes up and the wave takes it back".
    holdAnswer("cell-a");
    await settle(() => result.current.onPrevious("cell-a"));

    expect(isAnswerHeld("cell-a")).toBe(true);
  });
});

/**
 * The wave as a POSITION, asserted where every surface meets.
 *
 * The row, the `Ctrl+Shift+Arrow` chord and the OS media keys all raise
 * `onPrevious` / `onNext`. The wave step therefore lives in the host, and this
 * is where it is pinned: a version that lived in the row alone left the chord
 * with no wave step at all — a no-op on the very cell a reload strands, and a
 * step PAST the newest answer wherever history exists.
 *
 * `noteAgentStarting` is how the wave is put on the body here: it is the one
 * trigger with no debounce, so the whole describe runs on real timers like the
 * rest of the file.
 */
describe("useSpeechHost — the wave is a position the transport stands on", () => {
  it("lands the first press back on the newest answer without moving the cursor", async () => {
    const { result } = renderHook(() => useSpeechHost());
    await threeAnswers("cell-a");
    noteAgentStarting("cell-a");
    expect(getAnswerWaiting("cell-a").waiting).toBe(true);

    await settle(() => result.current.onPrevious("cell-a"));

    // The hold is taken and the CURSOR HAS NOT MOVED. This cell has history on
    // purpose: without the wave step the press would hold and step in one go,
    // and u-3 — the answer the unread count is about — would be the single
    // answer a backward walk never lands on.
    expect(isAnswerHeld("cell-a")).toBe(true);
    expect(result.current.queueFor("cell-a").cursor).toBe(0);
    expect(played).toEqual([]);
  });

  it("walks into the history on the second press", async () => {
    const { result } = renderHook(() => useSpeechHost());
    await threeAnswers("cell-a");
    noteAgentStarting("cell-a");

    await settle(() => result.current.onPrevious("cell-a"));
    await settle(() => result.current.onPrevious("cell-a"));

    // Below the wave a backward press is an ordinary backward press.
    expect(result.current.queueFor("cell-a").cursor).toBe(1);
  });

  it("steps forward onto the wave without moving the cursor", async () => {
    const { result } = renderHook(() => useSpeechHost());
    await threeAnswers("cell-a");
    noteAgentStarting("cell-a");

    await settle(() => result.current.onPrevious("cell-a"));
    await settle(() => result.current.onNext("cell-a"));

    // The mirror: the hold is spent on the step that arrives at the wave, and
    // the cursor stays on the newest answer.
    expect(isAnswerHeld("cell-a")).toBe(false);
    expect(getAnswerWaiting("cell-a").waiting).toBe(true);
    expect(result.current.queueFor("cell-a").cursor).toBe(0);
  });

  it("steps into a backlog rather than onto the wave while answers are waiting", async () => {
    const { result } = renderHook(() => useSpeechHost());

    // A live run with an answer QUEUED behind it: the newest answer the cell
    // holds is `pending.at(-1)`, not `current`, so the wave sits above the
    // BACKLOG.
    await emitUtterance("cell-a", "u-1", FIRST);
    await settle(() => result.current.onSpeak("cell-a"));
    await emitUtterance("cell-a", "u-2", SECOND);
    expect(result.current.queueFor("cell-a").pending.map((u) => u.id)).toEqual(["u-2"]);
    played.length = 0;

    noteAgentStarting("cell-a");
    holdAnswer("cell-a");

    await settle(() => result.current.onNext("cell-a"));

    // A gate of "the cursor is on `current`" would have released here and moved
    // nothing — the hold spent without a step, and a second press needed to go
    // one place. The gate is "nothing ahead of the cursor".
    expect(result.current.queueFor("cell-a").current?.id).toBe("u-2");
    expect(isAnswerHeld("cell-a")).toBe(true);

    // ...and now the backlog is empty, so forward reaches the wave.
    await settle(() => result.current.onNext("cell-a"));
    expect(isAnswerHeld("cell-a")).toBe(false);
    expect(result.current.queueFor("cell-a").current?.id).toBe("u-2");
  });

  it("still spends the autoplay grant on both wave steps", async () => {
    const { result } = renderHook(() => useSpeechHost());
    await threeAnswers("cell-a");
    noteAgentStarting("cell-a");
    unlocks.length = 0;

    // The reloaded cell's WHOLE round trip: read the answer off the wave, then
    // go back to it. Neither press moves the cursor, and an implementation that
    // returned early before `unlock()` would leave a tab that has interacted
    // plenty still locked — the autoplay effect then ABSORBS the next answer,
    // marking it played, so arming afterwards is silent ever after.
    await settle(() => result.current.onPrevious("cell-a"));
    await settle(() => result.current.onNext("cell-a"));

    expect(unlocks.length).toBeGreaterThan(0);
    expect(played).toEqual([]);
  });
});

/**
 * The two ways the host can get the wave step WRONG once it owns it, both found
 * in review of the move rather than by the suite.
 *
 * They share a cause: a rule that used to be safe because the ROW enforced
 * something around it. Moving the rule to the host kept the rule and left the
 * enforcement behind — once in the shape of a read taken after the store had
 * already been moved, once in the shape of a press the row's `disabled`
 * attribute had made unreachable.
 */
describe("useSpeechHost — the wave step on the surfaces the row used to guard", () => {
  it("steps off a SEND-owned wave without skipping the newest answer", async () => {
    const { result } = renderHook(() => useSpeechHost());
    await threeAnswers("cell-a");

    // The ordinary path: a draft was sent, the body handed over to the wave,
    // and the user presses Previous to re-read the answer underneath it. The
    // agent is NOT busy — this wave is the send's.
    beginWaiting("cell-a", null);
    expect(getAnswerWaiting("cell-a").waiting).toBe(true);

    await settle(() => result.current.onPrevious("cell-a"));

    // `noteTransport` collapses a send-owned handover to `MARK_ONLY` the moment
    // it runs, so a `stepsOffTheWave` asked AFTER it answers no and the press
    // holds and steps — skipping u-3, the answer the wave was covering. That is
    // the very defect the wave step exists to prevent, on the most ordinary
    // path there is.
    expect(result.current.queueFor("cell-a").cursor).toBe(0);
  });

  it("takes no hold on a backward press the list refuses", async () => {
    const { result } = renderHook(() => useSpeechHost());

    // One answer, no history, and no wave: there is nowhere to step back to.
    // The row renders this press `disabled`; the chord and the OS media keys
    // ask no button, so the host is what has to refuse it.
    await emitUtterance("cell-a", "u-1", FIRST);
    played.length = 0;

    await settle(() => result.current.onPrevious("cell-a"));

    // A hold set here would never be cleared in this run, and `derive` answers
    // a standing hold with `SETTLED` — so the cell's pane would stop handing
    // over to the wave for the rest of the session.
    expect(isAnswerHeld("cell-a")).toBe(false);
    expect(result.current.queueFor("cell-a").cursor).toBe(0);
  });

  it("still takes the hold on a backward press that moves", async () => {
    const { result } = renderHook(() => useSpeechHost());
    await threeAnswers("cell-a");

    await settle(() => result.current.onPrevious("cell-a"));

    // The other half: moving the hold below the refusal must not lose it on
    // the presses that do land.
    expect(isAnswerHeld("cell-a")).toBe(true);
    expect(result.current.queueFor("cell-a").cursor).toBe(1);
  });
});
