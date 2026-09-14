import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { CellAutoplayToggle } from "../CellAutoplayToggle";

const idOf = (sessionId: string) => `terminal-cell-autoplay-${sessionId}`;

/**
 * Two cells, one `armedSessionId` and a bar each. Arming is NOT what this
 * control does any more — the bar's own switch owns it — so `onArm` is not a
 * prop here at all: the header raises `onToggleBar` and renders `armedSessionId`.
 *
 * Exclusivity is still structural (a single armed session per browser, owned by
 * `useUtteranceChannel`), so what is asserted here is that the rendered state
 * follows that one value and that a click cannot move it.
 */
function TwoCells({
  initialArmed = null,
  initialOpen = [],
}: {
  initialArmed?: string | null;
  initialOpen?: string[];
}) {
  const [armed] = useState<string | null>(initialArmed);
  const [open, setOpen] = useState<string[]>(initialOpen);
  return (
    <>
      {["a", "b"].map((id) => (
        <div key={id}>
          <CellAutoplayToggle
            sessionId={id}
            armedSessionId={armed}
            barVisible={open.includes(id)}
            onToggleBar={(sessionId) =>
              setOpen((current) =>
                current.includes(sessionId)
                  ? current.filter((one) => one !== sessionId)
                  : [...current, sessionId],
              )
            }
          />
          {open.includes(id) ? <div data-testid={`speech-bar-${id}`} /> : null}
        </div>
      ))}
    </>
  );
}

describe("CellAutoplayToggle", () => {
  it("the header icon toggles the bar and leaves arming alone", () => {
    render(<TwoCells initialArmed="a" />);

    expect(screen.queryByTestId("speech-bar-a")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId(idOf("a")));
    expect(screen.getByTestId("speech-bar-a")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId(idOf("a")));
    expect(screen.queryByTestId("speech-bar-a")).not.toBeInTheDocument();

    // Two clicks on the armed cell's icon and one on an unarmed cell's, and the
    // armed cell is exactly where it started. This control cannot arm and
    // cannot disarm — `TwoCells` gives it no way to, which is the point:
    // `onArm` is not among its props.
    fireEvent.click(screen.getByTestId(idOf("b")));
    expect(screen.getByTestId(idOf("a"))).toHaveAttribute("data-armed", "1");
    expect(screen.getByTestId(idOf("b"))).toHaveAttribute("data-armed", "0");
  });

  it("the header icon still reports which cell is armed", () => {
    // Cell a is armed with its bar CLOSED; cell b is unarmed with its bar OPEN.
    // Arming is legible across a grid without opening anything, which is the
    // whole reason the icon stayed in the header.
    render(<TwoCells initialArmed="a" initialOpen={["b"]} />);

    const armed = screen.getByTestId(idOf("a"));
    const off = screen.getByTestId(idOf("b"));

    expect(armed).toHaveAttribute("data-armed", "1");
    expect(armed).toHaveAttribute("aria-expanded", "false");
    expect(armed).toHaveAccessibleName();

    expect(off).toHaveAttribute("data-armed", "0");
    expect(off).toHaveAttribute("aria-expanded", "true");

    // Opening the armed cell's bar does not change what it reports about arming.
    fireEvent.click(armed);
    expect(screen.getByTestId(idOf("a"))).toHaveAttribute("data-armed", "1");
    expect(screen.getByTestId(idOf("a"))).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId(idOf("b"))).toHaveAttribute("data-armed", "0");
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
            barVisible={false}
            onToggleBar={() => {}}
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
