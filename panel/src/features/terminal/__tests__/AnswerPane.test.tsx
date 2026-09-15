/**
 * The answer pane — the card under the speech bar that renders the utterance
 * under the cursor as markdown, with the spoken block marked and a rail of
 * unit segments beside the text.
 *
 * The units are real `prepare()` output and the blocks are real react-markdown
 * output, so the mapping under test is the one the product runs: a heading
 * unit finds its `h1`, a paragraph unit its `p`, and a code fence — a sentinel
 * in speech — finds nothing and stays inert. The host is a stub whose progress
 * store is driven by hand, which is what lets the "nothing re-renders inside a
 * unit" test notify with the same index and count.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GridSpeech, SpeechUnit, Utterance } from "../../speech/types";
import { prepare } from "../../speech/prepare";
import type { SpeechProgress } from "../../speech/useSpeechPlayer";
import {
  emptyUtteranceQueue,
  utteranceQueueReducer,
  type UtteranceQueue,
} from "../../speech/utteranceQueue";
import { segmentStateFor } from "../segmentState";
import { AnswerPane } from "../AnswerPane";

// mermaid pulls in a browser-only rendering stack; what matters here is that
// the fence reaches the diagram component, not what mermaid draws.
vi.mock("../../markdown/MermaidDiagram", () => ({
  default: ({ chart }: { chart: string }) => <div data-testid="mermaid">{chart}</div>,
}));

/** How many times the body's markdown has been rendered — the real renderer, counted. */
const bodyRenders = vi.hoisted(() => ({ count: 0 }));

vi.mock("../../markdown/MarkdownRenderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../markdown/MarkdownRenderer")>();
  const Actual = actual.default;
  return {
    default: (props: React.ComponentProps<typeof Actual>) => {
      bodyRenders.count += 1;
      return <Actual {...props} />;
    },
  };
});

/**
 * The synthesis cache the rail peeks into, made writable — the same stand-in
 * `SpeechControlBar.test.tsx` uses, because the rail draws the scrubber's
 * states from the same cache.
 */
const warm = vi.hoisted(() => new Set<string>());
const warming = vi.hoisted(() => new Set<string>());
const cacheListeners = vi.hoisted(() => new Set<() => void>());

vi.mock("../../speech/synth", () => ({
  isSpeechSynthesized: (text: string) => warm.has(text) || warming.has(text),
  speechCacheState: (text: string) =>
    warm.has(text) ? "ready" : warming.has(text) ? "warming" : "cold",
  subscribeSpeechCache: (listener: () => void) => {
    cacheListeners.add(listener);
    return () => {
      cacheListeners.delete(listener);
    };
  },
}));

const MARKDOWN = [
  "# Deploy plan",
  "",
  "The first paragraph explains why the deploy has to wait for the database migration to finish before any traffic is switched over to the new pods.",
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

const OTHER_MARKDOWN = [
  "# Other",
  "",
  "A completely different answer about something else entirely, long enough to be one unit on its own.",
  "",
].join("\n");

const utterance = (id: string, text: string): Utterance => ({
  id,
  sessionId: "cell-a",
  text,
  at: 1,
});

const arrived = (queue: UtteranceQueue, u: Utterance): UtteranceQueue =>
  utteranceQueueReducer(queue, { type: "arrived", utterance: u, speaking: false });

/**
 * A progress store driven by hand. `notify` fires the listeners the way the
 * host does on every `timeupdate`; whether the pane re-renders is then up to
 * the snapshot it takes.
 */
function makeProgressStore(initial: SpeechProgress | null) {
  const listeners = new Set<() => void>();
  let value = initial;
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    read: () => value,
    set: (next: SpeechProgress | null) => {
      value = next;
      act(() => {
        for (const listener of [...listeners]) listener();
      });
    },
    /** A tick inside the unit: same index, new time. */
    tick: () => {
      if (value) value = { ...value, unitTime: value.unitTime + 0.25 };
      act(() => {
        for (const listener of [...listeners]) listener();
      });
    },
  };
}

