/**
 * Reading starts from a Play button, and the answer's text is just text.
 *
 * The pane used to resolve a click anywhere in a spoken block — a link
 * included — to a jump, so a link inside an answer could not be followed
 * without the voice starting to read from there too. Now each unit has a real
 * `<button>` in the rail column, laid out from the same geometry as its rail
 * segment, and the blocks carry no role, no tab stop and no handler.
 *
 * The units are real `prepare()` output and the blocks real react-markdown
 * output, as in `AnswerPane.test.tsx`; the host is a stub.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CellSpeechState, GridSpeech, SpeechUnit } from "../../speech/types";
import { prepare } from "../../speech/prepare";
import type { SpeechProgress } from "../../speech/useSpeechPlayer";
import {
  emptyUtteranceQueue,
  utteranceQueueReducer,
  type UtteranceQueue,
} from "../../speech/utteranceQueue";
import { AnswerPane } from "../AnswerPane";

vi.mock("../../markdown/MermaidDiagram", () => ({
  default: ({ chart }: { chart: string }) => <div data-testid="mermaid">{chart}</div>,
}));

// Every unit cold, and a cache that never changes: the rail's states are
// `AnswerPane.test.tsx`'s business, not this file's.
vi.mock("../../speech/synth", () => ({
  isSpeechSynthesized: () => false,
  speechCacheState: () => "cold",
  subscribeSpeechCache: () => () => {},
}));

/** Heading (unit 0), a paragraph with a link (unit 1), a fence, and two paragraphs (unit 2). */
const MARKDOWN = [
  "# Deploy plan",
  "",
  "The first paragraph links [the deploy guide](https://example.com/deploy) and explains why the deploy has to wait for the database migration to finish.",
  "",
  "```ts",
  "const x = 1;",
  "```",
  "",
  "The second paragraph describes the rollback path in case the health checks fail after the switch, including how long the old pods stay warm.",
  "",
  "The third paragraph closes with the list of people who need to be told and the channel where the announcement goes out once everything is green.",
  "",
].join("\n");

const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();
const NOTHING_HEARD: ReadonlySet<string> = new Set<string>();

function makeSpeech(
  progress: SpeechProgress | null = null,
  state: CellSpeechState = "ready",
): { speech: GridSpeech; units: readonly SpeechUnit[] } {
  const queue: UtteranceQueue = utteranceQueueReducer(emptyUtteranceQueue, {
    type: "arrived",
    utterance: { id: "u-1", sessionId: "cell-a", text: MARKDOWN, at: 1 },
    speaking: false,
  });
  const units = prepare(MARKDOWN).units;
  const speech = {
    stateFor: vi.fn(() => state),
    queueFor: vi.fn(() => queue),
    heardFor: () => NOTHING_HEARD,
    unitsFor: vi.fn(() => units),
    subscribeProgress: () => () => {},
    progressFor: vi.fn(() => progress),
    unitDurationsFor: vi.fn(() => NO_DURATIONS),
    armedSessionId: null,
    onSpeak: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onNewestAnswer: vi.fn(),
    onArm: vi.fn(),
    onJumpToUnit: vi.fn(),
    onSeekWithinUnit: vi.fn(),
  } satisfies GridSpeech;
  return { speech, units };
}

function renderPane(speech: GridSpeech) {
  return render(
    <MemoryRouter>
      <AnswerPane sessionId="cell-a" speech={speech} onClose={() => {}} send={() => true} />
    </MemoryRouter>,
  );
}

const prose = (): HTMLElement => {
  const element = screen.getByTestId("answer-pane-body-cell-a").querySelector(".prose");
  if (!(element instanceof HTMLElement)) throw new Error("no .prose in the body");
  return element;
};

const play = (unit: number): HTMLElement => screen.getByTestId(`answer-pane-play-cell-a-${unit}`);
const plays = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-testid^='answer-pane-play-cell-a-']"));
const shown = (): number[] =>
  plays()
    .map((button, unit) => (button.hasAttribute("data-shown") ? unit : -1))
    .filter((unit) => unit >= 0);

/**
 * The one layout the pane needs, as in `AnswerPane.test.tsx`: the k-th direct
 * child of `.prose` sits at `k * BLOCK_TOP` and is `BLOCK_HEIGHT` tall.
 */
const BLOCK_TOP = 100;
const BLOCK_HEIGHT = 80;
const saved: Record<string, PropertyDescriptor | undefined> = {};

const blockIndexOf = (element: Element): number | null => {
  const parent = element.parentElement;
  if (!parent?.classList.contains("prose")) return null;
  return Array.from(parent.children).indexOf(element);
};

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  for (const name of ["offsetTop", "offsetHeight"]) {
    saved[name] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
  }
  Object.defineProperty(HTMLElement.prototype, "offsetTop", {
    configurable: true,
    get(this: HTMLElement) {
      const index = blockIndexOf(this);
      return index === null ? 0 : index * BLOCK_TOP;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return blockIndexOf(this) === null ? 0 : BLOCK_HEIGHT;
    },
  });
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
});

afterEach(() => {
  for (const [name, descriptor] of Object.entries(saved)) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  }
  vi.unstubAllGlobals();
});

