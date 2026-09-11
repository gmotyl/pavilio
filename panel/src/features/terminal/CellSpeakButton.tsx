import { Volume2, VolumeX } from "lucide-react";
import type { CellSpeechState } from "../speech/types";

export interface CellSpeakButtonProps {
  sessionId: string;
  /** The cell's speech state, as `useUtteranceChannel().stateFor` reports it. */
  state: CellSpeechState;
  /**
   * Speak the cell's utterance. Raised for `unheard` and for `heard` alike — a
   * replay is the same intent, and costs nothing because the audio is still in
   * the synthesis LRU cache.
   */
  onSpeak: (sessionId: string) => void;
  /**
   * Stop playback of this cell. The control only raises the intent: the parent
   * must also mark the cell heard (`useUtteranceChannel().markHeard`), which is
   * Task 11's wiring, so a stopped cell lands in `heard` and not back in
   * `unheard`.
   */
  onStop: (sessionId: string) => void;
}

/**
 * The cell header's speak control. Purely presentational — it takes the state
 * and raises intents, and imports neither `useUtteranceChannel` nor
 * `useSpeechPlayer`, so the grid stays renderable without a speech host.
 *
 * Its four states borrow the activity LED's vocabulary rather than a palette of
 * their own: the same green, and the same `data-pulse` attribute that turns the
 * pulse off (see `.terminal-led` / `.terminal-speak` in index.css). `empty` is
 * the only inert one.
 */
export function CellSpeakButton({
  sessionId,
  state,
  onSpeak,
  onStop,
}: CellSpeakButtonProps) {
  const empty = state === "empty";
  const speaking = state === "speaking";
  const label = empty
    ? "Nothing to speak yet"
    : speaking
      ? "Stop speaking"
      : state === "heard"
        ? "Replay the last response"
        : "Speak the last response";

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={empty}
      data-testid={`terminal-cell-speak-${sessionId}`}
      data-speech={state}
      // Read by index.css exactly as the activity LED reads it: "1" runs the
      // attention pulse, "0" leaves the same green standing still.
      data-pulse={state === "unheard" ? "1" : "0"}
      className="terminal-speak p-1 rounded"
      // The header row is `draggable` and the cell root focuses on click, so
      // every gesture that could reach either has to stop here.
      draggable={false}
      onClick={(e) => {
        e.stopPropagation();
        // Belt and braces: a `disabled` button is not clickable in the first
        // place, and `empty` must do nothing even if it becomes one.
        if (empty) return;
        if (speaking) onStop(sessionId);
        else onSpeak(sessionId);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      // HTML5 drag is initiated from the nearest draggable ancestor, so only
      // cancelling `dragstart` stops it — the same guard the rename field and
      // the colour picker's hex field need.
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {empty ? <VolumeX size={11} /> : <Volume2 size={11} />}
    </button>
  );
}

export default CellSpeakButton;
