import type { GridSpeech } from "../TerminalLayoutGrid";

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
export const INERT_SPEECH: GridSpeech = {
  stateFor: () => "empty",
  armedSessionId: null,
  onSpeak: () => {},
  onStop: () => {},
  onArm: () => {},
};
