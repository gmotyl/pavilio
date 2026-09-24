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
import { cssRule } from "../../shell/__tests__/hamburgerGeometry";
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

/** The smoke test's answer: a fast-start unit and a packed one share the first paragraph. */
const SMOKE = [
  "Hi. AGENTS.md loaded; no `.projects.local.md`, so no project registry yet.",
  "",
  "Branch `feat/in-cell-answer-pane`, clean tree, last commit `c75d42d refactor(terminal): the cell reader is screen-only again`.",
  "",
  "What next — `resume <project>`, or a specific task?",
].join("\n");

const OTHER_MARKDOWN = [
  "# Other",
  "",
  "A completely different answer about something else entirely, long enough to be one unit on its own.",
  "",
].join("\n");

/**
 * A six-item list. `strip` emits every item as its own paragraph, so packing
 * cuts the list into three units — items 1-2, items 3-5, item 6 — and each
 * item is a block the pane can match, mark and jump to.
 */
const LIST_MARKDOWN = [
  "# Release checklist",
  "",
  "Before the deploy goes out the following items are checked by the person on duty, in the order they are written down here.",
  "",
  "- Confirm that the database migration has finished on every single replica before any traffic at all is moved across",
  "- Check that the health endpoint answers correctly on each of the new pods for a full minute before anything else",
  "- Warm the cache up front so that the very first requests do not time out",
  "- Tell the release channel that the switch is about to happen right now",
  "- Watch the error rate closely for ten minutes after the traffic moves",
  "- Close the change ticket once every dashboard has been green and quiet for a while, and write the summary up for the team so nobody has to guess what happened during the window",
  "",
].join("\n");

/**
 * A list item that holds a fenced block. The item is one of the voice's
 * paragraphs, so it is a matched block — and the fence inside it now carries a
 * real copy `button`, which is exactly the nesting the click path has to
 * survive.
 */
