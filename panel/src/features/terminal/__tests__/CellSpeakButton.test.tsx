import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CellSpeechState } from "../../speech/types";
import { CellSpeakButton } from "../CellSpeakButton";

// The control is presentational on purpose: it takes the cell's speech state
// and raises one intent. Neither `useUtteranceChannel` nor `useSpeechPlayer` is
// touched here, so there is nothing to mock — the host owns that wiring.
//
// It exists only while the cell is speaking (mockup S: "speaker button only
// while speaking (pulsing)"). Starting, resuming and replaying all live in the
// speech control bar's transport; the header control is the one-click way to
// hold a run that is already talking.

const SESSION = "s1";
const testId = `terminal-cell-speak-${SESSION}`;

/** The states that leave the header without a speak control. */
const HIDDEN: CellSpeechState[] = ["empty", "preparing", "ready", "paused", "heard"];

function renderButton(state: CellSpeechState) {
  const onPause = vi.fn();
  const view = render(<CellSpeakButton sessionId={SESSION} state={state} onPause={onPause} />);
  return { onPause, view };
}

// ---------------------------------------------------------------------------
// The pulse's reduced-motion stop lives in the stylesheet, and jsdom applies no
// stylesheet and evaluates no media query. So it is asserted ON THE RULE — the
// file is read, comments stripped, and the body of the reduced-motion query is
// cut out by brace matching. This proves what the stylesheet declares, NOT what
// a browser paints.
// ---------------------------------------------------------------------------

const css = readFileSync(join(__dirname, "..", "..", "..", "index.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** Every `@media (prefers-reduced-motion: reduce)` body in the stylesheet. */
function reducedMotionBodies(source: string): string[] {
  const bodies: string[] = [];
  const head = /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{/g;
  for (const match of source.matchAll(head)) {
    let depth = 1;
    let at = (match.index ?? 0) + match[0].length;
    const start = at;
    while (depth > 0 && at < source.length) {
      if (source[at] === "{") depth += 1;
      else if (source[at] === "}") depth -= 1;
      at += 1;
    }
    bodies.push(source.slice(start, at - 1));
  }
  return bodies;
}

/** The declarations a rule inside `body` makes for exactly `selector`. */
function declarationsIn(body: string, selector: string): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [, selectorList, block] of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = selectorList.split(",").map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const declaration of block.split(";")) {
      const colon = declaration.indexOf(":");
      if (colon === -1) continue;
      merged[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
    }
  }
  return merged;
}

describe("CellSpeakButton", () => {
  it("speak button is hidden unless speaking", () => {
    for (const state of HIDDEN) {
      const { view, onPause } = renderButton(state);

      // Nothing at all — no placeholder that would hold the header's space.
      expect(screen.queryByTestId(testId)).toBeNull();
      expect(view.container).toBeEmptyDOMElement();
      expect(onPause).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it("speaking shows a pulsing speaker that pauses", () => {
    const { onPause } = renderButton("speaking");
    const button = screen.getByTestId(testId);

    expect(button).toHaveAttribute("data-speech", "speaking");
    expect(button).toHaveAttribute("data-pulse", "1");
    expect(button).toHaveAttribute("aria-label", "Pause speaking");
    expect(button).toHaveAttribute("title", "Pause speaking");
    // A speaker, not a pause glyph: the control says what is happening and the
    // label says what a click does.
    expect(button.querySelector("svg.lucide-volume-2")).not.toBeNull();

    fireEvent.click(button);

    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onPause).toHaveBeenCalledWith(SESSION);
  });

  it("stalled shows the pulsing speaker", () => {
    const { onPause } = renderButton("stalled");
    const button = screen.getByTestId(testId);

    // A run blocked on its next unit is still a run in hand: same control,
    // same intent. `data-speech` keeps the red the stylesheet keys off it.
    expect(button).toHaveAttribute("data-speech", "stalled");
    expect(button).toHaveAttribute("data-pulse", "1");
    expect(button).toHaveAttribute("aria-label", "Pause speaking");
    expect(button.querySelector("svg.lucide-volume-2")).not.toBeNull();

    fireEvent.click(button);

    expect(onPause).toHaveBeenCalledWith(SESSION);
  });

  it("reduced motion stops the speaker's pulse", () => {
    const bodies = reducedMotionBodies(css);
    expect(bodies.length).toBeGreaterThan(0);

    const stopped = bodies.some(
      (body) => declarationsIn(body, '.terminal-speak[data-pulse="1"]').animation === "none",
    );
    expect(stopped).toBe(true);
  });

  it("the drag and focus guards still hold", () => {
    const onFocus = vi.fn();
    const onDragStart = vi.fn();
    // Mirrors the cell: the root focuses on click, the header row is the
    // draggable that swaps cells.
    render(
      <div onClick={onFocus}>
        <div draggable onDragStart={onDragStart}>
          <CellSpeakButton sessionId={SESSION} state="speaking" onPause={() => {}} />
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
