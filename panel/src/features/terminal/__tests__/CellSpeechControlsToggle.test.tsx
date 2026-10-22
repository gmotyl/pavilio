import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { CellSpeechControlsToggle } from "../CellSpeechControlsToggle";

const idOf = (sessionId: string) => `terminal-cell-speech-controls-${sessionId}`;

/**
 * Two cells, a bar each. The control only shows or hides its own cell's bar;
 * the open state lives here, as it lives in `TerminalLayoutGrid`.
 */
function TwoCells() {
  const [open, setOpen] = useState<string[]>([]);
  return (
    <>
      {["a", "b"].map((id) => (
        <div key={id}>
          <CellSpeechControlsToggle
            sessionId={id}
            barVisible={open.includes(id)}
            // Closed over, not passed in: the callback takes nothing, exactly
            // as `TerminalLayoutGrid`'s does. The harness knows which cell it
            // is rendering because it is the one rendering it.
            onToggleBar={() =>
              setOpen((current) =>
                current.includes(id) ? current.filter((one) => one !== id) : [...current, id],
              )
            }
          />
          {open.includes(id) ? <div data-testid={`speech-bar-${id}`} /> : null}
        </div>
      ))}
    </>
  );
}

describe("CellSpeechControlsToggle", () => {
  it("the control shows and hides the speech control bar", () => {
    render(<TwoCells />);

    expect(screen.queryByTestId("speech-bar-a")).not.toBeInTheDocument();
    expect(screen.getByTestId(idOf("a"))).toHaveAccessibleName(/show the speech controls/i);

    fireEvent.click(screen.getByTestId(idOf("a")));
    expect(screen.getByTestId("speech-bar-a")).toBeInTheDocument();
    expect(screen.getByTestId(idOf("a"))).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId(idOf("a"))).toHaveAccessibleName(/hide the speech controls/i);

    fireEvent.click(screen.getByTestId(idOf("a")));
    expect(screen.queryByTestId("speech-bar-a")).not.toBeInTheDocument();
    expect(screen.getByTestId(idOf("a"))).toHaveAttribute("aria-expanded", "false");

    // Per cell: a's control has no say over b's bar.
    fireEvent.click(screen.getByTestId(idOf("b")));
    expect(screen.getByTestId("speech-bar-b")).toBeInTheDocument();
    expect(screen.queryByTestId("speech-bar-a")).not.toBeInTheDocument();
  });

  it("clicking a control does not focus the cell or start a drag", () => {
    const onFocus = vi.fn();
    const onDragStart = vi.fn();
    // Mirrors the cell: the root focuses on click, the header row is the
    // draggable that swaps cells.
    render(
      <div onClick={onFocus}>
        <div draggable onDragStart={onDragStart}>
          <CellSpeechControlsToggle sessionId="a" barVisible={false} onToggleBar={() => {}} />
        </div>
      </div>,
    );
    const toggle = screen.getByTestId(idOf("a"));

    fireEvent.click(toggle);
    expect(onFocus).not.toHaveBeenCalled();

    fireEvent.mouseDown(toggle);
    fireEvent.dragStart(toggle);
    expect(onDragStart).not.toHaveBeenCalled();
  });
});
