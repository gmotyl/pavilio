/**
 * The composer at the foot of the answer pane: a text field that writes to the
 * cell's own PTY.
 *
 * Everything here is asserted through `AnswerPane`, not against the composer in
 * isolation, and that is deliberate. Three of the six criteria are about the
 * composer's PLACE rather than its behavior — Escape is stopped by the pane's
 * root, the switch that unmounts it sits in the pane's meta row, and the grip is
 * the pane's own bottom row — so a harness that rendered the field alone would
 * be pinning a component no user ever meets. The pane's other half stays out of
 * the way: an empty queue means no utterance under the cursor, so the markdown
 * renderer is never mounted and the body is empty.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MOBILE_QUERY } from "../../../lib/breakpoints";
import { preferences } from "../../../preferences/declarations";
import { writePreference } from "../../../preferences/store";
import type { GridSpeech, SpeechUnit } from "../../speech/types";
import { emptyUtteranceQueue } from "../../speech/utteranceQueue";
import { AnswerPane } from "../AnswerPane";

// The synthesis cache the rail peeks into. Nothing is warm and nothing
// subscribes: this file draws no units at all.
vi.mock("../../speech/synth", () => ({
  isSpeechSynthesized: () => false,
  speechCacheState: () => "cold",
  subscribeSpeechCache: () => () => {},
}));

/** Referentially stable — a fresh array per call is a `useSyncExternalStore` loop. */
const NO_UNITS: readonly SpeechUnit[] = Object.freeze([]);
const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();

function makeSpeech(): GridSpeech {
  return {
    stateFor: () => "ready",
    queueFor: () => emptyUtteranceQueue,
    unitsFor: () => NO_UNITS,
    subscribeProgress: () => () => {},
    progressFor: () => null,
    unitDurationsFor: () => NO_DURATIONS,
    armedSessionId: null,
    onSpeak: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onArm: vi.fn(),
    onJumpToUnit: vi.fn(),
    onSeekWithinUnit: vi.fn(),
  } satisfies GridSpeech;
}

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/**
 * jsdom has no `matchMedia`, and the grip's hook asks it whether this is a
 * touch viewport. Installed before every render so both verdicts go down the
 * same path rather than one of them being "the API was missing".
 */
function installMatchMedia(mobile: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: mobile && query === MOBILE_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

const send = vi.fn();
const onClose = vi.fn();
/** An ancestor of the pane — the cell, as far as a bubbling key is concerned. */
const cellKeys = vi.fn();
/** Everything that got past the React root: the window-level reach. */
const documentKeys = vi.fn();

function renderPane() {
  return render(
    <div data-testid="cell" onKeyDown={cellKeys}>
      <AnswerPane
        sessionId="cell-a"
        speech={makeSpeech()}
        onClose={onClose}
        send={send}
        autoOpen={false}
        onAutoOpenChange={() => {}}
      />
    </div>,
  );
}

const field = (): HTMLTextAreaElement =>
  screen.getByTestId("answer-pane-composer-cell-a") as HTMLTextAreaElement;

const maybeField = (): HTMLElement | null =>
  screen.queryByTestId("answer-pane-composer-cell-a");

const grip = (): HTMLElement | null => screen.queryByTestId("pane-resize-composer");

const composerSwitch = (): HTMLInputElement =>
  screen.getByTestId("answer-pane-composer-on-cell-a") as HTMLInputElement;

beforeEach(() => {
  send.mockClear();
  onClose.mockClear();
  cellKeys.mockClear();
  documentKeys.mockClear();
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  installMatchMedia(false);
});

describe("AnswerComposer", () => {
  it("sends the field's contents with a trailing return on Enter", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("yes, both scopes");
    await user.keyboard("{Enter}");

    // Once, and with the return that runs it — a send without the `\r` leaves
    // the agent waiting on a line that was never submitted.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("yes, both scopes\r");
  });

  it("clears the field after sending", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("ship it");
    expect(field().value).toBe("ship it");

    await user.keyboard("{Enter}");

    // Emptied, and emptied by the send rather than by a newline the browser
    // would otherwise have inserted: Enter is the send key, so it never types.
    expect(field().value).toBe("");
  });

  it("inserts a newline on Shift+Enter without sending", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("first line");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.keyboard("second line");

    // The real newline the textarea's own default behavior put there —
    // user-event only applies it because nothing called `preventDefault`.
    expect(field().value).toBe("first line\nsecond line");
    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing when the field is empty", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("{Enter}");
    // Whitespace is empty too: a bare return would reach the agent as a prompt
    // with nothing in it.
    await user.keyboard("   ");
    await user.keyboard("{Enter}");

    expect(send).not.toHaveBeenCalled();
  });

  it("closes the pane on Escape without reaching the terminal", async () => {
    const user = userEvent.setup();
    renderPane();
    document.addEventListener("keydown", documentKeys);

    try {
      await user.click(field());
      await user.keyboard("{Escape}");

      // Two claims, and the second is the one a "did it close" test would miss:
      // the key is stopped inside the pane, so neither the cell around it nor
      // anything listening past the React root — the TUI's own handlers — ever
      // sees the Escape.
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(cellKeys).not.toHaveBeenCalled();
      expect(documentKeys).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", documentKeys);
    }
  });

  it("unmounts the composer and its grip when the switch is off", async () => {
    const user = userEvent.setup();
    renderPane();

    // On as the pane ships, grip and all.
    expect(composerSwitch()).toBeChecked();
    expect(maybeField()).toBeInTheDocument();
    expect(grip()).toBeInTheDocument();

    await user.click(composerSwitch());

    expect(composerSwitch()).not.toBeChecked();
    expect(maybeField()).toBeNull();
    expect(grip()).toBeNull();
  });

  it("drops the grip and uses a single row on a narrow viewport", () => {
    installMatchMedia(true);
    writePreference(preferences.answerComposerHeight, 140);
    renderPane();

    // No grip: an 8px rail on a phone sits under the thumb that is scrolling
    // the pane it borders.
    expect(grip()).toBeNull();
    // And one row, laid out by the viewport rather than by the stored height.
    expect(field().rows).toBe(1);
    expect(field().closest(".answer-pane-composer")).not.toHaveStyle({ height: "140px" });
  });

  it("opens at the height the grip last left behind", () => {
    writePreference(preferences.answerComposerHeight, 140);
    renderPane();

    expect(grip()).toBeInTheDocument();
    expect(field().closest(".answer-pane-composer")).toHaveStyle({ height: "140px" });
    expect(grip()).toHaveAttribute("aria-valuenow", "140");
  });
});
