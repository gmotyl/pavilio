/**
 * Navigation, seen from the host: jumping to a unit, stepping back and forth
 * between answers without playing (and what a silent step back still
 * unlocks), and a catch-up after a reconnect disturbing nothing the listener
 * is on. Every suite drives the real channel and the real player through
 * `useSpeechHost` on `speech.harness.ts`.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  drain,
  emitUtterance,
  endCurrentUnit,
  played,
  resetSpeechHarness,
  response,
  settle,
  synthMock,
  unitsOf,
  unlocks,
  useWebSocketMock,
} from "./speech.harness";

vi.mock("../synth", () => synthMock());
vi.mock("../../realtime/useWebSocket", () => useWebSocketMock());

/**
 * The neutral reconnect frame is subscribed to directly rather than read off
 * `lastMessage` — see the channel — so this stands in for that subscription,
 * which would otherwise open a socket.
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

import {
  __resetAnswerWaitingForTests,
  beginWaiting,
  getAnswerWaiting,
  holdAnswer,
  isAnswerHeld,
  noteAgentStarting,
} from "../../terminal/answerWaiting";
import { preferences } from "../../../preferences/declarations";
import { storageKey } from "../../../preferences/types";
import { REALTIME_RECONNECT_FRAME } from "../../realtime/channel";
import type { Utterance } from "../types";
import { useSpeechHost } from "../useSpeechHost";
import { voiceForSession } from "../../terminal/sessionVoice";
import { storeAnswerWaiting } from "./answerWaitingPort";
import { utteranceUnderCursor } from "../utteranceQueue";

/**
 * Speech modes name LIVE SESSIONS, so they are `portable: false` and live in
 * `localStorage` — which is exactly what lets a reloaded tab come up in
 * autoplay with no gesture behind it.
 */
const MODES_KEY = storageKey(preferences.speechModes);

const FIRST = response(2, "First");
const SECOND = response(2, "Second");
const THIRD = response(2, "Third");
const RECOVERED = response(2, "Recovered");

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
  resetSpeechHarness();
  __resetAnswerWaitingForTests();
});


/**
 * Jumping to a unit.
 *
 * `SpeechPlayer.jumpToUnit` is deliberately a **no-op for a cell that has never
 * spoken in this tab**: the player learns a session's units from `play`, and
 * nothing else ever teaches it. That is correct for the player and useless for
 * the scrubber, whose segments exist from the moment an utterance ARRIVES —
 * before any click, and therefore before the player has ever heard of the cell.
 * A segment that silently does nothing is the worst outcome there is, so the
 * host routes a jump through its own speak path, which knows the utterance, its
 * prepared units and the run bookkeeping. These two tests are what keep it
 * there.
 */
describe("useSpeechHost jumps", () => {
  it("a segment click on a cell that has never spoken starts it at that unit", async () => {
    const units = unitsOf(response(4));
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

    // Arrived and warmed, never played: `player.jumpToUnit` would return here
    // without a sound, because `unitsRef` only ever learns from `play`.
    await emitUtterance("cell-a", "u-1", response(4));
    expect(played).toEqual([]);

    await settle(() => result.current.onJumpToUnit("cell-a", 2));

    expect(played).toEqual([`blob:${units[2]}`]);
  });

  it("jumping inside a live run does not mark the cell heard", async () => {
    const units = unitsOf(response(4));
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

    await emitUtterance("cell-a", "u-1", response(4));
    await settle(() => result.current.onSpeak("cell-a"));
    expect(played).toEqual([`blob:${units[0]}`]);

    // The run the jump supersedes never reached its last unit, so the cell must
    // not land on `heard` — the trap `speakUtterance`'s stamp exists to avoid.
    await settle(() => result.current.onJumpToUnit("cell-a", 3));
    expect(played[played.length - 1]).toBe(`blob:${units[3]}`);

    // Asserted only once the cell has LEFT `speaking`. `stateFor` ranks a live
    // run above the heard flag, so a bar routed straight at `player.jumpToUnit`
    // — which reaches `play` behind the host's back, leaves the superseded run
    // stamped `pending` and therefore marks the cell HEARD — still reads
    // `speaking` at this point and passes anyway. Stopping takes the mask off:
    // a deliberate stop is `ready`, so anything else here is a stamp that
    // should never have been made.
    await settle(() => result.current.onStop("cell-a"));
    expect(result.current.stateFor("cell-a")).toBe("ready");

    // And the run a jump starts is a real one: its last unit ending is what
    // marks the cell heard.
    await settle(() => result.current.onJumpToUnit("cell-a", 3));
    await endCurrentUnit();
    expect(result.current.stateFor("cell-a")).toBe("heard");
  });
});

