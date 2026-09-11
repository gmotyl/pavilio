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
 * What a cell's speech control shows. Only `empty` is inert: `heard` is a flag,
 * never a deletion, so the utterance stays retrievable and a click replays it.
 * A session with nothing speakable in it can never be reported as `speaking`,
 * whatever the player says.
 */
export type CellSpeechState = "empty" | "unheard" | "heard" | "speaking";

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
  onSpeak: (sessionId: string) => void;
  /** Stop playback. The host must also mark the session heard. */
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
