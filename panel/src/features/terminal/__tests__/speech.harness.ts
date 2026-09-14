import type { GridSpeech, SpeechUnit } from "../../speech/types";
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