/**
 * The one thing a SILENT step back still owes: the autoplay permission.
 *
 * `onPrevious` makes no sound any more (the stepping-back describe below is the
 * pin on that), and it would read as dead weight that it still calls
 * `unlock()`. It is not. Deleting that line leaves every other speech and
 * terminal test green, and still loses a user their next answer.
 *
 * The chain is three facts that only bite together:
 *
 * 1. the armed cell is restored from `localStorage` at mount (DECISION 12), so
 *    a reloaded tab can be ARMED while no gesture has yet reached the audio
 *    element — armed and locked at the same time, which no click can produce;
 * 2. the autoplay effect does not merely DEFER an arrival in that state, it
 *    ABSORBS it: `autoplayedRef` is set to the utterance and the cell stays
 *    quiet about it ever after. Nothing replays an absorbed answer;
 * 3. `onNewestAnswer` — the cursor coming home when an arrival releases the
 *    pane's hold — deliberately carries no `unlock` of its own, because it is
 *    not a gesture and must not start audio.
 *
 * So for a user whose only interaction was skimming the backlog, the press
 * they made is the ONLY gesture in the whole sequence, and the next answer is
 * absorbed in silence without it. The browser hands the permission out from
 * inside a gesture handler and attaches it to the element for good; spending it
 * on a press that makes no sound costs nothing, because `unlock` is guarded to
 * run once per element and that once happens on a source-less element on
 * purpose.
 *
 * This file therefore asserts the LATER arrival speaks — not that `unlock` was
 * called, which would pin the line rather than the reason for it.
 */
describe("useSpeechHost — what a silent step back still unlocks", () => {
  it("stepping back unlocks audio, so a later arrival on the armed cell still speaks", async () => {
    // The tab comes up ARMED with no gesture behind it — the state only a
    // reload can produce, and the one this whole chain lives in.
    localStorage.setItem(MODES_KEY, '{"cell-a":"autoplay"}');

    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );
    expect(result.current.speechModeOf("cell-a")).toBe("autoplay");

    // Two answers land on the armed-but-locked cell. Both are ABSORBED, not
    // queued: the effect records each as autoplayed and moves on, so nothing
    // in the app will ever come back for them.
    await emitUtterance("cell-a", "u-1", FIRST);
    await emitUtterance("cell-a", "u-2", SECOND);
    expect(played).toEqual([]);

    // The user's first and only interaction: a step back to read the older
    // answer. It makes no sound — and the press is where the browser's
    // autoplay permission is spent.
    await settle(() => result.current.onPrevious("cell-a"));
    expect(result.current.queueFor("cell-a").cursor).toBe(1);
    expect(played).toEqual([]);

    // A third answer arrives while they are still reading. The reducer keeps
    // the cursor on the utterance they are on, so this is silent too and
    // nothing has been absorbed yet.
    await emitUtterance("cell-a", "u-3", THIRD);
    expect(played).toEqual([]);

    // The pane's hold is released by that arrival and it brings the cursor
    // home. `onNewestAnswer` carries NO unlock of its own by design, so the
    // press above is the only gesture this tab has ever made.
    await settle(() => result.current.onNewestAnswer("cell-a"));

    // ...and the answer speaks. Without the `unlock()` in `onPrevious` the
    // cell is still locked here, the effect absorbs this arrival exactly as it
    // absorbed the first two, and the user hears nothing — ever.
    expect(played).toEqual([`blob:${unitsOf(THIRD)[0]}`]);
  });
});

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
 * `onNext` is now the same, and these describes cover both directions. The
 * asymmetry used to be pinned here as deliberate — forward was "the way into
 * what is waiting and the gesture that releases the pane's hold". It is no
 * longer only that: the unread count says an answer is waiting and the play
 * control speaks it, while forward is also the single way back onto the wave,
 * which made the gesture that RETURNS to the waiting state the loudest control
 * on the row.
 *
 * So the rule is one sentence in both directions — navigation moves the cursor,
 * and audio starts from the arm switch or the play button. Arming still governs
 * ARRIVALS, which is what it is for; it does not turn a step into a playback,
 * any more than it does for a backward one.
 */
