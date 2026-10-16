/**
 * The terminal's real answer-waiting store, as the port `useSpeechHost` takes.
 *
 * The host no longer imports the store; whoever mounts it hands it in. Suites
 * that pin the host's behaviour against the real store — the hold, the wave
 * step, the send wait — mount it with this, so they keep exercising exactly
 * what production wires. One module-level object, so its identity is stable
 * across renders the way the provider's is.
 */
import {
  getAnswerWaiting,
  holdAnswer,
  isAnswerHeld,
  noteTransport,
  releaseAnswer,
} from "../../terminal/answerWaiting";
import type { AnswerWaitingPort } from "../useSpeechHost";

export const storeAnswerWaiting: AnswerWaitingPort = {
  get: getAnswerWaiting,
  hold: holdAnswer,
  release: releaseAnswer,
  noteTransport,
  isHeld: isAnswerHeld,
};
