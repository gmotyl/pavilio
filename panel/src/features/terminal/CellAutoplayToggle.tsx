import { Radio } from "lucide-react";

export interface CellAutoplayToggleProps {
  sessionId: string;
  /**
   * The one armed session in this browser, or `null`. Exclusivity is
   * structural — `useUtteranceChannel` holds a single `armedSessionId` — so
   * this control renders that value and never enforces exclusivity itself.
   */
  armedSessionId: string | null;
  /** Whether this cell's {@link SpeechControlBar} is on screen. */
  barVisible: boolean;
  /** Show or hide this cell's bar. Arming is the BAR's switch, not this one. */
  onToggleBar: (sessionId: string) => void;
}

/**
 * The cell header's autoplay icon. It carries **two things that are no longer
 * the same thing**: it REPORTS whether this cell is the armed one, and its
 * click shows or hides the cell's speech control bar.
 *
 * Arming moved into the bar deliberately. Arming is rare and exclusive per
 * browser, so it can afford the second click; *seeing* which cell is armed is
 * needed constantly and across a whole grid, so it stays here, always visible,
 * whether or not any bar is open.
 *
 * Which is why this is a plain button with `aria-expanded` and not the
 * `role="switch"` it used to be: a switch whose `aria-checked` did not move
 * when it was clicked would be a lie to a screen reader. The state the click
 * moves is the disclosure; the armed state rides along in `data-armed` — which
 * the stylesheet keys the green off — and in the accessible name, which is the
 * only channel a screen-reader user has for it.
 *
 * Presentational, like {@link CellSpeakButton}: it raises intents and imports
 * no speech hook, so the grid stays renderable without a speech host.
 */
export function CellAutoplayToggle({
  sessionId,
  armedSessionId,
  barVisible,
  onToggleBar,
}: CellAutoplayToggleProps) {
  const armed = armedSessionId === sessionId;
  const label = `${barVisible ? "Hide" : "Show"} the speech controls — ${
    armed ? "autoplay is armed here" : "autoplay is off"
  }`;

  return (
    <button
      type="button"
      // The bar is the region this discloses. No `aria-controls`: the same
      // cell's bar is mounted once per view, and the panel runs two views at
      // once whenever the terminal drawer is open — an id would be duplicated.
      aria-expanded={barVisible}
      title={label}
      aria-label={label}
      data-testid={`terminal-cell-autoplay-${sessionId}`}
      // Rendered state, so armed/off is legible with no hover and no click.
      data-armed={armed ? "1" : "0"}
      className="terminal-autoplay p-1 rounded"
      // See CellSpeakButton: the header drags and the cell root focuses.
      draggable={false}
      onClick={(e) => {
        e.stopPropagation();
        onToggleBar(sessionId);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <Radio size={11} />
    </button>
  );
}

export default CellAutoplayToggle;
