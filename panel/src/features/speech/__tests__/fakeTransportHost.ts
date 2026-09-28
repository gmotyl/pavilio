/**
 * The hold half of `useSpeechHost`'s transport, for suites that mount a SURFACE
 * against a mocked host.
 *
 * Those suites exist to assert what the pane's body and the row's controls show
 * — not what the queue does — so they hand the surface a `GridSpeech` of spies.
 * That was fine while the row took the hold itself. It no longer does: the hold
 * and the wave step belong to `onPrevious` / `onNext` in the host, because the
 * `Ctrl+Shift+Arrow` chord and the OS media keys raise the same callbacks and a
 * rule kept in the row would be a second transport.
 *
 * So a spy that does nothing is no longer a faithful stand-in, and a surface
 * test written against one would assert a hold that production never takes.
 * These two functions are what a mocked host must do to be one.
 *
 * They deliberately do **not** move the cursor: a mocked host has a static
 * queue, and pretending otherwise would put a second reducer in the tests. The
 * cursor's own behaviour is pinned against the real host, in
 * `useSpeechHost.previousSilent.test.ts`.
 *
 * The rules themselves are imported rather than restated — see `waveStep.ts` on
 * why there is exactly one definition of each.
 */
import { holdAnswer, releaseAnswer } from "../../terminal/answerWaiting";
import { stepsOntoTheWave } from "../waveStep";

/** What the host's `onPrevious` does to the hold: takes it, wherever it lands. */
export const fakeOnPrevious = (sessionId: string): void => {
  holdAnswer(sessionId);
};

/** What the host's `onNext` does to the hold: spends it on the step onto the wave. */
export const fakeOnNext = (
  sessionId: string,
  held: boolean,
  cursor: number,
  pending: number,
): void => {
  if (stepsOntoTheWave(held, cursor, pending)) releaseAnswer(sessionId);
};
