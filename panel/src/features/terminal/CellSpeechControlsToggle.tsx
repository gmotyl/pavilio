import { PanelTopClose, PanelTopOpen } from "lucide-react";

export interface CellSpeechControlsToggleProps {
  sessionId: string;
  /** Whether this cell's {@link SpeechControlBar} is on screen. */
  barVisible: boolean;
  /**
   * Show or hide this cell's bar. Arming is the BAR's switch, not this one.
   *
   * Takes nothing. It used to advertise the cell's `sessionId`, and no caller
   * in the panel ever read it: `TerminalLayoutGrid` renders ONE bar for the
   * focused cell and toggles a single boolean, so the id it was handed was
   * noise. Only the test harness routed by it — which made a parameter that
   * existed for the tests alone look like part of the contract, and invited
   * the next caller to build per-cell bars on a promise nothing keeps.
   */
  onToggleBar: () => void;
}

/**
 * The cell header's speech-controls disclosure. It does exactly ONE thing:
 * show or hide this cell's speech control bar.
 *
 * It used to do two. It also REPORTED which cell was armed — through
 * `data-armed`, the green fill the stylesheet keyed off it, and a clause in the
 * accessible name — while its click moved something else entirely. A control
 * whose colour answers one question and whose click answers another is two
 * controls wearing one button: a user reading the green had no way to learn
 * that pressing it would not turn the green off. Arming lives in one place now,
 * the bar's own arm switch, and is read there.
 *
 * Which is why `armedSessionId` is gone from the props rather than merely left
 * unread: a component still handed the armed session is one the next change can
 * quietly start rendering from again.
 *
 * It stays a plain button with `aria-expanded` rather than the `role="switch"`
 * it once was: the state its click moves is the disclosure, and the icon pair
 * and the accessible name both say which way that click goes.
 *
 * Presentational, like {@link CellSpeakButton}: it raises intents and imports
 * no speech hook, so the grid stays renderable without a speech host.
 */
export function CellSpeechControlsToggle({
  sessionId,
  barVisible,
  onToggleBar,
}: CellSpeechControlsToggleProps) {
  const label = `${barVisible ? "Hide" : "Show"} the speech controls`;
  // The bar sits across the top of the cell, so the panel-top pair is the shape
  // it actually has. Keyed to `barVisible` exactly as the name is, so the icon
  // and the name can never disagree about which way the next click goes.
  const Icon = barVisible ? PanelTopClose : PanelTopOpen;

  return (
    <button
      type="button"
      // The bar is the region this discloses. No `aria-controls`: the same
      // cell's bar is mounted once per view, and the panel runs two views at
      // once whenever the terminal drawer is open — an id would be duplicated.
      aria-expanded={barVisible}
      title={label}
      aria-label={label}
      data-testid={`terminal-cell-speech-controls-${sessionId}`}
      className="terminal-speech-controls p-1 rounded"
      // See CellSpeakButton: the header drags and the cell root focuses.
      draggable={false}
      onClick={(e) => {
        e.stopPropagation();
        onToggleBar();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <Icon size={11} />
    </button>
  );
}

export default CellSpeechControlsToggle;