describe("AnswerPane Play buttons", () => {
  it("clicking a link in a spoken block does not start playback", () => {
    const { speech } = makeSpeech();
    renderPane(speech);

    const link = screen.getByRole("link", { name: "the deploy guide" });
    // The precondition: the link sits inside a spoken block.
    expect(link.closest("[data-unit]")).toHaveAttribute("data-unit", "1");

    fireEvent.click(link);
    fireEvent.keyDown(link, { key: "Enter" });
    expect(speech.onJumpToUnit).not.toHaveBeenCalled();
  });

  it("clicking text does not start playback", () => {
    const { speech } = makeSpeech();
    renderPane(speech);

    const paragraph = screen.getByText(/^The second paragraph/);
    expect(paragraph).toHaveAttribute("data-unit", "2");
    fireEvent.click(paragraph);
    fireEvent.click(prose().querySelector("h1")!);
    expect(speech.onJumpToUnit).not.toHaveBeenCalled();

    // The text is text: no block is a button or a tab stop.
    for (const block of Array.from(prose().querySelectorAll("[data-unit]"))) {
      expect(block).not.toHaveAttribute("role");
      expect(block).not.toHaveAttribute("tabindex");
    }
  });

  it("Play beside a unit starts playback at that unit", () => {
    const { speech } = makeSpeech();
    renderPane(speech);

    expect(play(2).tagName).toBe("BUTTON");
    expect(play(2)).toHaveAccessibleName("Play from here");
    fireEvent.click(play(2));
    expect(speech.onJumpToUnit).toHaveBeenLastCalledWith("cell-a", 2);
    fireEvent.click(play(0));
    expect(speech.onJumpToUnit).toHaveBeenLastCalledWith("cell-a", 0);
    expect(speech.onJumpToUnit).toHaveBeenCalledTimes(2);

    // Beside the first line of the unit's first block: unit 1 is block 1, unit
    // 2 starts at block 3 (block 2 is the fence).
    expect(play(1).style.top).toBe(`${1 * BLOCK_TOP}px`);
    expect(play(2).style.top).toBe(`${3 * BLOCK_TOP}px`);

    // The rail segment is still a jump, as it always was.
    fireEvent.click(screen.getByTestId("answer-pane-seg-cell-a-1"));
    expect(speech.onJumpToUnit).toHaveBeenLastCalledWith("cell-a", 1);
  });

  it("Play is keyboard operable", () => {
    const { speech } = makeSpeech();
    renderPane(speech);

    // A real button: Enter and Space are the browser's, and they arrive as a
    // click — which is exactly what jsdom cannot synthesize from a keydown, so
    // the native element is the assertion and the click stands in for the key.
    const button = play(1);
    expect(button).toHaveAttribute("type", "button");
    expect(button).not.toHaveAttribute("tabindex");
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(speech.onJumpToUnit).toHaveBeenCalledWith("cell-a", 1);

    // Focus reveals it, like a hover does.
    fireEvent.focusIn(button);
    expect(shown()).toEqual([1]);
  });

  it("the playing unit's button is Pause", () => {
    const { speech } = makeSpeech({ unitIndex: 1, unitTime: 0, unitDuration: null }, "speaking");
    renderPane(speech);

    expect(play(1)).toHaveAccessibleName("Pause");
    expect(play(1)).toHaveAttribute("data-playing");
    expect(play(0)).toHaveAccessibleName("Play from here");
    expect(shown()).toEqual([1]);

    fireEvent.click(play(1));
    expect(speech.onPause).toHaveBeenCalledWith("cell-a");
    expect(speech.onJumpToUnit).not.toHaveBeenCalled();
  });

  it("hover reveals only the hovered unit's Play", () => {
    const { speech } = makeSpeech({ unitIndex: 0, unitTime: 0, unitDuration: null }, "speaking");
    renderPane(speech);
    expect(shown()).toEqual([0]);

    // Over a word inside the block, not the block itself: the delegation has
    // to find the block from whatever the pointer is over.
    fireEvent.pointerOver(screen.getByRole("link", { name: "the deploy guide" }));
    expect(shown()).toEqual([0, 1]);

    fireEvent.pointerOver(screen.getByText(/^The third paragraph/));
    expect(shown()).toEqual([0, 2]);

    // Moving onto the button itself keeps it shown rather than flickering off.
    fireEvent.pointerOver(play(2));
    expect(shown()).toEqual([0, 2]);

    // The fence is no unit's: nothing but the playing unit shows.
    fireEvent.pointerOver(prose().querySelector(".code-block")!);
    expect(shown()).toEqual([0]);

    fireEvent.pointerOver(screen.getByText(/^The second paragraph/));
    fireEvent.pointerLeave(screen.getByTestId("answer-pane-body-cell-a"));
    expect(shown()).toEqual([0]);
  });

  it("unspoken blocks have no Play", () => {
    const { speech, units } = makeSpeech();
    renderPane(speech);

    // One Play per unit, and none of them beside the fence.
    expect(plays()).toHaveLength(units.length);
    const codeBlock = prose().querySelector<HTMLElement>(".code-block");
    expect(codeBlock).not.toBeNull();
    expect(codeBlock).not.toHaveAttribute("data-unit");
    expect(codeBlock!.querySelector("[data-testid^='answer-pane-play']")).toBeNull();
    const fenceTop = `${codeBlock!.offsetTop}px`;
    for (const button of plays()) expect(button.style.top).not.toBe(fenceTop);
  });
});
