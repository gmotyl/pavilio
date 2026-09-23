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
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

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

/** Every pill on the row, in order, read by its label. */
function pillLabels(): string[] {
  return screen
    .queryAllByTestId(/^speech-bar-launch-cell-a-/)
    .map((pill) => pill.textContent ?? "");
}

function renderBar(speech: GridSpeech, send: (data: string) => void) {
  return render(
    <SpeechControlBar
      sessionId="cell-a"
      speech={speech}
      answerOpen={false}
      onToggleAnswer={() => {}}
      send={send}
    />,
  );
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
});
