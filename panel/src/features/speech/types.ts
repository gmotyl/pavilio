/**
 * The shapes several speech modules agree on. Kept in one place because the
 * server route, the utterance channel, the preparation stage and the player all
 * have to mean the same thing by "utterance" and "unit".
 */

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
