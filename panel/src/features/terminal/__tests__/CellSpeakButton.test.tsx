import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CellSpeechState } from "../../speech/useUtteranceChannel";
import { CellSpeakButton } from "../CellSpeakButton";

// The control is presentational on purpose: it takes the cell's speech state
// and raises intents. Neither `useUtteranceChannel` nor `useSpeechPlayer` is
// touched here, so there is nothing to mock — Task 11 owns that wiring.

const SESSION = "s1";
const testId = `terminal-cell-speak-${SESSION}`;

function renderButton(state: CellSpeechState) {
  const onSpeak = vi.fn();
  const onStop = vi.fn();
  render(
    <CellSpeakButton
      sessionId={SESSION}
      state={state}
      onSpeak={onSpeak}
      onStop={onStop}
    />,
  );
  return { onSpeak, onStop, button: screen.getByTestId(testId) };
}

describe("CellSpeakButton", () => {
  it("renders muted and inert in the empty state", () => {
    const { onSpeak, onStop, button } = renderButton("empty");

    expect(button).toHaveAttribute("data-speech", "empty");
    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(onSpeak).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
  });

  it("pulses in the unheard state and speaks on click", () => {
    const { onSpeak, onStop, button } = renderButton("unheard");

    // `data-pulse` is the activity LED's own switch (index.css `.terminal-led`),
    // not a second animation — see the speak-control rules in index.css.
    expect(button).toHaveAttribute("data-speech", "unheard");
    expect(button).toHaveAttribute("data-pulse", "1");
    expect(button).not.toBeDisabled();

    fireEvent.click(button);

    expect(onSpeak).toHaveBeenCalledWith(SESSION);
    expect(onStop).not.toHaveBeenCalled();
  });

  it("keeps the colour without the pulse in the heard state and replays on click", () => {
    const { onSpeak, onStop, button } = renderButton("heard");

    // The green is the shared `terminal-speak` rule set's, so `heard` and
    // `unheard` differ only by the pulse attribute.
    expect(button).toHaveClass("terminal-speak");
    expect(button).toHaveAttribute("data-speech", "heard");
    expect(button).toHaveAttribute("data-pulse", "0");

    fireEvent.click(button);

    // A replay is the same intent: the audio is still in the synthesis LRU
    // cache, so nothing is re-synthesized.
    expect(onSpeak).toHaveBeenCalledWith(SESSION);
    expect(onStop).not.toHaveBeenCalled();
  });

  it("stops playback when clicked while speaking", () => {
    const { onSpeak, onStop, button } = renderButton("speaking");

    expect(button).toHaveAttribute("data-speech", "speaking");

    fireEvent.click(button);

    expect(onStop).toHaveBeenCalledWith(SESSION);
    expect(onSpeak).not.toHaveBeenCalled();
  });

  it("clicking a control does not focus the cell or start a drag", () => {
    const onFocus = vi.fn();
    const onDragStart = vi.fn();
    // Mirrors the cell: the root focuses on click, the header row is the
    // draggable that swaps cells.
    render(
      <div onClick={onFocus}>
        <div draggable onDragStart={onDragStart}>
          <CellSpeakButton
            sessionId={SESSION}
            state="unheard"
            onSpeak={() => {}}
            onStop={() => {}}
          />
        </div>
      </div>,
    );
    const button = screen.getByTestId(testId);

    fireEvent.click(button);
    expect(onFocus).not.toHaveBeenCalled();

    fireEvent.mouseDown(button);
    fireEvent.dragStart(button);
    expect(onDragStart).not.toHaveBeenCalled();
  });
});
