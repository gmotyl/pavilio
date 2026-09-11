import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import type { ReactElement } from "react";
import type { CellSpeechState } from "../speech/types";

export interface CellSpeakButtonProps {
  sessionId: string;
  /** The cell's speech state, as `useUtteranceChannel().stateFor` reports it. */
  state: CellSpeechState;
  /**
   * Speak the cell's utterance from its start. Raised for `ready` and for
   * `heard` alike — a replay is the same intent, and costs nothing because the
   * audio is still in the synthesis LRU cache.
   */
  onSpeak: (sessionId: string) => void;
  /**
   * Hold the live run where it is. It does NOT mark the cell heard: a run the
   * user is holding never reached its last unit. There is no stop control —
   * clicking a speaking cell pauses it, and that is the only way to interrupt
   * one short of playing another cell.
   */
  onPause: (sessionId: string) => void;
  /**
   * Let a held run go on from exactly where it was suspended. Emphatically not
   * `onSpeak`, which would restart the utterance from its first unit and throw
   * away the position the pause exists to keep.
   */
  onResume: (sessionId: string) => void;
}

/** What a click does, independently of where the audio is. */
type SpeakIcon = "mute" | "speaker" | "pause" | "play";

/**
 * The two channels, in one table. Colour is NOT in here: it is keyed off
 * `data-speech` in the stylesheet, which is exactly what keeps the two
 * independent — `speaking` and `stalled` differ in colour and share an icon,
 * `ready` and `heard` share an icon and differ in colour, and neither channel
 * can be derived from the other.
 *
 * The label is per state rather than per icon: two states that raise the same
 * intent still have different reasons to, and a screen-reader user gets the
 * colour channel from nowhere else.
 */
const CHANNELS: Record<CellSpeechState, { icon: SpeakIcon; label: string }> = {
  empty: { icon: "mute", label: "Nothing to speak yet" },
  preparing: { icon: "speaker", label: "Preparing the audio…" },
  ready: { icon: "speaker", label: "Speak the last response" },
  speaking: { icon: "pause", label: "Pause speaking" },
  stalled: { icon: "pause", label: "Pause — waiting for the voice" },
  paused: { icon: "play", label: "Resume speaking" },
  heard: { icon: "speaker", label: "Replay the last response" },
};

const ICONS: Record<SpeakIcon, ReactElement> = {
  mute: <VolumeX size={11} />,
  speaker: <Volume2 size={11} />,
  pause: <Pause size={11} />,
  play: <Play size={11} />,
};

/**
 * The cell header's speak control. Purely presentational — it takes the state
 * and raises intents, and imports neither `useUtteranceChannel` nor
 * `useSpeechPlayer`, so the grid stays renderable without a speech host.
 *
 * It carries **two independent channels**: `data-speech` is the colour channel,
 * which the stylesheet keys the red, the green and the dimmed yellow off, and
 * `data-icon` is the icon channel, which says what a click does. Neither
 * encodes the other. The green and the `data-pulse` switch are still borrowed
 * from the activity LED rather than invented here (see `.terminal-led` /
 * `.terminal-speak` in index.css), and only `ready` pulses: it is the one state
 * that is asking for something.
 *
 * Two states raise nothing. `empty` is `disabled`; `preparing` is not, because
 * a disabled button cannot be hovered for its tooltip and the cell is about to
 * become clickable anyway — it is inert through `aria-disabled` plus the guard
 * in the handler.
 */
export function CellSpeakButton({
  sessionId,
  state,
  onSpeak,
  onPause,
  onResume,
}: CellSpeakButtonProps) {
  const { icon, label } = CHANNELS[state];
  const empty = state === "empty";
  const inert = empty || state === "preparing";

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={empty}
      aria-disabled={inert || undefined}
      data-testid={`terminal-cell-speak-${sessionId}`}
      data-speech={state}
      data-icon={icon}
      // Read by index.css exactly as the activity LED reads it: "1" runs the
      // attention pulse, "0" leaves the colour standing still.
      data-pulse={state === "ready" ? "1" : "0"}
      className="terminal-speak p-1 rounded"
      // The header row is `draggable` and the cell root focuses on click, so
      // every gesture that could reach either has to stop here.
      draggable={false}
      onClick={(e) => {
        e.stopPropagation();
        // Belt and braces for `empty`, which is `disabled` and so not clickable
        // in the first place; the load-bearing half is `preparing`, which is.
        if (inert) return;
        if (icon === "pause") onPause(sessionId);
        else if (icon === "play") onResume(sessionId);
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
      {ICONS[icon]}
    </button>
  );
}

export default CellSpeakButton;
