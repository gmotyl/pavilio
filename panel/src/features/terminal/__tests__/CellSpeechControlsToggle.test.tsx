import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { CellSpeechControlsToggle } from "../CellSpeechControlsToggle";

const idOf = (sessionId: string) => `terminal-cell-speech-controls-${sessionId}`;

/**
 * Two cells, a bar each, and one armed cell held OUTSIDE the control.
 *
 * The header control used to tell two stories: it showed which cell was armed
 * and it toggled the bar. It now tells one — show or hide the speech controls —
 * so `armedSessionId` is not among its props, and `onArm` never was. The armed
 * cell lives in this harness purely so the suite can prove the control cannot
 * move it: `armed` has no setter, and nothing the control is handed could reach
 * one if it had.
 *
 * Arming is the BAR's switch. The stub bar below carries that switch's
 * `data-armed` under the same test id the real `SpeechControlBar` publishes, so
 * "who is armed" is read here exactly where a user reads it — inside the bar.
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
          {open.includes(id) ? (
            <div data-testid={`speech-bar-${id}`}>
              <span
                data-testid={`speech-bar-autoplay-${id}`}
                data-armed={armed === id ? "1" : "0"}
              />
            </div>
          ) : null}
        </div>
      ))}
    </>
  );
}

const armOf = (id: string) =>
  screen.getByTestId(`speech-bar-autoplay-${id}`).getAttribute("data-armed");

describe("CellSpeechControlsToggle", () => {
  it("the control shows and hides the speech control bar", () => {
    render(<TwoCells />);

    expect(screen.queryByTestId("speech-bar-a")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId(idOf("a")));
    expect(screen.getByTestId("speech-bar-a")).toBeInTheDocument();
    expect(screen.getByTestId(idOf("a"))).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByTestId(idOf("a")));
    expect(screen.queryByTestId("speech-bar-a")).not.toBeInTheDocument();
    expect(screen.getByTestId(idOf("a"))).toHaveAttribute("aria-expanded", "false");

    // Per cell: a's control has no say over b's bar.
    fireEvent.click(screen.getByTestId(idOf("b")));
    expect(screen.getByTestId("speech-bar-b")).toBeInTheDocument();
    expect(screen.queryByTestId("speech-bar-a")).not.toBeInTheDocument();
  });

  it("activating the control does not change the armed cell", () => {
    // Both bars out, so both arm switches are readable throughout.
    render(<TwoCells initialArmed="a" initialOpen={["a", "b"]} />);
    expect([armOf("a"), armOf("b")]).toEqual(["1", "0"]);

    // Hide and show the armed cell's bar, then the unarmed cell's — four
    // activations of the control, none of which can arm or disarm anything.
    fireEvent.click(screen.getByTestId(idOf("a")));
    fireEvent.click(screen.getByTestId(idOf("a")));
    fireEvent.click(screen.getByTestId(idOf("b")));
    fireEvent.click(screen.getByTestId(idOf("b")));

    expect([armOf("a"), armOf("b")]).toEqual(["1", "0"]);
  });

  it("the control renders the same whether or not the cell is armed", () => {
    // `a` is the armed cell, `b` is not, and both bars are closed — so the
    // disclosure half of the control is identical for the two and arming is
    // the only thing that could tell them apart. It cannot: there is no armed
    // half left, and the markup is the same down to the byte.
    render(<TwoCells initialArmed="a" />);

    const normalize = (id: string) =>
      screen.getByTestId(idOf(id)).outerHTML.replaceAll(idOf(id), "ID");

    expect(normalize("a")).toBe(normalize("b"));
    // The channel the stylesheet used to key the green off is gone with it.
    expect(screen.getByTestId(idOf("a"))).not.toHaveAttribute("data-armed");
    expect(screen.getByTestId(idOf("b"))).not.toHaveAttribute("data-armed");
  });

  it("the accessible name mentions only the speech controls", () => {
    render(<TwoCells initialArmed="a" initialOpen={["b"]} />);

    const nameOf = (id: string) => screen.getByTestId(idOf(id)).getAttribute("aria-label") ?? "";

    // The armed cell with its bar closed, and the unarmed cell with its bar
    // open: the two names differ on the disclosure and on nothing else.
    expect(nameOf("a")).toMatch(/show the speech controls/i);
    expect(nameOf("b")).toMatch(/hide the speech controls/i);
    expect(nameOf("a")).not.toMatch(/arm|autoplay/i);
    expect(nameOf("b")).not.toMatch(/arm|autoplay/i);
    expect(screen.getByTestId(idOf("a"))).toHaveAccessibleName(nameOf("a"));

    // Same bar state, same name — including on the armed cell, which is what
    // "says nothing about arming" means for the one channel a screen-reader
    // user actually has.
    fireEvent.click(screen.getByTestId(idOf("a")));
    expect(nameOf("a")).toBe(nameOf("b"));
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
