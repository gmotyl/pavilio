/**
 * The launcher pills that fill the reserved speech row until the cell speaks.
 *
 * The row is present from mount (`SpeechControlBar.test.tsx` and
 * `TerminalView.speechRow.test.tsx` pin that), and before the first utterance
 * the transport controls nothing — so it is not rendered at all and the row
 * carries the arm switch and one pill per configured launcher instead. The
 * subject here is therefore the BRANCH, not a component in isolation: the bar
 * is rendered with a real preference behind it and a real `send`, because a
 * pill whose command never reaches the PTY is the only failure that matters.
 *
 * Arming is asserted here too. It is the one control that survives both halves
 * of the branch, and `autoplay.integration.test.tsx` proves it against the real
 * host; what this file pins is that the pills branch did not drop it.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { cssRule } from "../../shell/__tests__/hamburgerGeometry";
import { SpeechControlBar } from "../SpeechControlBar";
import { preferences } from "../../../preferences/declarations";
import { writePreference } from "../../../preferences/store";
import type { CellSpeechState, GridSpeech, SpeechUnit, Utterance } from "../../speech/types";
import { emptyUtteranceQueue, type UtteranceQueue } from "../../speech/utteranceQueue";

/** Shared, because a `useSyncExternalStore` snapshot must be referentially
 *  stable between notifications — a fresh `new Map()` per call is an infinite
 *  render loop. */
const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();
const NO_UNITS: readonly SpeechUnit[] = Object.freeze([]);

interface SpeechOverrides {
  state?: CellSpeechState;
  queue?: UtteranceQueue;
  units?: SpeechUnit[];
  armedSessionId?: string | null;
}

function makeSpeech(over: SpeechOverrides = {}): GridSpeech {
  const units = over.units ?? NO_UNITS;

  return {
    stateFor: () => over.state ?? "empty",
    queueFor: () => over.queue ?? emptyUtteranceQueue,
    unitsFor: () => units,
    subscribeProgress: () => () => {},
    progressFor: () => null,
    unitDurationsFor: () => NO_DURATIONS,
    armedSessionId: over.armedSessionId ?? null,
    onSpeak: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onArm: vi.fn(),
    onJumpToUnit: vi.fn(),
    onSeekWithinUnit: vi.fn(),
  };
}

/** A cell that has spoken: an utterance under the cursor and units to draw. */
function spokenSpeech(): GridSpeech {
  const current: Utterance = { id: "u-1", sessionId: "cell-a", text: "Something", at: 1 };
  return makeSpeech({
    state: "ready",
    queue: { ...emptyUtteranceQueue, current },
    units: [{ text: "Something", chars: 9, source: "Something" }],
  });
}

/** Every pill on a cell's row, in order. */
function pills(sessionId = "cell-a"): HTMLButtonElement[] {
  return screen.queryAllByTestId(
    new RegExp(`^speech-bar-launch-${sessionId}-`),
  ) as HTMLButtonElement[];
}

/** Every pill on the row, in order, read by its label. */
function pillLabels(): string[] {
  return pills().map((pill) => pill.textContent ?? "");
}

function bar(speech: GridSpeech, send: (data: string) => void, sessionId = "cell-a") {
  return (
    <SpeechControlBar
      sessionId={sessionId}
      speech={speech}
      answerOpen={false}
      onToggleAnswer={() => {}}
      send={send}
    />
  );
}

function renderBar(speech: GridSpeech, send: (data: string) => void) {
  return render(bar(speech, send));
}

