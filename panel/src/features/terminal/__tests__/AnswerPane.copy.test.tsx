/**
 * Copy as Markdown: one button in the pane's corner that puts the answer's
 * SOURCE on the clipboard — the `#`, the `[text](url)` and the fences intact —
 * rather than whatever the rendered prose would select as.
 *
 * The clipboard helper is mocked so the test reads exactly what the button
 * handed it; the host is a stub, the units real `prepare()` output.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GridSpeech } from "../../speech/types";
import { prepare } from "../../speech/prepare";
import {
  emptyUtteranceQueue,
  utteranceQueueReducer,
  type UtteranceQueue,
} from "../../speech/utteranceQueue";
import { AnswerPane } from "../AnswerPane";
import { __resetAnswerWaitingForTests, beginWaiting } from "../answerWaiting";

const copyToClipboard = vi.fn(async (_text: string) => true);
vi.mock("../../../lib/clipboard", () => ({
  copyToClipboard: (text: string) => copyToClipboard(text),
}));

vi.mock("../../markdown/MermaidDiagram", () => ({
  default: ({ chart }: { chart: string }) => <div data-testid="mermaid">{chart}</div>,
}));

vi.mock("../../speech/synth", () => ({
  isSpeechSynthesized: () => false,
  speechCacheState: () => "cold",
  subscribeSpeechCache: () => () => {},
}));

/** A heading, a link and a fence: the three things a rendered copy would lose. */
const MARKDOWN = [
  "# Deploy plan",
  "",
  "Read [the deploy guide](https://example.com/deploy) before the migration starts.",
  "",
  "```ts",
  "const x = 1;",
  "```",
  "",
].join("\n");

function makeSpeech(): GridSpeech {
  const queue: UtteranceQueue = utteranceQueueReducer(emptyUtteranceQueue, {
    type: "arrived",
    utterance: { id: "u-1", sessionId: "cell-a", text: MARKDOWN, at: 1 },
    speaking: false,
  });
  const units = prepare(MARKDOWN).units;
  return {
    stateFor: vi.fn(() => "ready" as const),
    queueFor: vi.fn(() => queue),
    heardFor: () => new Set<string>(),
    unitsFor: vi.fn(() => units),
    subscribeProgress: () => () => {},
    progressFor: vi.fn(() => null),
    unitDurationsFor: vi.fn(() => new Map<number, number>()),
    speechModeOf: () => "off",
    onSpeak: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onNewestAnswer: vi.fn(),
    cycleSpeechMode: vi.fn(),
    onJumpToUnit: vi.fn(),
    onSeekWithinUnit: vi.fn(),
  } satisfies GridSpeech;
}

function renderPane(speech: GridSpeech) {
  return render(
    <MemoryRouter>
      <AnswerPane sessionId="cell-a" speech={speech} onClose={() => {}} send={() => true} />
    </MemoryRouter>,
  );
}

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  copyToClipboard.mockClear();
});

afterEach(() => {
  // Unmount first: resetting the wait re-renders a mounted pane, and its
  // ResizeObserver effect would then run after the stub below is gone.
  cleanup();
  __resetAnswerWaitingForTests();
  vi.unstubAllGlobals();
});

describe("AnswerPane Copy as Markdown", () => {
  it("copies the answer's source Markdown", async () => {
    const speech = makeSpeech();
    renderPane(speech);

    const button = screen.getByRole("button", { name: "Copy answer as Markdown" });
    // Outside the scrolling text, so it stays put in the corner.
    expect(screen.getByTestId("answer-pane-body-cell-a")).not.toContainElement(button);

    await act(async () => {
      fireEvent.click(button);
    });

    expect(copyToClipboard).toHaveBeenCalledTimes(1);
    expect(copyToClipboard).toHaveBeenCalledWith(MARKDOWN);
    // Copying is never also a request to read.
    expect(speech.onJumpToUnit).not.toHaveBeenCalled();
    expect(speech.onSpeak).not.toHaveBeenCalled();
    expect(speech.onResume).not.toHaveBeenCalled();
    expect(speech.onSeekWithinUnit).not.toHaveBeenCalled();
  });

  it("no copy-all while waiting", () => {
    const speech = makeSpeech();
    renderPane(speech);
    expect(screen.getByRole("button", { name: "Copy answer as Markdown" })).toBeInTheDocument();

    act(() => beginWaiting("cell-a", "u-1"));

    expect(screen.queryByRole("button", { name: "Copy answer as Markdown" })).toBeNull();
  });
});
