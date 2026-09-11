import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { CellAutoplayToggle } from "../CellAutoplayToggle";

const idOf = (sessionId: string) => `terminal-cell-autoplay-${sessionId}`;

/**
 * Two toggles driven by one `armedSessionId`. Exclusivity is structural — a
 * single armed session per browser, owned by `useUtteranceChannel` (Task 7) —
 * so what is asserted here is that the rendered state follows that one value,
 * not that the control enforces exclusivity itself.
 */
function TwoCells({ initial = null }: { initial?: string | null }) {
  const [armed, setArmed] = useState<string | null>(initial);
  return (
    <>
      {["a", "b"].map((id) => (
        <CellAutoplayToggle
          key={id}
          sessionId={id}
          armedSessionId={armed}
          onArm={setArmed}
        />
      ))}
    </>
  );
}

describe("CellAutoplayToggle", () => {
  it("shows the autoplay state without interaction", () => {
    render(<TwoCells initial="a" />);

    const armed = screen.getByTestId(idOf("a"));
    const off = screen.getByTestId(idOf("b"));

    // Readable with no hover and no click: an accessible switch state plus a
    // rendered attribute the stylesheet keys off.
    expect(armed).toHaveAttribute("role", "switch");
    expect(armed).toHaveAttribute("aria-checked", "true");
    expect(armed).toHaveAttribute("data-armed", "1");
    expect(armed).toHaveAccessibleName();

    expect(off).toHaveAttribute("aria-checked", "false");
    expect(off).toHaveAttribute("data-armed", "0");
  });

  it("arming one cell turns the other cell's toggle off", () => {
    render(<TwoCells initial="a" />);

    fireEvent.click(screen.getByTestId(idOf("b")));

    expect(screen.getByTestId(idOf("b"))).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId(idOf("a"))).toHaveAttribute("aria-checked", "false");

    // Clicking the armed cell disarms it, leaving the browser with no armed cell.
    fireEvent.click(screen.getByTestId(idOf("b")));

    expect(screen.getByTestId(idOf("b"))).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId(idOf("a"))).toHaveAttribute("aria-checked", "false");
  });

  it("clicking a control does not focus the cell or start a drag", () => {
    const onFocus = vi.fn();
    const onDragStart = vi.fn();
    // Mirrors the cell: the root focuses on click, the header row is the
    // draggable that swaps cells.
    render(
      <div onClick={onFocus}>
        <div draggable onDragStart={onDragStart}>
          <CellAutoplayToggle
            sessionId="a"
            armedSessionId={null}
            onArm={() => {}}
          />
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
