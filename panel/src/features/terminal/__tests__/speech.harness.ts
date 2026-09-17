import type { GridSpeech, SpeechUnit } from "../../speech/types";
import type { SpeechHost } from "../../speech/useSpeechHost";
import { emptyUtteranceQueue } from "../../speech/utteranceQueue";

/**
 * A speech host that does nothing, for the suites whose subject is not speech.
 *
 * `speech` is a REQUIRED prop on `TerminalLayoutGrid` and `TerminalsSurface` on
 * purpose — when it was optional a surface could forget it and leave every cell
 * `empty` with the whole suite green. These suites still have to pass
 * something, and passing this rather than a partial mock keeps them honest
 * about what they are not testing: the real wiring is proved by
 * `features/speech/__tests__/autoplay.integration.test.tsx`, which mounts the
 * surfaces instead of hand-building this object.
 */
/** A snapshot read through `useSyncExternalStore` must be referentially stable
 *  between notifications, so these two are shared constants rather than fresh
 *  literals per call — a new `Map` each time is an infinite render loop. */
const NO_UNITS: readonly SpeechUnit[] = Object.freeze([]);
const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();

export const INERT_SPEECH: GridSpeech = {
  stateFor: () => "empty",
  queueFor: () => emptyUtteranceQueue,
  armedSessionId: null,
  onSpeak: () => {},
  onPause: () => {},
  onResume: () => {},
  onStop: () => {},
  onPrevious: () => {},
  onNext: () => {},
  onArm: () => {},
  unitsFor: () => NO_UNITS,
  subscribeProgress: () => () => {},
  progressFor: () => null,
  unitDurationsFor: () => NO_DURATIONS,
  onJumpToUnit: () => {},
  onSeekWithinUnit: () => {},
};

/**
 * The same inert host, but as a `SpeechHost` — what a `vi.mock` of
 * `useSpeechHost` has to return so a real `SpeechHostProvider` can be mounted
 * above the subject.
 *
 * `SpeechHost` is `GridSpeech` plus what the document-wide media-session
 * transport reads, and the provider mounts that transport, so the four extra
 * members are not optional. Every suite that mounts the provider used to spell
 * this object out itself; one definition means a new member of `SpeechHost`
 * breaks in one place instead of quietly leaving each copy a `GridSpeech`
 * pretending to be a host.
 *
 * Suites that need a live reading — a `stateFor` that a test can swap — spread
 * this and override that one member; the rest stays inert.
 */
export const INERT_SPEECH_HOST: SpeechHost = {
  ...INERT_SPEECH,
  speakingSessionId: null,
  pausedSessionId: null,
  onSeekBackward: () => {},
  preparingSessionIds: new Set<string>(),
};
