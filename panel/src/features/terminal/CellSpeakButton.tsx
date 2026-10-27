import { Volume2 } from "lucide-react";
import type { CellSpeechState } from "../speech/types";

export interface CellSpeakButtonProps {
  sessionId: string;
  /** The cell's speech state, as `useUtteranceChannel().stateFor` reports it. */
  state: CellSpeechState;
  /**
   * Hold the live run where it is. It does NOT mark the cell heard: a run the
   * user is holding never reached its last unit. Resume, replay and starting an
   * answer belong to the speech control bar's transport.
   */
  onPause: (sessionId: string) => void;
}

/** The one label: whatever the run is waiting on, a click holds it. */
const LABEL = "Pause speaking";

/**
 * Whether a cell's state is asking for something — the fact the speech control
 * bar's play button encodes as `data-pulse` for `index.css`.
 *
 * It lives here because the header control used to read it too. The header
 * control now exists only while the cell speaks and always pulses (see
 * `CellSpeakButton` below), so the bar is the one reader left; the rule itself
 * is unchanged.
 *
 * Only `ready` pulses: `speaking` and `paused` are also green, but a run
 * already in hand is not asking, and `heard` has been answered.
 */
export function speechPulse(state: CellSpeechState): "1" | "0" {
  return state === "ready" ? "1" : "0";
}

/**
 * The cell header's speak control: a pulsing speaker that exists ONLY while the
 * cell is speaking (`speaking`, or `stalled` on its next unit). Every other
 * state renders nothing — no placeholder, so the rest of the header's controls
 * keep their order without a gap (mockup S). Resume and replay stay in
 * `SpeechControlBar`.
 *
 * Purely presentational — it takes the state and raises one intent, and
 * imports neither `useUtteranceChannel` nor `useSpeechPlayer`, so the grid
 * stays renderable without a speech host. `data-speech` still carries the
 * state for the stylesheet: green under a playing run, red under a stalled
 * one. The pulse is the activity LED's (see `.terminal-speak` in index.css)
 * and stops under `prefers-reduced-motion`.
 */
export function CellSpeakButton({ sessionId, state, onPause }: CellSpeakButtonProps) {
  if (state !== "speaking" && state !== "stalled") return null;

  return (
    <button
      type="button"
      title={LABEL}
      aria-label={LABEL}
      data-testid={`terminal-cell-speak-${sessionId}`}
      data-speech={state}
      // Read by index.css exactly as the activity LED reads it: the control is
      // only ever here while something is talking, so it always pulses.
      data-pulse="1"
      className="terminal-speak p-1 rounded"
      // The header row is `draggable` and the cell root focuses on click, so
      // every gesture that could reach either has to stop here.
      draggable={false}
      onClick={(e) => {
        e.stopPropagation();
        onPause(sessionId);
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
      <Volume2 size={11} />
    </button>
  );
}

export default CellSpeakButton;
