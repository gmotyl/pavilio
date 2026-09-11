/**
 * The shapes several modules agree on. Kept in one place because the server
 * route, the utterance channel, the preparation stage and the player all have to
 * mean the same thing by "utterance" and "unit".
 *
 * It also owns the **grid-facing** contract — {@link CellSpeechState} and
 * {@link GridSpeech} — and that is the whole reason the terminal feature may
 * name it. The two shapes used to be declared where they were consumed
 * (`features/terminal/TerminalLayoutGrid.tsx`), which made the two features
 * import each other: type-only, so it erased at build, but a cycle all the same,
 * and a contract owned by its consumer rather than by the feature that
 * implements it. Declaring both here makes the dependency run one way —
 * `terminal → speech/types`, `speech/* → speech/types` — and nothing under
 * `features/speech/` imports `features/terminal/` any more.
 */

/**
 * What a cell's speech control shows. Seven states, feeding **two independent
 * channels** on the control: colour says where the audio is, icon says what a
 * click does. Keeping them independent is the requirement, which is why
 * `speaking` and `stalled` are two states rather than one plus a flag — they
 * differ in colour and share an icon — and why `preparing` and `stalled` share
 * a colour while differing in everything else.
 *
 * - `empty`     — nothing has arrived. Muted and inert; a click does nothing.
 * - `preparing` — the utterance is here, its first unit is still synthesizing.
 *                 Red, and **inert**: there is nothing yet for a click to start.
 * - `ready`     — the first unit is in the synthesis cache. Green and pulsing,
 *                 and green carries the promise: a click starts with no wait.
 * - `speaking`  — a live run, making sound.
 * - `stalled`   — a live run blocked on synthesis, whether on its first unit or
 *                 on a mid-response underrun. Red, because more is still
 *                 coming, while the icon stays the pause icon: the run is
 *                 still the user's to hold.
 * - `paused`    — a run the user is holding. Outranks `speaking`, because the
 *                 player keeps naming a paused run as the speaking one: a
 *                 pause suspends the element rather than ending the ladder.
 * - `heard`     — the **final unit played to its end**, and nothing else. A
 *                 barge-in, a budget stop, a pause, a deliberate stop and a
 *                 systemic synthesis failure all leave the cell `ready`,
 *                 because something in it has still not been listened to.
 *
 * `heard` is a flag, never a deletion, so the utterance stays retrievable and a
 * click replays it. A session with nothing speakable in it is `empty` whatever
 * the player or the host says about it.
 */
export type CellSpeechState =
  | "empty"
  | "preparing"
  | "ready"
  | "speaking"
  | "stalled"
  | "paused"
  | "heard";

/**
 * The cell header's speech wiring, hoisted so one channel and one player serve
 * the whole panel. Supplied by `useSpeechHost`, which is where
 * `useUtteranceChannel` and `useSpeechPlayer` meet, and read by the terminal
 * surfaces through `SpeechHostProvider`.
 *
 * **Required** wherever it is passed, and deliberately so: when it was optional
 * a surface that forgot it left every cell `empty`, every callback a no-op, and
 * the whole suite green. The type is only half the guard — vitest transpiles
 * without typechecking — so `features/speech/__tests__/autoplay.integration.test.tsx`
 * mounts the real surfaces and reads the header attributes.
 */
export interface GridSpeech {
  stateFor: (sessionId: string) => CellSpeechState;
  /** The single armed session in this browser, or `null`. */
  armedSessionId: string | null;
  /** Speak the cell's utterance from the start — or replay a heard one. */
  onSpeak: (sessionId: string) => void;
  /**
   * Hold the live run at its current position. The run is not torn down and the
   * cell is NOT marked heard: it never reached its last unit.
   */
  onPause: (sessionId: string) => void;
  /**
   * Let a held run go on from where it was suspended, rather than restarting
   * the unit — which is what `onSpeak` would do.
   */
  onResume: (sessionId: string) => void;
  /**
   * Tear the run down. It does NOT mark the session heard: a run the user cut
   * short never reached its last unit, so the cell falls back to `ready`.
   *
   * No control raises this any more — the amendment replaced the stop control
   * with the pause above, and the only other way to end a run is to play a
   * different cell. It stays on the contract because it is the panel's one
   * programmatic "stop talking", and the host keeps it wired.
   */
  onStop: (sessionId: string) => void;
  onArm: (sessionId: string | null) => void;
}

/** One finished agent response, as the server hands it to the browser. */
export interface Utterance {
  /** Server-assigned; changes on every new utterance. */
  id: string;
  /** `PAVILIO_TERMINAL_ID` — the cell the response belongs to. */
  sessionId: string;
  /** Raw response markdown, exactly as the agent emitted it. */
  text: string;
  /** Epoch ms, server-assigned. */
  at: number;
}

/**
 * One chunk of speakable text: prepared, pronunciation-mapped and ready to hand
 * to synthesis as-is. Chunking is what makes playback start fast — the player
 * awaits only the first unit — so a unit is sized to be spoken, not to be read.
 */
export interface SpeechUnit {
  text: string;
  chars: number;
}

/**
 * One response, turned into something speakable. `units` is the whole response;
 * only the first `spokenUnits` of them fit the speech budget, and
 * `remainderParagraphs` is how many units were left unspoken — the number the
 * panel reports as "there is more to read".
 *
 * `language` is the language the pronunciation map was gated on. It is the
 * session's language, handed *to* preparation rather than detected from this one
 * response (see `prepare.ts`), so it is reported back to make the gate visible.
 */
export interface PreparedSpeech {
  /** May be empty — an utterance with nothing to say. */
  units: SpeechUnit[];
  language: "pl" | "en";
  /** Units inside the budget; the rest are the remainder. */
  spokenUnits: number;
  remainderParagraphs: number;
}
