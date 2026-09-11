import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CellSpeechState } from "../../speech/types";
import { CellSpeakButton } from "../CellSpeakButton";

// The control is presentational on purpose: it takes the cell's speech state
// and raises intents. Neither `useUtteranceChannel` nor `useSpeechPlayer` is
// touched here, so there is nothing to mock — the host owns that wiring.
//
// What it carries is TWO INDEPENDENT CHANNELS: colour says where the audio is,
// icon says what a click does. Neither encodes the other, which is why the
// icon is read off its own attribute (`data-icon`) rather than off
// `data-speech` — and why the last two tests in this file assert the two
// channels against each other rather than one at a time.

const SESSION = "s1";
const testId = `terminal-cell-speak-${SESSION}`;

/** Every state the control has to render, in the order the user meets them. */
const STATES: CellSpeechState[] = [
  "empty",
  "preparing",
  "ready",
  "speaking",
  "stalled",
  "paused",
  "heard",
];

/** RTL cleans up between tests, not between renders inside one. */
function cleanup(button: HTMLElement): void {
  button.closest("body > div")?.remove();
}

function renderButton(state: CellSpeechState) {
  const onSpeak = vi.fn();
  const onPause = vi.fn();
  const onResume = vi.fn();
  render(
    <CellSpeakButton
      sessionId={SESSION}
      state={state}
      onSpeak={onSpeak}
      onPause={onPause}
      onResume={onResume}
    />,
  );
  const button = screen.getByTestId(testId);
  return {
    onSpeak,
    onPause,
    onResume,
    button,
    /** Every intent the control can raise, so "raises nothing" is assertable. */
    calls: () => ({
      speak: onSpeak.mock.calls.length,
      pause: onPause.mock.calls.length,
      resume: onResume.mock.calls.length,
    }),
  };
}

/** The icon channel, read the way the stylesheet reads the colour channel. */
function iconFor(state: CellSpeechState): string | null {
  const { button } = renderButton(state);
  const icon = button.getAttribute("data-icon");
  cleanup(button);
  return icon;
}

// ---------------------------------------------------------------------------
// The colour channel lives in the stylesheet, and jsdom applies no stylesheet:
// `getComputedStyle` here would report the user-agent value and prove nothing.
// So the colour channel is asserted ON THE RULE — the file is read and its
// declarations parsed, exactly as the plan's criterion asks. This proves which
// declarations the stylesheet makes, NOT what a browser paints.
// ---------------------------------------------------------------------------

// Walked at test time, exactly as `src/__tests__/buttonTestIds.contract.test.ts`
// walks the source tree: `src/features/terminal/__tests__` → `src/index.css`.
// Comments are stripped first — the stylesheet documents every rule, and a
// comment sitting in front of one would otherwise be read as part of its
// selector list.
const css = readFileSync(join(__dirname, "..", "..", "..", "index.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

interface CssRule {
  selectors: string[];
  declarations: Record<string, string>;
}

function parseRules(source: string): CssRule[] {
  const rules: CssRule[] = [];
  // Flat blocks only. `@keyframes` bodies match as their own inner blocks and
  // are simply never selected by the queries below, which all name
  // `.terminal-speak`.
  const blocks = source.matchAll(/([^{}]+)\{([^{}]*)\}/g);
  for (const [, selectorList, body] of blocks) {
    const declarations: Record<string, string> = {};
    for (const declaration of body.split(";")) {
      const at = declaration.indexOf(":");
      if (at === -1) continue;
      declarations[declaration.slice(0, at).trim()] = declaration.slice(at + 1).trim();
    }
    rules.push({
      selectors: selectorList.split(",").map((selector) => selector.trim()),
      declarations,
    });
  }
  return rules;
}

const RULES = parseRules(css);

/**
 * The declarations the base `.terminal-speak[data-speech="<state>"]` rules make,
 * in cascade order. Pseudo-class rules (`:hover`) are left out: they are not the
 * resting colour.
 */
function declarationsFor(state: CellSpeechState): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const rule of RULES) {
    const matches = rule.selectors.some(
      (selector) =>
        selector.startsWith(".terminal-speak") &&
        selector.includes(`[data-speech="${state}"]`) &&
        !selector.includes(":hover"),
    );
    if (!matches) continue;
    Object.assign(merged, rule.declarations);
  }
  return merged;
}

/** What the stylesheet paints a state, or `undefined` if it says nothing. */
const colourOf = (state: CellSpeechState): string | undefined =>
  declarationsFor(state).color;