describe("useSpeechHost — stepping back navigates without playing", () => {
  it("previous walks the cursor back one answer per press, in silence, and hears nothing", async () => {
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );
    await threeAnswers("cell-a");

    await settle(() => result.current.onPrevious("cell-a"));
    expect(result.current.queueFor("cell-a").cursor).toBe(1);
    expect(utteranceUnderCursor(result.current.queueFor("cell-a"))?.id).toBe("u-2");

    // And the second press walks the list rather than re-reading `previous[0]`.
    await settle(() => result.current.onPrevious("cell-a"));
    expect(result.current.queueFor("cell-a").cursor).toBe(2);
    expect(utteranceUnderCursor(result.current.queueFor("cell-a"))?.id).toBe("u-1");

    // The oldest answer the cell holds: the press is refused rather than
    // falling off the front of the list, and a refused press is still silent.
    await settle(() => result.current.onPrevious("cell-a"));
    expect(result.current.queueFor("cell-a").cursor).toBe(2);
    expect(utteranceUnderCursor(result.current.queueFor("cell-a"))?.id).toBe("u-1");

    // Not "did not speak the wrong answer" — did not speak at all. The whole
    // point of the skim is that the backlog stays quiet while it is walked.
    expect(played).toEqual([]);
    expect(result.current.speakingSessionId).toBeNull();

    // `heard` is what the unplayed count is derived from, so a silent step has
    // to leave it exactly where it was — landing on an answer is not listening
    // to it, and a skim that decremented the count would hide the very answers
    // it was looking for.
    expect([...result.current.heardFor("cell-a")]).toEqual([]);
    expect(result.current.stateFor("cell-a")).toBe("ready");
  });

  it("next moves the cursor forward, in silence, and hears nothing", async () => {
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );
    await threeAnswers("cell-a");

    await settle(() => result.current.onPrevious("cell-a"));
    await settle(() => result.current.onPrevious("cell-a"));
    expect(played).toEqual([]);

    // Symmetric now. The step comes back onto u-2 and stays quiet; the play
    // control is what speaks it, exactly as after a backward step.
    await settle(() => result.current.onNext("cell-a"));
    expect(result.current.queueFor("cell-a").cursor).toBe(1);
    expect(played).toEqual([]);

    // `recordAutoplayed` is what keeps the armed cell quiet below, and it must
    // not be mistaken for "the user heard this": `heard` is where the unplayed
    // count comes from, and a walk that decremented it would hide the answers
    // the walk was looking for.
    expect([...result.current.heardFor("cell-a")]).toEqual([]);
    expect(result.current.stateFor("cell-a")).toBe("ready");
  });

  // Arming is the state Greg actually listens in, and it is the one route by
  // which a press with no `speakUtterance` in it can still make a sound: the
  // autoplay effect watches the utterance UNDER THE CURSOR, so a step changes
  // what it sees — a forward one looks like an arrival to it — and it starts
  // that answer on its own. A press that merely dropped its own speak call
  // would pass every other test here and still talk over the skim.
  it.each([
    { press: "onPrevious", stepsBeforeArming: 0 },
    { press: "onNext", stepsBeforeArming: 2 },
  ] as const)(
    "$press speaks nothing on the ARMED cell either",
    async ({ press, stepsBeforeArming }) => {
      const { result } = renderHook(() =>
        useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
      );
      await threeAnswers("cell-a");
      for (let i = 0; i < stepsBeforeArming; i += 1) {
        await settle(() => result.current.onPrevious("cell-a"));
      }

      await settle(() => {
        result.current.cycleSpeechMode("cell-a"); // armed
        result.current.cycleSpeechMode("cell-a"); // autoplay
      });
      played.length = 0;

      await settle(() => result.current[press]("cell-a"));

      expect(result.current.queueFor("cell-a").cursor).toBe(1);
      expect(played).toEqual([]);
    },
  );

  // The other half of silencing a control: the answer it landed on is still
  // reachable — the play control speaks what the cursor is on, from its first
  // unit, because stepping onto a whole answer never lands in the middle of one.
  it.each([
    { step: "a backward step", presses: ["onPrevious"] },
    { step: "a forward step", presses: ["onPrevious", "onPrevious", "onNext"] },
  ] as const)("play speaks what $step navigated to", async ({ presses }) => {
    const second = unitsOf(SECOND);
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );
    await threeAnswers("cell-a");

    for (const press of presses) await settle(() => result.current[press]("cell-a"));
    expect(played).toEqual([]);

    await settle(() => result.current.onSpeak("cell-a"));
    expect(played).toEqual([`blob:${second[0]}`]);
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
  it("steps off the wave and back onto it without moving the cursor, and spends the autoplay grant", async () => {
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );
    await threeAnswers("cell-a");
    noteAgentStarting("cell-a");
    expect(getAnswerWaiting("cell-a").waiting).toBe(true);
    unlocks.length = 0;

    await settle(() => result.current.onPrevious("cell-a"));

    // The hold is taken and the CURSOR HAS NOT MOVED. This cell has history on
    // purpose: without the wave step the press would hold and step in one go,
    // and u-3 — the answer the unread count is about — would be the single
    // answer a backward walk never lands on.
    expect(isAnswerHeld("cell-a")).toBe(true);
    expect(result.current.queueFor("cell-a").cursor).toBe(0);
    expect(played).toEqual([]);

    await settle(() => result.current.onNext("cell-a"));

    // The mirror: the hold is spent on the step that arrives at the wave, and
    // the cursor stays on the newest answer.
    expect(isAnswerHeld("cell-a")).toBe(false);
    expect(getAnswerWaiting("cell-a").waiting).toBe(true);
    expect(result.current.queueFor("cell-a").cursor).toBe(0);

    // The reloaded cell's WHOLE round trip: read the answer off the wave, then
    // go back to it. Neither press moves the cursor, and an implementation that
    // returned early before `unlock()` would leave a tab that has interacted
    // plenty still locked — the autoplay effect then ABSORBS the next answer,
    // marking it played, so arming afterwards is silent ever after.
    expect(unlocks.length).toBeGreaterThan(0);
    expect(played).toEqual([]);
  });

  it("walks into the history on the second press", async () => {
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );
    await threeAnswers("cell-a");
    noteAgentStarting("cell-a");

    await settle(() => result.current.onPrevious("cell-a"));
    await settle(() => result.current.onPrevious("cell-a"));

    // Below the wave a backward press is an ordinary backward press.
    expect(result.current.queueFor("cell-a").cursor).toBe(1);
  });

  it("steps into a backlog rather than onto the wave while answers are waiting", async () => {
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

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
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );
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

  it.each([
    {
      // One answer, no history, and no wave: there is nowhere to step back to.
      // The row renders this press `disabled`; the chord and the OS media keys
      // ask no button, so the host is what has to refuse it. A hold set here
      // would never be cleared in this run, and `derive` answers a standing
      // hold with `SETTLED` — so the cell's pane would stop handing over to the
      // wave for the rest of the session.
      press: "takes no hold on a backward press the list refuses",
      answers: [FIRST],
      preHeld: false,
      held: false,
      cursor: 0,
    },
    {
      // The other half: moving the hold below the refusal must not lose it on
      // the presses that do land.
      press: "still takes the hold on a backward press that moves",
      answers: [FIRST, SECOND, THIRD],
      preHeld: false,
      held: true,
      cursor: 1,
    },
    {
      // The hold is taken by the BAR, right before it calls `onPrevious` — it
      // is a claim on the pane's body, not on playback, so silencing the press
      // must not touch it. This is the guard against "fixed" meaning "the
      // answer flashes up and the wave takes it back".
      press: "keeps the bar's hold on a backward press that moves",
      answers: [FIRST, SECOND, THIRD],
      preHeld: true,
      held: true,
      cursor: 1,
    },
  ])("$press", async ({ answers, preHeld, held, cursor }) => {
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );
    for (const [i, text] of answers.entries()) {
      await emitUtterance("cell-a", `u-${i + 1}`, text);
    }
    played.length = 0;

    if (preHeld) holdAnswer("cell-a");
    await settle(() => result.current.onPrevious("cell-a"));

    expect(isAnswerHeld("cell-a")).toBe(held);
    expect(result.current.queueFor("cell-a").cursor).toBe(cursor);
  });
});