const FENCE_IN_LIST_MARKDOWN = [
  "# Deploy plan",
  "",
  "The runbook below explains the migration order that has to be followed before any traffic at all is moved across.",
  "",
  "- Run the migration on every single replica first, with exactly the command that is written out here:",
  "",
  "  ```sh",
  "  pnpm migrate --all",
  "  ```",
  "",
  "- Then watch the error rate closely for ten whole minutes after the traffic has moved across to the new pods.",
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

/** A cell that has played nothing has heard nothing — shared, like every other
 *  "nothing here" snapshot on a host. */
const NOTHING_HEARD: ReadonlySet<string> = new Set<string>();

function makeSpeech(h: Harness): GridSpeech {
  return {
    stateFor: vi.fn(() => "ready" as const),
    queueFor: vi.fn(() => h.queue),
    heardFor: () => NOTHING_HEARD,
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
    onNewestAnswer: vi.fn(),
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

/** The meta row's switch, off and inert unless a test wires it. */
const OFF = { autoOpen: false, onAutoOpenChange: () => {} };

/** The composer's PTY write. `AnswerComposer.test.tsx` is where it is spent. */
const NO_SEND = () => {};

function paneElement(speech: GridSpeech, onClose: () => void = () => {}) {
  // MarkdownRenderer calls useNavigate, so the body needs a router.
  return (
    <MemoryRouter>
      <AnswerPane sessionId="cell-a" speech={speech} onClose={onClose} send={NO_SEND} {...OFF} />
    </MemoryRouter>
  );
}

const prose = (): HTMLElement => {
  const element = screen.getByTestId("answer-pane-body-cell-a").querySelector(".prose");
  if (!(element instanceof HTMLElement)) throw new Error("no .prose in the body");
  return element;
};

/**
 * The blocks the pane matches: the direct children of `.prose`, with each list
 * replaced by its items — a list is one element to react-markdown but one
 * paragraph per item to the voice.
 */
const flatten = (parent: Element): HTMLElement[] =>
  Array.from(parent.children).flatMap((child) =>
    child.tagName === "UL" || child.tagName === "OL"
      ? (Array.from(child.children) as HTMLElement[])
      : [child as HTMLElement],
  );

const blocks = (): HTMLElement[] => flatten(prose());

/** The list's items, in document order. */
const items = (): HTMLElement[] => Array.from(prose().querySelectorAll("li"));

/**
 * Which unit an item's text was packed into, read off the harness's OWN units.
 *
 * Why not the literal indices: how many items fit in a unit is `prepare`'s
 * packing, not the pane's contract. Hard-coded expectations turn a change to
 * `UNIT_MIN_CHARS` / `UNIT_MAX_CHARS` into three failures that point at the
 * pane. This is not circular — it asks the unit's `source`, not
 * `matchUnitsToBlocks`, which is the mapping under test.
 */
const expectedUnitIn =
  (h: Harness) =>
  (item: HTMLElement): number =>
    h.units.findIndex((unit) => unit.source.includes(item.textContent ?? ""));

const list = (): HTMLElement => {
  const element = prose().querySelector("ul");
  if (!(element instanceof HTMLElement)) throw new Error("no ul in the body");
  return element;
};

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
 * The rule: the k-th matchable block of `.prose` — its direct children, lists
 * flattened to their items — sits at `k * BLOCK_TOP` and is `BLOCK_HEIGHT`
 * tall; everything else is at 0 with no height. The body's
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
  const prose = element.closest(".prose");
  if (!prose) return null;
  const index = flatten(prose).indexOf(element as HTMLElement);
  return index === -1 ? null : index;
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

    // The renderer wraps a fenced block in a `.code-block` div so the copy button
    // can sit beside the `pre`, so the matchable block is that wrapper and the
    // `pre` itself is a child of it.
    const codeBlock = blocks().find((block) => block.classList.contains("code-block"));
    expect(codeBlock).toBeDefined();
    expect(codeBlock).not.toHaveAttribute("data-unit");
    expect(codeBlock).not.toHaveAttribute("role");
    expect(codeBlock).not.toHaveAttribute("tabindex");
    // Unit 2 was packed from the two paragraphs after the fence, not the fence.
    expect(codeBlock).not.toHaveAttribute("data-speaking");

    fireEvent.click(codeBlock!);
    fireEvent.keyDown(codeBlock!, { key: "Enter" });
    expect(speech.onJumpToUnit).not.toHaveBeenCalled();
  });

  it("copying a fence inside a spoken block does not jump the voice", () => {
    const h = harness(FENCE_IN_LIST_MARKDOWN, null);
    const speech = makeSpeech(h);
    render(paneElement(speech));

    const button = screen.getByLabelText("Copy code");
    // The precondition the regression needs: the fence sits INSIDE a matched
    // block, so the pane's delegated handler would resolve a click on this
    // button to that block's unit if the click were allowed to bubble.
    const block = button.closest("[data-unit]");
    expect(block).not.toBeNull();
    expect(block!.tagName).toBe("LI");

    fireEvent.click(button);
    // Copying is not a request to be read to from here.
    expect(speech.onJumpToUnit).not.toHaveBeenCalled();
  });

  it("the meta row's checkbox reflects the cell switch and writes nothing to storage", () => {
    const h = harness();
    const onAutoOpenChange = vi.fn();
    const withSwitch = (autoOpen: boolean) => (
      <MemoryRouter>
        <AnswerPane
          sessionId="cell-a"
          speech={makeSpeech(h)}
          onClose={() => {}}
          send={NO_SEND}
          autoOpen={autoOpen}
          onAutoOpenChange={onAutoOpenChange}
        />
      </MemoryRouter>
    );
    const setItem = vi.spyOn(localStorage, "setItem");
    const removeItem = vi.spyOn(localStorage, "removeItem");

    const view = render(withSwitch(false));
    const box = screen.getByTestId("answer-pane-auto-open-cell-a") as HTMLInputElement;
    expect(box).toBe(screen.getByRole("checkbox", { name: "Open on new answer" }));
    expect(box).not.toBeChecked();
    // The meta row is a row of the pane, under the body — not inside the scroll container.
    const root = screen.getByTestId("answer-pane-cell-a");
    const body = screen.getByTestId("answer-pane-body-cell-a");
    expect(box.closest(".answer-pane-meta")?.parentElement).toBe(root);
    expect(body.contains(box)).toBe(false);

    // A click reports the flipped value to the owner and touches no storage:
    // the cell's switch is not the browser-wide default.
    fireEvent.click(box);
    expect(onAutoOpenChange).toHaveBeenCalledTimes(1);
    expect(onAutoOpenChange).toHaveBeenCalledWith(true);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();

    // Controlled: the box follows the prop, and flips the other way from on.
    view.rerender(withSwitch(true));
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(onAutoOpenChange).toHaveBeenLastCalledWith(false);
    expect(setItem).not.toHaveBeenCalled();
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
          <AnswerPane sessionId="cell-a" speech={speech} onClose={() => {}} send={NO_SEND} {...OFF} />
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

  it("Escape inside the pane does not reach the cell", () => {
    const h = harness(MARKDOWN, null);
    const onClose = vi.fn();
    const cell = { keyDown: vi.fn() };

    // The cell's key handling is the terminal's: an Escape that leaked out of
    // the pane would land in the shell as a keystroke.
    render(
      <MemoryRouter>
        <div onKeyDown={cell.keyDown}>
          <AnswerPane sessionId="cell-a" speech={makeSpeech(h)} onClose={onClose} send={NO_SEND} {...OFF} />
        </div>
      </MemoryRouter>,
    );

    fireEvent.keyDown(h1(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(cell.keyDown).not.toHaveBeenCalled();

    // Only Escape is the pane's to keep: any other key still bubbles.
    fireEvent.keyDown(h1(), { key: "a" });
    expect(cell.keyDown).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape closes the pane when focus is on the body", () => {
    // Switching browser tabs and coming back leaves focus on `document.body`:
    // nothing in the pane sees the key, so a window-level listener has to.
    const h = harness(MARKDOWN, null);
    const onClose = vi.fn();
    const { unmount } = render(paneElement(makeSpeech(h), onClose));
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Other keys are still nobody's business.
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Gone with the pane: a closed pane listens to nothing.
    unmount();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape in the cell's terminal closes the pane", () => {
    // Greg's rule: if the terminal has focus and the pane is open, Escape
    // closes the pane. The pane is a sibling of the xterm container inside the
    // cell's wrapper, and that is how it knows the terminal is its own. The
    // key must not reach the shell either: the pane listens in the capture
    // phase on `window`, so xterm's textarea never sees the keydown at all.
    const h = harness(MARKDOWN, null);
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <div className="relative">
          <div className="xterm">
            <textarea aria-label="terminal input" />
          </div>
          <AnswerPane sessionId="cell-a" speech={makeSpeech(h)} onClose={onClose} send={NO_SEND} {...OFF} />
        </div>
      </MemoryRouter>,
    );
    const input = screen.getByLabelText("terminal input");
    const terminalSawKey = vi.fn();
    input.addEventListener("keydown", terminalSawKey);
    input.focus();
    expect(document.activeElement).toBe(input);

    // `fireEvent` returns false when a listener called `preventDefault`.
    const notCancelled = fireEvent.keyDown(input, { key: "Escape" });
    expect(notCancelled).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(terminalSawKey).not.toHaveBeenCalled();

    // Any other key is the terminal's, untouched.
    expect(fireEvent.keyDown(input, { key: "a" })).toBe(true);
    expect(terminalSawKey).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape in another cell's terminal belongs to that terminal", () => {
    // A TUI in a different cell may use Escape (Claude Code interrupts on
    // it): its keystrokes are nobody else's, so this pane stays open and the
    // key goes through to that terminal untouched.
    const h = harness(MARKDOWN, null);
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <div className="relative">
          <div className="xterm">
            <textarea aria-label="other terminal input" />
          </div>
        </div>
        <div className="relative">
          <AnswerPane sessionId="cell-a" speech={makeSpeech(h)} onClose={onClose} send={NO_SEND} {...OFF} />
        </div>
      </MemoryRouter>,
    );
    const input = screen.getByLabelText("other terminal input");
    const terminalSawKey = vi.fn();
    input.addEventListener("keydown", terminalSawKey);
    input.focus();
    expect(document.activeElement).toBe(input);

    const notCancelled = fireEvent.keyDown(input, { key: "Escape" });
    expect(notCancelled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(terminalSawKey).toHaveBeenCalledTimes(1);
  });

  it("Enter on a link inside a block follows the link, not the jump", () => {
    const linked = [
      "# Deploy plan",
      "",
      "The runbook lives in [the deploy guide](https://example.com/deploy) and explains the migration order before any traffic moves.",
      "",
    ].join("\n");
    const h = harness(linked, null);
    const speech = makeSpeech(h);
    render(paneElement(speech));

    const link = screen.getByRole("link", { name: "the deploy guide" });
    const paragraph = link.closest("p");
    // The paragraph is a matched block — the guard is what keeps the link out.
    expect(paragraph).toHaveAttribute("data-unit", "1");
    expect(paragraph).toHaveAttribute("role", "button");

    link.focus();
    expect(document.activeElement).toBe(link);
    fireEvent.keyDown(link, { key: "Enter" });
    fireEvent.keyDown(link, { key: " " });
    expect(speech.onJumpToUnit).not.toHaveBeenCalled();

    // Enter on the block itself is still the jump.
    fireEvent.keyDown(paragraph!, { key: "Enter" });
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
   * A list. The voice reads each item as its own paragraph, so the items are
   * the blocks: a unit spans exactly the items it speaks, and the `ul` that
   * holds them is nothing but a container.
   */
  describe("lists", () => {
    it("list items carry the unit marks and the list does not", () => {
      const h = harness(LIST_MARKDOWN, null);
      const expectedUnit = expectedUnitIn(h);
      render(paneElement(makeSpeech(h)));

      // Heading, lead-in, and three units cut out of the list. The counts are
      // canaries: if packing changes shape entirely, they say so here.
      expect(h.units).toHaveLength(5);
      expect(items()).toHaveLength(6);
      expect(items().map((item) => item.dataset.unit)).toEqual(
        items().map((item) => String(expectedUnit(item))),
      );

      // The property the feature promises, whatever the packing constants are:
      // the six items fall into exactly three units, in reading order, with no
      // unit skipped between them.
      const marks = items().map((item) => Number(item.dataset.unit));
      expect(marks).toEqual([...marks].sort((a, b) => a - b));
      const distinct = [...new Set(marks)];
      expect(distinct).toEqual([distinct[0], distinct[0] + 1, distinct[0] + 2]);

      for (const item of items()) {
        expect(item).toHaveAttribute("role", "button");
        expect(item).toHaveAttribute("tabindex", "0");
      }

      // The container is not a block: no mark, no role, no tab stop.
      expect(list()).not.toHaveAttribute("data-unit");
      expect(list()).not.toHaveAttribute("role");
      expect(list()).not.toHaveAttribute("tabindex");
      expect(list()).not.toHaveAttribute("data-speaking");
    });

    it("clicking a list item jumps to its unit", () => {
      const h = harness(LIST_MARKDOWN, null);
      const expectedUnit = expectedUnitIn(h);
      const speech = makeSpeech(h);
      render(paneElement(speech));

      for (const index of [3, 0, 5]) {
        const item = items()[index];
        fireEvent.click(item);
        expect(speech.onJumpToUnit).toHaveBeenLastCalledWith("cell-a", expectedUnit(item));
      }
      expect(speech.onJumpToUnit).toHaveBeenCalledTimes(3);
    });

    it("clicking the list container jumps nowhere", () => {
      const h = harness(LIST_MARKDOWN, null);
      const speech = makeSpeech(h);
      render(paneElement(speech));

      // The padding beside the bullets belongs to the `ul`, which is no unit's.
      fireEvent.click(list());
      fireEvent.keyDown(list(), { key: "Enter" });
      expect(speech.onJumpToUnit).not.toHaveBeenCalled();
    });

    it("the spoken items carry data-speaking", () => {
      const h = harness(LIST_MARKDOWN, { unitIndex: 3, unitTime: 0, unitDuration: null });
      const expectedUnit = expectedUnitIn(h);
      render(paneElement(makeSpeech(h)));

      // Unit 3 speaks a run of items — exactly those, and never the whole list.
      const spoken = items().filter((item) => expectedUnit(item) === 3);
      expect(spoken.length).toBeGreaterThan(1);
      expect(speaking()).toEqual(spoken);
    });

    it("the previous unit's items stop speaking", () => {
      const h = harness(LIST_MARKDOWN, { unitIndex: 3, unitTime: 0, unitDuration: null });
      const expectedUnit = expectedUnitIn(h);
      render(paneElement(makeSpeech(h)));
      expect(speaking()).toEqual(items().filter((item) => expectedUnit(item) === 3));

      h.progress.set({ unitIndex: 4, unitTime: 0, unitDuration: null });
      // The strip covers the whole [data-unit] subtree, not this answer's direct
      // children: without that, the items unit 3 spoke keep the mark the voice
      // has left behind, and by the end of the list every item read so far is
      // still highlighted.
      const nowSpeaking = items().filter((item) => expectedUnit(item) === 4);
      expect(nowSpeaking.length).toBeGreaterThan(0);
      expect(prose().querySelectorAll("[data-speaking]")).toHaveLength(nowSpeaking.length);
      expect(speaking()).toEqual(nowSpeaking);
    });
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

    it("rail segments never overlap", () => {
      // The smoke test's real answer (2026-09-16): `prepare` speaks "Hi." first
      // with the whole opening paragraph as its source, then packs the rest of
      // that paragraph and the two after it into unit 1 — so block 0 belongs to
      // both units. Two segments over one block put the playhead beside the
      // wrong place; the second must start after the first one's end.
      const h = harness(SMOKE, { unitIndex: 1, unitTime: 0, unitDuration: null });
      expect(h.units).toHaveLength(2);
      expect(h.units[0].text).toBe("Hi.");
      render(paneElement(makeSpeech(h)));

      // The block itself is credited to its first unit — the jump target.
      expect(blocks()[0].dataset.unit).toBe("0");
      expect(box(0)).toEqual({ top: 0, height: BLOCK_HEIGHT });
      // Unit 1's segment starts after unit 0's end, yet beside the shared
      // block — not down at the second paragraph — and reaches the bottom of
      // its last block.
      expect(box(1).top).toBeGreaterThanOrEqual(box(0).top + box(0).height);
      expect(box(1).top).toBeLessThan(BLOCK_TOP);
      expect(box(1).top + box(1).height).toBe(2 * BLOCK_TOP + BLOCK_HEIGHT);
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

  /**
   * The pane's surface, read out of the stylesheet that owns it.
   *
   * jsdom loads no stylesheet, so `getComputedStyle` here would answer for a
   * rule it never saw. `cssRule` — the helper the hamburger geometry already
   * reads `index.css` with — returns one selector's declaration block, refuses
   * to guess when a selector matches more than one rule, and THROWS when none
   * matches. That last part is what carries the absence assertions below: "no
   * border" is trivially true of a rule that was never found, so the parse has
   * to fail loudly on a renamed selector rather than quietly agree.
   */
  describe("surfaces", () => {
    /**
     * The ground a rule paints — the `background` shorthand or the
     * `background-color` longhand, whichever it declares last — and not a
     * value hidden behind a comment, which is why the comments come out
     * before the declarations are split.
     */
    const background = (selector: string): string | null => {
      const declarations = cssRule(selector).replace(/\/\*[\s\S]*?\*\//g, "");
      // The shorthand OR the `background-color` longhand: a ground painted
      // with either is a ground, and reading only the shorthand let a
      // `background-color` on a surface slip past unseen. Last declaration
      // wins, the way the cascade reads a block top to bottom.
      const found = [
        ...declarations.matchAll(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/g),
      ];
      return found.length > 0 ? found[found.length - 1][1].trim() : null;
    };

    /**
     * What a surface inside the pane actually shows: its own `background` if
     * it declares one, else the pane's, which is what shows through an
     * undeclared one.
     */
    const shows = (selector: string): string | null =>
      background(selector) ?? background(".answer-pane");

    it("renders the pane without a border, radius or shadow", () => {
      const pane = cssRule(".answer-pane").replace(/\/\*[\s\S]*?\*\//g, "");

      // Vacuity guard. Every assertion below is about an ABSENCE, and an
      // absence is true of nothing at all: a renamed selector must blow up
      // (`cssRule` throws) and an emptied rule must fail here, not pass.
      expect(pane.trim().length).toBeGreaterThan(0);
      // And it is still the overlay rule, not some other block that happens to
      // declare nothing.
      expect(pane).toMatch(/(^|;)\s*position:\s*absolute/);

      // The card chrome goes the way the bar's did: nothing sits behind an
      // in-flow speech surface to blur, and a floating panel's edge would draw
      // a border where the row and the pane are meant to read as one surface.
      // Longhands included: a `border-top` here is precisely the edge that
      // must not be drawn between the row and the pane, and the shorthand-only
      // pattern read straight past it.
      expect(pane).not.toMatch(
        /(^|;)\s*border(-(top|right|bottom|left|width|style|color))?\s*:/,
      );
      expect(pane).not.toMatch(/border-radius\s*:/);
      expect(pane).not.toMatch(/box-shadow\s*:/);
      expect(pane).not.toMatch(/backdrop-filter\s*:/);
    });

    it("paints the pane on the speech surface, not the terminal ground", () => {
      // Quoted from the row's own rule rather than repeated as a literal, so
      // the two grounds cannot drift apart without this failing.
      const row = background(".speech-bar");
      expect(row).not.toBeNull();
      expect(background(".answer-pane")).toBe(row);

      // The body stops painting the xterm's ground under the text. A second,
      // darker surface inside the pane is precisely the card the pane has
      // stopped being — the text well and the switch row are one ground now,
      // with the row's hairline for the seam.
      expect(shows(".answer-pane-body")).not.toBe("var(--bg-base)");
      expect(shows(".answer-pane-body")).toBe(row);

      // Dropping the paint must not have moved the geometry the rail reads:
      // the body is still the positioned grid whose first column is the rail.
      const body = cssRule(".answer-pane-body");
      expect(body).toMatch(/position:\s*relative/);
      expect(body).toMatch(/display:\s*grid/);
      expect(body).toMatch(/grid-template-columns:\s*22px 1fr/);
    });

    /**
     * The open pane fills the terminal area.
     *
     * A deliberate departure from design.md, which sizes the pane to its
     * content and fades its bottom edge with a mask so "the terminal underneath
     * is implied, never announced". Greg read a real answer in a real browser
     * and asked for the opposite, verbatim: "when I am in answer mode I want
     * blend all the way to bottom, form on bottom no terminal visible". What he
     * had was a pane as tall as its text with live terminal output running
     * underneath the composer — two things to read at once, and the reply box
     * floating in the middle of the cell.
     *
     * jsdom does no layout, so the claim is made where it is written: the four
     * insets, the absence of a content-sized ceiling, and which single child of
     * the column is allowed to take the slack.
     */
    it("covers the terminal area rather than stopping at its content", () => {
      const pane = cssRule(".answer-pane").replace(/\/\*[\s\S]*?\*\//g, "");

      // Vacuity guard, as above: every claim here is about a declaration, and
      // `not.toMatch` is trivially true of an empty block.
      expect(pane).toMatch(/(^|;)\s*position:\s*absolute/);

      // All four edges. `top: 0` alone is what it already had — the bottom is
      // the new one, and it is the whole fix.
      for (const edge of ["top", "right", "bottom", "left"]) {
        expect(pane).toMatch(new RegExp(`(^|;)\\s*${edge}:\\s*0\\s*(;|$)`));
      }

      // And nothing that lets it stop short. `max-height: 100%` was what made
      // it as tall as its content: with all four insets set it is the ceiling
      // that decides, so leaving it behind would leave the bug behind.
      expect(pane).not.toMatch(/max-height\s*:/);
      expect(pane).not.toMatch(/(^|;)\s*height\s*:/);

      // The pane is still the flex column its rows are laid out in.
      expect(pane).toMatch(/flex-direction:\s*column/);
    });

    it("gives the slack to the text and pins the rows under it", () => {
      const body = cssRule(".answer-pane-body").replace(/\/\*[\s\S]*?\*\//g, "");

      // One claimant of the column's free space, and it is the reading area:
      // a short answer leaves empty ground above the composer rather than
      // floating the composer up into the middle of the cell, and a long one
      // scrolls inside the box instead of pushing the composer off the bottom.
      expect(body).toMatch(/(^|;)\s*flex:\s*1 1 auto\s*(;|$)/);
      // `min-height: 0` is what lets it shrink below its content — without it
      // a flex item's floor is its content and the overflow never engages.
      expect(body).toMatch(/(^|;)\s*min-height:\s*0\s*(;|$)/);
      expect(body).toMatch(/(^|;)\s*overflow:\s*auto\s*(;|$)/);

      // The rows below it take exactly their own height — neither grows into
      // the slack the body is claiming.
      expect(cssRule(".answer-pane-meta")).toMatch(/(^|;)\s*flex:\s*none\s*(;|$)/);
      expect(cssRule(".answer-pane-composer")).toMatch(/(^|;)\s*flex:\s*none\s*(;|$)/);

      // And the fade is gone with the reason for it. design.md masked the
      // body's bottom edge so the terminal showing through read as implied;
      // there is no terminal showing through any more, and a mask over the
      // last line of an answer that now runs to the composer would simply be
      // dimming the text.
      expect(body).not.toMatch(/mask/);
    });

    it("lays the body out above the rows it is pinned by", () => {
      const h = harness();
      render(
        <MemoryRouter>
          <AnswerPane
            sessionId="cell-a"
            speech={makeSpeech(h)}
            onClose={() => {}}
            send={NO_SEND}
            autoOpen={false}
            onAutoOpenChange={() => {}}
          />
        </MemoryRouter>,
      );

      // The CSS above only decides how the column shares its height; this is
      // the order it shares it in. The body is the column's FIRST row, so the
      // slack it claims sits above everything else rather than below it.
      const root = screen.getByTestId("answer-pane-cell-a");
      const body = screen.getByTestId("answer-pane-body-cell-a");
      expect(body.parentElement).toBe(root);
      expect(root.firstElementChild).toBe(body);
      // …and every other row of the pane is a sibling BELOW it, pinned to the
      // bottom of the terminal area by the slack the body is taking above
      // them. Which of them comes last is the next commit's business; that
      // they all come after the body is this one's.
      const rows = Array.from(root.children);
      expect(rows.length).toBeGreaterThan(1);
      expect(rows.indexOf(body)).toBe(0);
      expect(rows.some((row) => row.classList.contains("answer-pane-meta"))).toBe(true);
    });

    it("the meta row paints nothing of its own", () => {
      // The switch row paints nothing of its own — it never did — so what it
      // shows is the pane it sits in. What changed is the conclusion: the body
      // used to declare a darker ground so the two would read as two surfaces,
      // and that split was the card. One ground now, both of them the row's.
      //
      // The composer is the exception, and deliberately so: it declares the
      // third ground of design.md's three, because what YOU type is neither
      // agent nor shell. It is darker than both of the other two rather than
      // merely different, and `AnswerComposer.test.tsx` is where that is read
      // out of the stylesheet.
      const surface = background(".answer-pane");
      expect(surface).not.toBeNull();
      expect(cssRule(".answer-pane-meta")).not.toMatch(/background/);
      expect(shows(".answer-pane-meta")).toBe(surface);

      expect(shows(".answer-pane-body")).toBe(shows(".answer-pane-meta"));
    });
  });
});