interface Harness {
  queue: UtteranceQueue;
  units: readonly SpeechUnit[];
  progress: ReturnType<typeof makeProgressStore>;
}

const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();

function makeSpeech(h: Harness): GridSpeech {
  return {
    stateFor: vi.fn(() => "ready" as const),
    queueFor: vi.fn(() => h.queue),
    unitsFor: vi.fn(() => h.units),
    subscribeProgress: h.progress.subscribe,
    progressFor: vi.fn(() => h.progress.read()),
    unitDurationsFor: vi.fn(() => NO_DURATIONS),
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

function harness(markdown = MARKDOWN, progress: SpeechProgress | null = null): Harness {
  return {
    queue: arrived(emptyUtteranceQueue, utterance("u-1", markdown)),
    units: prepare(markdown).units,
    progress: makeProgressStore(progress),
  };
}

function paneElement(speech: GridSpeech, onClose: () => void = () => {}) {
  // MarkdownRenderer calls useNavigate, so the body needs a router.
  return (
    <MemoryRouter>
      <AnswerPane sessionId="cell-a" speech={speech} onClose={onClose} />
    </MemoryRouter>
  );
}

const prose = (): HTMLElement => {
  const element = screen.getByTestId("answer-pane-body-cell-a").querySelector(".prose");
  if (!(element instanceof HTMLElement)) throw new Error("no .prose in the body");
  return element;
};

const blocks = (): HTMLElement[] => Array.from(prose().children) as HTMLElement[];

/**
 * By tag, not by role: a matched heading carries `role="button"` (it is a
 * jump), so the `heading` role is no longer what it exposes. The contract's
 * criterion is the element — `# Heading` becomes an `h1`.
 */
const h1 = (): HTMLElement => {
  const element = prose().querySelector("h1");
  if (!(element instanceof HTMLElement)) throw new Error("no h1 in the body");
  return element;
};

const speaking = (): HTMLElement[] => blocks().filter((block) => block.hasAttribute("data-speaking"));

const segment = (index: number): HTMLElement =>
  screen.getByTestId(`answer-pane-seg-cell-a-${index}`);

/**
 * jsdom has no layout, and the follow step is nothing but layout: "does the
 * body overflow", "where is the block". So this file installs the one layout
 * the pane needs, as prototype getters, BEFORE the pane mounts — the mount-time
 * scroll reads them in the same commit that creates the blocks, so stubbing
 * the elements afterwards would be too late.
 *
 * The rule: the k-th direct child of `.prose` sits at `k * BLOCK_TOP` and is
 * `BLOCK_HEIGHT` tall; everything else is at 0 with no height. The body's
 * `scrollHeight` / `clientHeight` are whatever the test says in `layout`.
 */
const BLOCK_TOP = 100;
const BLOCK_HEIGHT = 80;
const layout = { scrollHeight: 0, clientHeight: 0 };
const scrollTo = vi.fn();
/** What the pane's ResizeObserver was asked to watch. */
const observed: Element[] = [];

class StubResizeObserver {
  observe(element: Element): void {
    observed.push(element);
  }
  unobserve(): void {}
  disconnect(): void {}
}

const blockIndexOf = (element: Element): number | null => {
  const parent = element.parentElement;
  if (!parent?.classList.contains("prose")) return null;
  return Array.prototype.indexOf.call(parent.children, element);
};

const isBody = (element: Element): boolean => element.classList.contains("answer-pane-body");

type Descriptors = Record<string, PropertyDescriptor | undefined>;
const saved: { element: Descriptors; html: Descriptors } = { element: {}, html: {} };

function installLayout(): void {
  for (const name of ["scrollHeight", "clientHeight", "scrollTo"]) {
    saved.element[name] = Object.getOwnPropertyDescriptor(Element.prototype, name);
  }
  for (const name of ["offsetTop", "offsetHeight"]) {
    saved.html[name] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
  }
  Object.defineProperty(Element.prototype, "scrollHeight", {
    configurable: true,
    get(this: Element) {
      return isBody(this) ? layout.scrollHeight : 0;
    },
  });
  Object.defineProperty(Element.prototype, "clientHeight", {
    configurable: true,
    get(this: Element) {
      return isBody(this) ? layout.clientHeight : 0;
    },
  });
  Object.defineProperty(Element.prototype, "scrollTo", {
    configurable: true,
    writable: true,
    value: scrollTo,
  });
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
}

function restoreLayout(): void {
  const restore = (target: object, descriptors: Descriptors): void => {
    for (const [name, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(target, name, descriptor);
      else delete (target as Record<string, unknown>)[name];
    }
  };
  restore(Element.prototype, saved.element);
  restore(HTMLElement.prototype, saved.html);
}

/** The body overflows: three screens of text in one. */
const overflowing = (): void => {
  layout.scrollHeight = 2000;
  layout.clientHeight = 300;
};

/** The body fits: nothing to scroll. */
const fitting = (): void => {
  layout.scrollHeight = 300;
  layout.clientHeight = 300;
};

const body = (): HTMLElement => screen.getByTestId("answer-pane-body-cell-a");

/** Every `scrollTo` the body received, as its `top`. */
const scrolls = (): number[] =>
  scrollTo.mock.calls
    .filter((_, callIndex) => scrollTo.mock.contexts[callIndex] === body())
    .map(([options]) => (options as ScrollToOptions).top ?? Number.NaN);

/** A unit no block was rendered from — what a sentinel-only paragraph leaves behind. */
const GHOST: SpeechUnit = {
  text: "nothing on the screen was ever spoken like this",
  chars: 47,
  source: "nothing on the screen was ever spoken like this",
};

const box = (index: number): { top: number; height: number } => ({
  top: Number.parseFloat(segment(index).style.top),
  height: Number.parseFloat(segment(index).style.height),
});

beforeEach(() => {
  warm.clear();
  warming.clear();
  cacheListeners.clear();
  bodyRenders.count = 0;
  scrollTo.mockClear();
  observed.length = 0;
  fitting();
  installLayout();
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
});

afterEach(() => {
  restoreLayout();
  vi.unstubAllGlobals();
});

describe("AnswerPane", () => {
  it("renders the utterance under the cursor as markdown", async () => {
    const fence = ["# Flow", "", "```mermaid", "flowchart TD", "  A --> B", "```", ""].join("\n");
    const h = harness(fence);
    render(paneElement(makeSpeech(h)));

    const pane = screen.getByTestId("answer-pane-cell-a");
    expect(pane).toHaveAttribute("role", "region");
    expect(pane).toHaveAttribute("aria-label", "Answer");
    expect(document.activeElement).toBe(pane);

    expect(h1()).toHaveTextContent("Flow");
    expect((await screen.findByTestId("mermaid")).textContent).toBe("flowchart TD\n  A --> B");
  });

  it("one rail segment per unit in the scrubber's states", () => {
    const h = harness(MARKDOWN, { unitIndex: 1, unitTime: 0, unitDuration: null });
    expect(h.units).toHaveLength(3);
    warm.add(h.units[2].text);
    render(paneElement(makeSpeech(h)));

    expect(screen.queryAllByTestId(/^answer-pane-seg-cell-a-/)).toHaveLength(3);
    h.units.forEach((unit, index) => {
      const expected = segmentStateFor({
        index,
        playingIndex: 1,
        cache: warm.has(unit.text) ? "ready" : "cold",
      });
      expect(segment(index)).toHaveAttribute("data-segment", expected);
    });
    expect(segment(0)).toHaveAttribute("data-segment", "played");
    expect(segment(1)).toHaveAttribute("data-segment", "playing");
    expect(segment(2)).toHaveAttribute("data-segment", "ready");
  });

  it("marks the spoken block and parks the playhead beside its segment", () => {
    const h = harness(MARKDOWN, { unitIndex: 1, unitTime: 0, unitDuration: null });
    render(paneElement(makeSpeech(h)));

    const marked = speaking();
    expect(marked).toHaveLength(1);
    expect(marked[0].tagName).toBe("P");
    expect(marked[0]).toHaveTextContent(/^The first paragraph/);
    expect(marked[0]).toHaveAttribute("data-unit", "1");

    const head = screen.getByTestId("answer-pane-head-cell-a");
    expect(segment(1).contains(head)).toBe(true);
    expect(segment(0).contains(head)).toBe(false);
  });

  it("the mark moves with the unit index and nothing re-renders inside a unit", () => {
    const h = harness(MARKDOWN, { unitIndex: 0, unitTime: 0, unitDuration: null });
    render(paneElement(makeSpeech(h)));

    expect(speaking().map((b) => b.tagName)).toEqual(["H1"]);
    const proseBefore = prose();
    const rendersBefore = bodyRenders.count;

    // Four ticks inside unit 0 — what `timeupdate` does at ~4 Hz.
    h.progress.tick();
    h.progress.tick();
    h.progress.tick();
    h.progress.tick();
    expect(bodyRenders.count).toBe(rendersBefore);
    expect(prose()).toBe(proseBefore);
    expect(speaking().map((b) => b.tagName)).toEqual(["H1"]);

    // The unit boundary: the mark moves to unit 2's two paragraphs.
    h.progress.set({ unitIndex: 2, unitTime: 0, unitDuration: null });
    const marked = speaking();
    expect(marked.map((b) => b.tagName)).toEqual(["P", "P"]);
    expect(marked[0]).toHaveTextContent(/^The second paragraph/);
    expect(marked[1]).toHaveTextContent(/^The third paragraph/);
    expect(segment(2).contains(screen.getByTestId("answer-pane-head-cell-a"))).toBe(true);
    // The text itself was not rebuilt.
    expect(prose()).toBe(proseBefore);
  });

  it("another cell's run marks nothing here", () => {
    // `progressFor` answers null for every cell but the one running.
    const h = harness(MARKDOWN, null);
    render(paneElement(makeSpeech(h)));

    expect(speaking()).toHaveLength(0);
    expect(screen.queryByTestId("answer-pane-head-cell-a")).toBeNull();
    // Still matched, still jumpable — only the mark is missing.
    expect(blocks().filter((b) => b.hasAttribute("data-unit"))).toHaveLength(4);
    for (let index = 0; index < 3; index += 1) {
      expect(segment(index)).toHaveAttribute("data-segment", "cold");
    }
  });

  it("a block click and a segment click both jump to the unit", () => {
    const h = harness(MARKDOWN, null);
    const speech = makeSpeech(h);
    render(paneElement(speech));

    fireEvent.click(h1());
    expect(speech.onJumpToUnit).toHaveBeenLastCalledWith("cell-a", 0);

    // The third paragraph is the second block of unit 2.
    fireEvent.click(screen.getByText(/^The third paragraph/));
    expect(speech.onJumpToUnit).toHaveBeenLastCalledWith("cell-a", 2);

    fireEvent.click(segment(1));
    expect(speech.onJumpToUnit).toHaveBeenLastCalledWith("cell-a", 1);
    expect(speech.onJumpToUnit).toHaveBeenCalledTimes(3);
  });

  it("Enter on a focused block jumps", () => {
    const h = harness(MARKDOWN, null);
    const speech = makeSpeech(h);
    render(paneElement(speech));

    const block = screen.getByText(/^The first paragraph/);
    expect(block).toHaveAttribute("role", "button");
    expect(block).toHaveAttribute("tabindex", "0");
    block.focus();
    expect(document.activeElement).toBe(block);

    fireEvent.keyDown(block, { key: "Enter" });
    expect(speech.onJumpToUnit).toHaveBeenLastCalledWith("cell-a", 1);

    // Space too, and it must not scroll the body.
    const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    act(() => {
      block.dispatchEvent(space);
    });
    expect(space.defaultPrevented).toBe(true);
    expect(speech.onJumpToUnit).toHaveBeenCalledTimes(2);
  });

  it("a code block is inert", () => {
    const h = harness(MARKDOWN, { unitIndex: 2, unitTime: 0, unitDuration: null });
    const speech = makeSpeech(h);
    render(paneElement(speech));

    const pre = blocks().find((block) => block.tagName === "PRE");
    expect(pre).toBeDefined();
    expect(pre).not.toHaveAttribute("data-unit");
    expect(pre).not.toHaveAttribute("role");
    expect(pre).not.toHaveAttribute("tabindex");
    // Unit 2 was packed from the two paragraphs after the fence, not the fence.
    expect(pre).not.toHaveAttribute("data-speaking");

    fireEvent.click(pre!);
    fireEvent.keyDown(pre!, { key: "Enter" });
    expect(speech.onJumpToUnit).not.toHaveBeenCalled();
  });

  it("Escape closes", () => {
    const h = harness(MARKDOWN, null);
    const onClose = vi.fn();
    render(paneElement(makeSpeech(h), onClose));

    // From the root, where focus lands on open…
    fireEvent.keyDown(screen.getByTestId("answer-pane-cell-a"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    // …and from a block deep inside the text.
    fireEvent.keyDown(screen.getByText(/^The first paragraph/), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);

    // Other keys are not Escape.
    fireEvent.keyDown(screen.getByTestId("answer-pane-cell-a"), { key: "Enter" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("gestures inside the pane never reach the cell", () => {
    const h = harness(MARKDOWN, null);
    const speech = makeSpeech(h);
    const cell = { mouseDown: vi.fn(), click: vi.fn(), dragStart: vi.fn() };

    // The cell is the pane's parent: its header is `draggable` and its root
    // focuses on click, so anything that escaped the pane would move a cell or
    // steal focus from the text.
    render(
      <MemoryRouter>
        <div onMouseDown={cell.mouseDown} onClick={cell.click} onDragStart={cell.dragStart}>
          <AnswerPane sessionId="cell-a" speech={speech} onClose={() => {}} />
        </div>
      </MemoryRouter>,
    );

    const heading = h1();
    fireEvent.mouseDown(heading);
    fireEvent.click(heading);
    fireEvent.dragStart(heading);
    fireEvent.mouseDown(segment(1));
    fireEvent.click(segment(1));
    fireEvent.mouseDown(screen.getByTestId("answer-pane-cell-a"));

    expect(cell.mouseDown).not.toHaveBeenCalled();
    expect(cell.click).not.toHaveBeenCalled();
    expect(cell.dragStart).not.toHaveBeenCalled();
    // The clicks still did their own work inside the pane.
    expect(speech.onJumpToUnit).toHaveBeenCalledWith("cell-a", 0);
    expect(speech.onJumpToUnit).toHaveBeenCalledWith("cell-a", 1);
  });

  it("a new utterance swaps the text in place", () => {
    const h = harness(MARKDOWN, { unitIndex: 1, unitTime: 0, unitDuration: null });
    const speech = makeSpeech(h);
    const view = render(paneElement(speech));

    const paneBefore = screen.getByTestId("answer-pane-cell-a");
    expect(h1()).toHaveTextContent("Deploy plan");
    expect(screen.queryAllByTestId(/^answer-pane-seg-cell-a-/)).toHaveLength(3);

    // The host's queue takes the arrival as `current`; the run that was on
    // is over, so its progress is gone too.
    h.queue = arrived(h.queue, utterance("u-2", OTHER_MARKDOWN));
    h.units = prepare(OTHER_MARKDOWN).units;
    h.progress.set(null);
    view.rerender(paneElement(speech));

    expect(screen.getByTestId("answer-pane-cell-a")).toBe(paneBefore);
    expect(h1()).toHaveTextContent("Other");
    expect(screen.queryByText(/^The first paragraph/)).toBeNull();
    expect(screen.queryAllByTestId(/^answer-pane-seg-cell-a-/)).toHaveLength(2);
    expect(speaking()).toHaveLength(0);
    // The new text is matched afresh: heading and paragraph, both jumpable.
    expect(blocks().filter((b) => b.hasAttribute("data-unit")).map((b) => b.tagName)).toEqual([
      "H1",
      "P",
    ]);
  });

  /**
   * Following the voice. The pane moves at ONE moment — the unit boundary —
   * and only when there is somewhere to move to. Inside a unit nothing moves,
   * and a reader who scrolled ahead is left alone until the next unit starts.
   */
  describe("following", () => {
    it("scrolls once to the new unit when the text overflows", () => {
      overflowing();
      const h = harness(MARKDOWN, null);
      render(paneElement(makeSpeech(h)));
      // Nothing is playing: nothing to follow.
      expect(scrolls()).toEqual([]);

      // Unit 0 is the heading, block 0 at the top: a third of a screen above
      // it is off the top, so the target clamps at 0.
      h.progress.set({ unitIndex: 0, unitTime: 0, unitDuration: null });
      expect(scrolls()).toEqual([0]);

      // Unit 2 starts at block 3 (h1, p, pre, p, p): 300 − 300 / 3.
      h.progress.set({ unitIndex: 2, unitTime: 0, unitDuration: null });
      expect(scrolls()).toEqual([0, 3 * BLOCK_TOP - layout.clientHeight / 3]);
      expect(scrollTo).toHaveBeenCalledTimes(2);
    });

    it("does not scroll when the answer fits", () => {
      fitting();
      const h = harness(MARKDOWN, { unitIndex: 0, unitTime: 0, unitDuration: null });
      render(paneElement(makeSpeech(h)));

      h.progress.set({ unitIndex: 1, unitTime: 0, unitDuration: null });
      h.progress.set({ unitIndex: 2, unitTime: 0, unitDuration: null });
      expect(scrollTo).not.toHaveBeenCalled();
    });

    it("does not scroll again inside a unit", () => {
      overflowing();
      const h = harness(MARKDOWN, { unitIndex: 1, unitTime: 0, unitDuration: null });
      render(paneElement(makeSpeech(h)));
      expect(scrolls()).toEqual([BLOCK_TOP - layout.clientHeight / 3]);

      // Four ticks inside the unit, and the reader scrolling by hand: neither
      // is a reason to move.
      h.progress.tick();
      h.progress.tick();
      fireEvent.scroll(body());
      h.progress.tick();
      h.progress.tick();
      expect(scrollTo).toHaveBeenCalledTimes(1);
    });

    it("opening mid-run lands on the spoken block", () => {
      overflowing();
      // Unit 2 is already playing when the eye opens the pane.
      const h = harness(MARKDOWN, { unitIndex: 2, unitTime: 0, unitDuration: null });
      render(paneElement(makeSpeech(h)));

      expect(scrolls()).toEqual([3 * BLOCK_TOP - layout.clientHeight / 3]);
      expect(speaking().map((b) => b.tagName)).toEqual(["P", "P"]);
    });

    it("a unit without a block scrolls nothing and keeps a minimum segment", () => {
      overflowing();
      const h = harness(MARKDOWN, { unitIndex: 1, unitTime: 0, unitDuration: null });
      // A ghost between the heading and the first paragraph: spoken, never drawn.
      h.units = [h.units[0], GHOST, h.units[1], h.units[2]];
      render(paneElement(makeSpeech(h)));

      expect(scrollTo).not.toHaveBeenCalled();
      expect(speaking()).toHaveLength(0);
      expect(screen.queryAllByTestId(/^answer-pane-seg-cell-a-/)).toHaveLength(4);

      // The rail is laid out from the blocks: the heading's segment spans the
      // heading, the ghost gets 8px right after it, and the rest follow their
      // blocks — unit 3 spanning its two paragraphs (blocks 3 and 4).
      expect(box(0)).toEqual({ top: 0, height: BLOCK_HEIGHT });
      expect(box(1).height).toBe(8);
      expect(box(1).top).toBeGreaterThanOrEqual(box(0).top + box(0).height);
      expect(box(2)).toEqual({ top: BLOCK_TOP, height: BLOCK_HEIGHT });
      expect(box(3)).toEqual({ top: 3 * BLOCK_TOP, height: BLOCK_TOP + BLOCK_HEIGHT });
      // The ghost's segment still says what it is.
      expect(segment(1)).toHaveAttribute("data-segment", "playing");

      // Re-laid when the body's box changes — the observer watches the body,
      // never the xterm container.
      expect(observed).toContain(body());
    });
  });
});