/**
 * The server's clock, monotonic across both arrival paths, so "newer" is a
 * fact about `at` rather than about the order the test happened to write.
 */
let clock = 1_000;
const nextAt = (): number => {
  clock += 1_000;
  return clock;
};

function serveLatest(utterances: Utterance[]): void {
  global.fetch = vi.fn(
    async () => ({ ok: true, json: async () => ({ utterances }) }) as Response,
  ) as unknown as typeof fetch;
}

/**
 * A return: the socket comes back, the channel re-asks `/latest` and the panel
 * server hands back the one answer it retained for the session.
 */
async function caughtUp(sessionId: string, id: string, text: string): Promise<void> {
  serveLatest([{ id, sessionId, text, at: nextAt() }]);
  await act(async () => {
    for (const listener of [...realtimeListeners]) listener({ ...REALTIME_RECONNECT_FRAME });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  // A further macrotask plus a drain, so the fetch, its `json()`, the commit
  // effect and everything the autoplay effect starts have all settled.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await drain();
  });
}

/**
 * A recovered answer is SHOWN, never spoken — and it must not disturb the one
 * the user is already listening to.
 *
 * The channel calls `recordAutoplayed` for every utterance a catch-up takes up,
 * so an armed cell does not start talking on a return that raised no gesture
 * (ADR 0017). But a catch-up does not necessarily land under the cursor: a
 * speaking or paused cell queues it behind the live run, and a cursor parked in
 * the history stays on the answer the listener stepped back to. The record is
 * therefore about an utterance the autoplay effect is NOT watching, while the
 * effect's guard is about the one under the cursor — so a record that can only
 * remember one utterance answers the wrong question and the armed cell speaks.
 *
 * Both failures are silent in every other suite: the channel's own tests cannot
 * see `autoplayedRef`, and the host's cannot raise a catch-up. This file is the
 * only place the two meet.
 */