describe("CellSpeakButton", () => {
  it("empty is disabled and raises nothing", () => {
    const { button, calls } = renderButton("empty");

    expect(button).toHaveAttribute("data-speech", "empty");
    expect(button).toHaveAttribute("data-icon", "mute");
    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(calls()).toEqual({ speak: 0, pause: 0, resume: 0 });
  });

  it("preparing is inert", () => {
    const { button, calls } = renderButton("preparing");

    // The utterance is here but its first unit is still synthesizing: the
    // speaker icon says what the click WILL do, while the click itself has
    // nothing to start yet.
    expect(button).toHaveAttribute("data-speech", "preparing");
    expect(button).toHaveAttribute("data-icon", "speaker");
    expect(button).toHaveAttribute("aria-disabled", "true");

    // Deliberately not `disabled`: a disabled button swallows the click in the
    // DOM, which would leave the guard in the handler untested. The click is
    // fired for real and must raise nothing.
    fireEvent.click(button);

    expect(calls()).toEqual({ speak: 0, pause: 0, resume: 0 });
  });

  it("ready pulses and speaks on click", () => {
    const { button, onSpeak, calls } = renderButton("ready");

    // `data-pulse` is the activity LED's own switch (index.css `.terminal-led`),
    // not a second animation — see the speak-control rules in index.css.
    expect(button).toHaveAttribute("data-speech", "ready");
    expect(button).toHaveAttribute("data-icon", "speaker");
    expect(button).toHaveAttribute("data-pulse", "1");
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute("aria-disabled", "true");

    fireEvent.click(button);

    expect(onSpeak).toHaveBeenCalledWith(SESSION);
    expect(calls()).toEqual({ speak: 1, pause: 0, resume: 0 });
  });

  it("speaking and stalled both show pause and raise onPause", () => {
    for (const state of ["speaking", "stalled"] as const) {
      const { button, onPause, calls } = renderButton(state);

      expect(button).toHaveAttribute("data-speech", state);
      expect(button).toHaveAttribute("data-icon", "pause");

      fireEvent.click(button);

      expect(onPause).toHaveBeenCalledWith(SESSION);
      expect(calls()).toEqual({ speak: 0, pause: 1, resume: 0 });
      cleanup(button);
    }
  });

  it("paused shows play and raises onResume", () => {
    const { button, onResume, calls } = renderButton("paused");

    expect(button).toHaveAttribute("data-speech", "paused");
    expect(button).toHaveAttribute("data-icon", "play");

    // A resume is emphatically NOT a speak: `onSpeak` would restart the
    // utterance from unit 0, which is the very position the pause is holding.
    fireEvent.click(button);

    expect(onResume).toHaveBeenCalledWith(SESSION);
    expect(calls()).toEqual({ speak: 0, pause: 0, resume: 1 });
  });

  it("heard replays on click without pulsing", () => {
    const { button, onSpeak, calls } = renderButton("heard");

    expect(button).toHaveClass("terminal-speak");
    expect(button).toHaveAttribute("data-speech", "heard");
    expect(button).toHaveAttribute("data-icon", "speaker");
    expect(button).toHaveAttribute("data-pulse", "0");

    fireEvent.click(button);

    // A replay is the same intent: the audio is still in the synthesis LRU
    // cache, so nothing is re-synthesized.
    expect(onSpeak).toHaveBeenCalledWith(SESSION);
    expect(calls()).toEqual({ speak: 1, pause: 0, resume: 0 });
  });

  it("every state has its own label", () => {
    const labels = STATES.map((state) => {
      const { button } = renderButton(state);
      const title = button.getAttribute("title");
      // The sighted user reads the tooltip, the screen-reader user hears the
      // label; they must be the same sentence.
      expect(button).toHaveAttribute("aria-label", title ?? "");
      cleanup(button);
      return title ?? "";
    });

    expect(new Set(labels).size).toBe(STATES.length);
    expect(labels.every((label) => label.length > 0)).toBe(true);
  });

  it("red is one colour for preparing and stalled, heard is the dimmed yellow", () => {
    // Both sides of the click are the same red: a cell whose first unit is
    // still synthesizing, and a live run blocked on its next one.
    expect(colourOf("preparing")).toBe("var(--red)");
    expect(colourOf("stalled")).toBe("var(--red)");
    expect(colourOf("preparing")).toBe(colourOf("stalled"));

    // Heard is the panel's yellow, dimmed — not the green it used to be.
    expect(colourOf("heard")).toBe("var(--yellow)");
    expect(Number(declarationsFor("heard").opacity)).toBeLessThan(1);
    expect(colourOf("heard")).not.toBe(colourOf("ready"));

    // Unheard audio keeps the activity LED's green, whatever the run is doing.
    expect(colourOf("ready")).toBe("#9ece6a");
    expect(colourOf("speaking")).toBe("#9ece6a");
    expect(colourOf("paused")).toBe("#9ece6a");
  });

  it("colour and icon are two channels, neither derivable from the other", () => {
    const colour = Object.fromEntries(STATES.map((state) => [state, colourOf(state)]));
    const icon = Object.fromEntries(STATES.map((state) => [state, iconFor(state)]));

    // Same colour, different icon: red says "the audio is not here yet" on
    // both sides of the click, while the click means nothing on one side and
    // "hold the run" on the other.
    expect(colour.preparing).toBe(colour.stalled);
    expect(icon.preparing).not.toBe(icon.stalled);

    // Same icon, different colour: the speaker icon means "start or replay"
    // whether the cell is green-unheard or yellow-heard.
    expect(icon.ready).toBe(icon.heard);
    expect(colour.ready).not.toBe(colour.heard);

    // And therefore neither channel is a function of the other: collapsing
    // them back into one attribute breaks one of the two pairs above.
    expect(new Set(Object.values(icon)).size).toBe(4);
    expect(new Set(STATES.map((state) => `${colour[state]}|${icon[state]}`)).size).toBe(
      STATES.length,
    );
  });

  it("the drag and focus guards still hold", () => {
    const onFocus = vi.fn();
    const onDragStart = vi.fn();
    // Mirrors the cell: the root focuses on click, the header row is the
    // draggable that swaps cells.
    render(
      <div onClick={onFocus}>
        <div draggable onDragStart={onDragStart}>
          <CellSpeakButton
            sessionId={SESSION}
            state="ready"
            onSpeak={() => {}}
            onPause={() => {}}
            onResume={() => {}}
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
