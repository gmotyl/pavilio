import { useState } from "react";

import { getStoredAutoOpenAnswer, setStoredAutoOpenAnswer } from "./autoOpenAnswer";

/**
 * The Settings-page checkbox for the answer pane's "open on a new answer"
 * preference — the only control for it. Global and portable: it travels with
 * the workspace, like the voice, and sits under the voice picker in the Speech
 * section for the same reason: one preference with no cell or surface to
 * belong to. Every cell reads it when an answer arrives, so a change reaches
 * cells already open.
 *
 * `setStoredAutoOpenAnswer` returns the value now in effect, so a browser that
 * refuses to store (private mode, blocked site data) still shows the choice
 * for this page view.
 */
export function AutoOpenAnswerToggle() {
  const [on, setOn] = useState<boolean>(getStoredAutoOpenAnswer);

  return (
    <div>
      <label
        htmlFor="speech-auto-open-answer"
        className="inline-flex items-center gap-2 text-sm cursor-pointer select-none"
        style={{ color: "var(--text-primary)" }}
      >
        <input
          id="speech-auto-open-answer"
          data-testid="speech-auto-open-answer"
          type="checkbox"
          checked={on}
          onChange={(e) => setOn(setStoredAutoOpenAnswer(e.target.checked))}
        />
        Open the answer pane on a new answer
      </label>
      <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
        Every cell reads this when an answer arrives; a change here reaches
        cells already open.
      </p>
    </div>
  );
}
