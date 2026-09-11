import { Radio } from "lucide-react";

export interface CellAutoplayToggleProps {
  sessionId: string;
  /**
   * The one armed session in this browser, or `null`. Exclusivity is
   * structural — `useUtteranceChannel` holds a single `armedSessionId` — so
   * this control renders that value and never enforces exclusivity itself.
   */
  armedSessionId: string | null;
  /** `useUtteranceChannel().setArmed`: the session id to arm, or `null` to disarm. */
  onArm: (sessionId: string | null) => void;
}

/**
 * The cell header's autoplay toggle: a standing, always-visible switch, not a
 * modifier-click and not a hidden popover. Presentational, like
 * {@link CellSpeakButton} — it raises `onArm` and reads its state from
 * `armedSessionId`, so arming one cell disarms the rest for free.
 */
export function CellAutoplayToggle({
  sessionId,
  armedSessionId,
  onArm,
}: CellAutoplayToggleProps) {
  const armed = armedSessionId === sessionId;
  const label = armed
    ? "Autoplay armed — speak responses here automatically"
    : "Autoplay off — arm this terminal";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={armed}
      title={label}
      aria-label={label}
      data-testid={`terminal-cell-autoplay-${sessionId}`}
      // Rendered state, so on/off is legible with no hover and no click.
      data-armed={armed ? "1" : "0"}
      className="terminal-autoplay p-1 rounded"
      // See CellSpeakButton: the header drags and the cell root focuses.
      draggable={false}
      onClick={(e) => {
        e.stopPropagation();
        onArm(armed ? null : sessionId);
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