describe("LauncherPills", () => {
  it("renders a pill per configured launcher while the cell has nothing to play", () => {
    renderBar(makeSpeech({ state: "empty" }), vi.fn());

    // Nothing stored, so the row shows the declared defaults, in order.
    expect(pillLabels()).toEqual(["claude", "codex", "opencode"]);
    // …and the transport, which controls nothing yet, is not there at all.
    expect(screen.queryByTestId("speech-bar-playpause-cell-a")).toBeNull();
    expect(screen.queryByTestId("speech-bar-previous-cell-a")).toBeNull();
    expect(screen.queryByTestId("speech-bar-next-cell-a")).toBeNull();
    expect(screen.queryByTestId("speech-bar-scrubber-cell-a")).toBeNull();
  });

  it("sends the command with a trailing return, once, on click", async () => {
    const user = userEvent.setup();
    const send = vi.fn();
    renderBar(makeSpeech({ state: "empty" }), send);

    await user.click(screen.getByRole("button", { name: "claude" }));

    // Exactly the command, exactly one carriage return, exactly one send: a
    // pill that fired twice would run the agent twice.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("claude\r");
  });

  it("labels the pill with the name and sends the command", async () => {
    const user = userEvent.setup();
    const send = vi.fn();
    writePreference(preferences.terminalLaunchers, [
      { name: "resume", command: "claude --resume" },
    ]);

    renderBar(makeSpeech({ state: "empty" }), send);

    // The name is the label — the command never appears on screen.
    expect(pillLabels()).toEqual(["resume"]);
    expect(screen.queryByRole("button", { name: "claude --resume" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "resume" }));

    // …and the command is what the PTY receives, verbatim.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("claude --resume\r");
  });

  it("swaps the pills for the transport once the cell has spoken", () => {
    const send = vi.fn();
    const view = renderBar(makeSpeech({ state: "empty" }), send);
    expect(pillLabels()).toEqual(["claude", "codex", "opencode"]);

    view.rerender(
      <SpeechControlBar
        sessionId="cell-a"
        speech={spokenSpeech()}
        answerOpen={false}
        onToggleAnswer={() => {}}
        send={send}
      />,
    );

    // The launchers are gone and do not come back; the transport is live.
    expect(pillLabels()).toEqual([]);
    expect(screen.getByTestId("speech-bar-playpause-cell-a")).toHaveAttribute(
      "data-speech",
      "ready",
    );
    expect(screen.getByTestId("speech-bar-scrubber-cell-a")).toBeInTheDocument();
  });

  it("arms a cell that has never spoken", async () => {
    const user = userEvent.setup();
    const speech = makeSpeech({ state: "empty" });
    renderBar(speech, vi.fn());

    // The switch is the reason the row is reachable before the first answer.
    await user.click(screen.getByTestId("speech-bar-autoplay-cell-a"));

    expect(speech.onArm).toHaveBeenCalledTimes(1);
    expect(speech.onArm).toHaveBeenCalledWith("cell-a");
  });

  /**
   * Once a launcher has been used in a cell, the pills stop being live there.
   *
   * The cell's speech state is NOT the signal: `SpeechControlBar` swaps the
   * pills for the transport only when the cell has SPOKEN, and an agent runs
   * for minutes before its first utterance. Greg clicked `claude`, watched it
   * load in the cell, and the three pills were still sitting there offering to
   * launch — a click then does not start a second agent, it types `claude`
   * into the prompt of the one already running.
   *
   * Disabled rather than unmounted, deliberately: the row is a fixed 56px
   * spent at mount so that no box moves under a running TUI, and pulling the
   * pills out of it the moment one was pressed would be the same jump the
   * reserved row exists to prevent.
   */
  describe("once a launcher has been used", () => {
    it("leaves every pill live in a cell that has not launched", () => {
      renderBar(makeSpeech({ state: "empty" }), vi.fn());

      // Three pills, all of them pressable. This is also what proves the flag
      // is cleared between tests — the case above this one clicked a pill in
      // `cell-a`, and a flag that leaked would disable these.
      expect(pills()).toHaveLength(3);
      for (const pill of pills()) expect(pill).toBeEnabled();
    });

    it("disables every pill in the cell the moment one is clicked", async () => {
      const user = userEvent.setup();
      const send = vi.fn();
      renderBar(makeSpeech({ state: "empty" }), send);

      await user.click(screen.getByRole("button", { name: "claude" }));

      // The launch itself is unchanged — one send, the command and its return.
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith("claude\r");

      // …and the whole row goes quiet, not just the pill that was pressed:
      // `codex` would type into claude's prompt exactly as `claude` would.
      expect(pills()).toHaveLength(3);
      for (const pill of pills()) expect(pill).toBeDisabled();
    });

    it("sends nothing when a spent pill is clicked again", async () => {
      const user = userEvent.setup();
      const send = vi.fn();
      renderBar(makeSpeech({ state: "empty" }), send);

      await user.click(screen.getByRole("button", { name: "claude" }));
      send.mockClear();

      // Both routes to the handler: the pointer a user actually has, and a
      // click dispatched straight at the node — which is what a listener left
      // live behind a `disabled` attribute would still answer.
      await user.click(screen.getByRole("button", { name: "claude" }));
      await user.click(screen.getByRole("button", { name: "codex" }));
      fireEvent.click(screen.getByRole("button", { name: "claude" }));

      expect(send).not.toHaveBeenCalled();
    });

    it("leaves a second cell's pills alone", async () => {
      const user = userEvent.setup();
      const sendA = vi.fn();
      const sendB = vi.fn();
      render(
        <>
          {bar(makeSpeech({ state: "empty" }), sendA, "cell-a")}
          {bar(makeSpeech({ state: "empty" }), sendB, "cell-b")}
        </>,
      );

      await user.click(screen.getAllByRole("button", { name: "claude" })[0]);

      // The fact is the SESSION's. Keyed globally — one flag for the panel —
      // launching in one cell would silence every other cell's row, and the
      // second terminal a user opens would arrive with no way to start
      // anything in it.
      for (const pill of pills("cell-a")) expect(pill).toBeDisabled();
      expect(pills("cell-b")).toHaveLength(3);
      for (const pill of pills("cell-b")) expect(pill).toBeEnabled();

      await user.click(screen.getAllByRole("button", { name: "codex" })[1]);
      expect(sendB).toHaveBeenCalledTimes(1);
      expect(sendB).toHaveBeenCalledWith("codex\r");
      expect(sendA).toHaveBeenCalledTimes(1);
    });

    it("dims a spent pill in the stylesheet's own disabled vocabulary", () => {
      // jsdom loads no stylesheet, so `getComputedStyle` would answer for a
      // rule it never saw. `cssRule` reads the declaration block out of
      // `index.css`, throws when the selector matches nothing, and refuses to
      // guess when it matches more than one — which is what keeps a rename
      // from turning this into an assertion about nothing.
      const spent = cssRule(".speech-bar-launch[disabled]");

      // design.md's own disabled control: `.btn[disabled] { opacity: .3;
      // cursor: default }`. Visible and greyed, never gone — the row's height
      // is the thing that must not move.
      expect(spent).toMatch(/(^|;)\s*opacity:\s*0?\.3\s*(;|$)/);
      expect(spent).toMatch(/(^|;)\s*cursor:\s*default\s*(;|$)/);

      // And the hover lift is withheld from it: a pill that still lit up under
      // the pointer would read as pressable however faint it was.
      expect(cssRule(".speech-bar-launch:hover:not([disabled])")).toMatch(/background/);
    });
  });
});