describe("useSpeechHost — a catch-up disturbs nothing the listener is on", () => {
  beforeEach(() => {
    realtimeListeners.clear();
    clock = 1_000;
    serveLatest([]);
  });

  it("does not restart the run the user is listening to", async () => {
    const first = unitsOf(FIRST);
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

    await settle(() => {
      result.current.cycleSpeechMode("cell-a"); // armed
      result.current.cycleSpeechMode("cell-a"); // autoplay
    });
    await emitUtterance("cell-a", "u-1", FIRST, nextAt());
    expect(played).toEqual([`blob:${first[0]}`]);
    expect(result.current.stateFor("cell-a")).toBe("speaking");

    // An `online` lands in the middle of the run. The recovered answer is not
    // the one under the cursor, so recording it against a record that holds one
    // utterance loses the live run's own — and the effect, which re-runs on
    // every arrival, then starts u-1 again from unit 0.
    await caughtUp("cell-a", "u-2", SECOND);

    expect(played).toEqual([`blob:${first[0]}`]);
    const queue = result.current.queueFor("cell-a");
    expect(queue.current?.id).toBe("u-1");
    expect(queue.pending.map((waiting) => waiting.id)).toEqual(["u-2"]);
    expect(result.current.stateFor("cell-a")).toBe("speaking");
  });

  it("leaves a cursor parked in the history where the listener put it", async () => {
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

    await emitUtterance("cell-a", "u-1", FIRST, nextAt());
    await emitUtterance("cell-a", "u-2", SECOND, nextAt());
    await emitUtterance("cell-a", "u-3", THIRD, nextAt());
    await settle(() => {
      result.current.cycleSpeechMode("cell-a"); // armed
      result.current.cycleSpeechMode("cell-a"); // autoplay
    });
    played.length = 0;

    // The skim: back onto u-2, silently, which is what `onPrevious`'s own
    // record buys. A catch-up that overwrites that record undoes it.
    await settle(() => result.current.onPrevious("cell-a"));
    expect(utteranceUnderCursor(result.current.queueFor("cell-a"))?.id).toBe("u-2");
    expect(played).toEqual([]);

    await caughtUp("cell-a", "u-4", RECOVERED);

    expect(played).toEqual([]);
    const queue = result.current.queueFor("cell-a");
    expect(queue.current?.id).toBe("u-4");
    // The cursor followed its own answer down the list rather than moving.
    expect(utteranceUnderCursor(queue)?.id).toBe("u-2");
  });

  it("a recovered answer reached by the transport is still not spoken", async () => {
    const first = unitsOf(FIRST);
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

    await settle(() => {
      result.current.cycleSpeechMode("cell-a"); // armed
      result.current.cycleSpeechMode("cell-a"); // autoplay
    });
    await emitUtterance("cell-a", "u-1", FIRST, nextAt());
    await caughtUp("cell-a", "u-2", SECOND);

    // The run plays out and the queue advances onto the recovered answer. The
    // armed cell auto-advances into a LIVE arrival — the user was there for the
    // broadcast — but a recovered one is shown and waits for the play control,
    // which is the whole of ADR 0017's audio clause.
    await endCurrentUnit();
    await endCurrentUnit();

    expect(result.current.queueFor("cell-a").current?.id).toBe("u-2");
    expect(played).toEqual([`blob:${first[0]}`, `blob:${first[1]}`]);
    expect(result.current.stateFor("cell-a")).toBe("ready");
  });
});
