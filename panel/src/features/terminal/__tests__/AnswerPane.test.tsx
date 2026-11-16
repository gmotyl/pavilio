/**
 * The answer pane: the answer rendered as markdown, its scroll, its Play from
 * here buttons and its Copy as Markdown.
 *
 * One file, one `describe` per former file (`AnswerPane.test.tsx`, `.copy`,
 * `.play`); each section keeps its own fixtures and hooks, and its original
 * header sits above it. Module mocks are file-wide, so they are listed once
 * here: the synthesis cache answers `cold` throughout (nothing in the pane
 * draws from it any more), and the body's render counter only counts.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GridSpeech, SpeechUnit, Utterance, CellSpeechState } from "../../speech/types";
import { prepare } from "../../speech/prepare";
import type { SpeechProgress } from "../../speech/useSpeechPlayer";
import {
  emptyUtteranceQueue,
  utteranceQueueReducer,
  type UtteranceQueue,
} from "../../speech/utteranceQueue";
import { cssRule } from "../../shell/__tests__/hamburgerGeometry";
import { AnswerPane } from "../AnswerPane";
import { __resetAnswerWaitingForTests, beginWaiting, noteTransport } from "../answerWaiting";
import { StubResizeObserver } from "../../../test-utils";
import { answerSpeech, COPY_MARKDOWN, readySpeech, renderPane } from "./answerPane.harness";
import userEvent from "@testing-library/user-event";

// mermaid pulls in a browser-only rendering stack; what matters here is that
// the fence reaches the diagram component, not what mermaid draws.
vi.mock("../../markdown/MermaidDiagram", async () => (await import("./answerPane.mocks")).mermaidMock());

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

/** Nothing is ever warm: the pane renders no cache state of its own. */
vi.mock("../../speech/synth", () => ({
  isSpeechSynthesized: () => false,
  speechCacheState: () => "cold",
  subscribeSpeechCache: () => () => {},
}));

const copyToClipboard = vi.fn(async (_text: string) => true);

vi.mock("../../../lib/clipboard", () => ({
  copyToClipboard: (text: string) => copyToClipboard(text),
}));

/**
 * The answer pane — the card under the speech bar that renders the utterance
 * under the cursor as markdown, with a Play-from-here ▶ beside each speakable
 * block and one pinned beside the line the voice is reading.
 *
 * The units are real `prepare()` output and the blocks are real react-markdown
 * output, so the mapping under test is the one the product runs: a heading
 * unit finds its `h1`, a paragraph unit its `p`, and a code fence — a sentinel
 * in speech — finds nothing and stays inert. The host is a stub whose progress
 * store is driven by hand, which is what lets the "nothing re-renders inside a
 * unit" test notify with the same index and count.
 */

/**
 * jsdom has no layout and no `Range#getClientRects`, and the pinned ▶ is placed
 * from the first line box of a `Range` over the playing sentence. So every
 * range gets one line box: at its block's top (`blockTopOf`, the section's own
 * layout) plus the number of the block's characters before the range starts —
 * a later sentence of a paragraph sits lower, as it does on screen. Returns
 * the restore.
 */
function stubRangeLines(blockTopOf: (element: Element) => number | null): () => void {
  const proto = Range.prototype as unknown as Record<string, unknown>;
  const had = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value(this: Range) {
      let block: Element | null =
        this.startContainer instanceof Element ? this.startContainer : this.startContainer.parentElement;
      let top: number | null = null;
      for (; block; block = block.parentElement) {
        top = blockTopOf(block);
        if (top !== null) break;
      }
      if (!block || top === null) return [];
      const before = document.createRange();
      before.setStart(block, 0);
      before.setEnd(this.startContainer, this.startOffset);
      const line = top + before.toString().length;
      return [{ top: line, bottom: line + 22, left: 0, right: 100, width: 100, height: 22, x: 0, y: line }];
    },
  });
  return () => {
    if (had) Object.defineProperty(Range.prototype, "getClientRects", had);
    else delete proto.getClientRects;
  };
}

describe("rendering", () => {
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

  /**
   * A six-item list. `strip` emits every item as its own paragraph, so each
   * item is a unit of its own and a block the pane can match, mark and jump to.
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

  /**
   * Three paragraphs, the third read as two sentences: two units that share
   * one block, so the pinned ▶ has a line inside a paragraph to walk down to.
   */
  const SENTENCES = [
    "# Deploy plan",
    "",
    "The first paragraph says why the deploy waits for the migration.",
    "",
    "The second paragraph covers the rollback path after the switch.",
    "",
    "Charlie opens the third paragraph. Delta is its second sentence, read after the first one.",
    "",
  ].join("\n");

  const SENTENCE_UNITS = prepare(SENTENCES).units;

  /** The third paragraph's second sentence. */
  const DELTA = SENTENCE_UNITS.findIndex((unit) => unit.text.startsWith("Delta"));

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
    /** What `stateFor` answers, read at call time so a test can change it. */
    state: CellSpeechState;
  }

  const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();


  function speechOf(h: Harness): GridSpeech {
    return readySpeech({
      stateFor: vi.fn(() => h.state),
      queueFor: vi.fn(() => h.queue),
      unitsFor: vi.fn(() => h.units),
      subscribeProgress: h.progress.subscribe,
      progressFor: vi.fn(() => h.progress.read()),
      unitDurationsFor: vi.fn(() => NO_DURATIONS),
    });
  }

  function harness(markdown = MARKDOWN, progress: SpeechProgress | null = null): Harness {
    return {
      queue: arrived(emptyUtteranceQueue, utterance("u-1", markdown)),
      units: prepare(markdown).units,
      progress: makeProgressStore(progress),
      state: "ready",
    };
  }

  /** The composer's PTY write, on a live socket — `AnswerComposer.send.test.tsx` ("send") is
   *  where it is spent, and `sendOnDeadSocket.test.tsx` is where a dead one is. */
  const NO_SEND = (): boolean => true;

  function paneElement(speech: GridSpeech) {
    // MarkdownRenderer calls useNavigate, so the body needs a router.
    return (
      <MemoryRouter>
        <AnswerPane sessionId="cell-a" speech={speech} send={NO_SEND} />
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
   * Which unit speaks an item's text, read off the harness's OWN units.
   *
   * Why not the literal indices: how a text is cut into units is `prepare`'s
   * business, not the pane's contract. Hard-coded expectations turn a change
   * there into failures that point at the pane. This is not circular — it
   * asks the unit's `source`, not `firstUnitsOfBlocks`, which is the mapping
   * under test.
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

  /** By tag: the contract's criterion is the element — `# Heading` becomes an `h1`. */
  const h1 = (): HTMLElement => {
    const element = prose().querySelector("h1");
    if (!(element instanceof HTMLElement)) throw new Error("no h1 in the body");
    return element;
  };

  /** The pinned ▶ — the playing unit's, always shown — or null when nothing here plays. */
  const pinned = (): HTMLElement | null => screen.queryByTestId("play-from-here-pinned");

  /** A block's own ▶: the button that shares its `data-speak-index`, or null. */
  const playOf = (block: HTMLElement): HTMLElement | null => {
    const index = block.getAttribute("data-speak-index");
    if (index === null) return null;
    return document.querySelector<HTMLElement>(`button.play-from-here[data-speak-index="${index}"]`);
  };

  /** Every ▶ the pane shows, the pinned one included. */
  const shownPlays = (): HTMLElement[] =>
    Array.from(document.querySelectorAll<HTMLElement>("button.play-from-here[data-shown]"));

  /** The rendered paragraph whose text starts with `start`. */
  const paragraph = (start: string): HTMLElement => {
    const found = Array.from(prose().querySelectorAll<HTMLElement>("p")).find((p) =>
      (p.textContent ?? "").startsWith(start),
    );
    if (!found) throw new Error(`no paragraph ${start}`);
    return found;
  };

  /** The ▶ is centred on the line box it is pinned to: its top lands inside that line. */
  const onLine = (button: HTMLElement | null, line: number): void => {
    expect(button).not.toBeNull();
    const top = Number.parseFloat(button!.style.top);
    expect(top).toBeGreaterThanOrEqual(line);
    expect(top).toBeLessThan(line + 22);
  };

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

  /** The rendered block's top under the layout above, or null outside one. */
  const blockTopOf = (element: Element): number | null => {
    const index = blockIndexOf(element);
    return index === null ? null : index * BLOCK_TOP;
  };

  let restoreLines: () => void = () => {};

  beforeEach(() => {
    bodyRenders.count = 0;
    scrollTo.mockClear();
    StubResizeObserver.observed.length = 0;
    fitting();
    installLayout();
    restoreLines = stubRangeLines(blockTopOf);
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
  });

  afterEach(() => {
    // Unmount first: resetting the wait re-renders a mounted pane, and its
    // ResizeObserver effect would then run after the stub below is gone.
    cleanup();
    __resetAnswerWaitingForTests();
    restoreLayout();
    restoreLines();
    vi.unstubAllGlobals();
  });

  describe("AnswerPane", () => {
    it("renders the utterance under the cursor as markdown", async () => {
      const fence = ["# Flow", "", "```mermaid", "flowchart TD", "  A --> B", "```", ""].join("\n");
      const h = harness(fence);
      render(paneElement(speechOf(h)));

      const pane = screen.getByTestId("answer-pane-cell-a");
      expect(pane).toHaveAttribute("role", "region");
      expect(pane).toHaveAttribute("aria-label", "Answer");
      expect(document.activeElement).toBe(pane);

      expect(h1()).toHaveTextContent("Flow");
      expect((await screen.findByTestId("mermaid")).textContent).toBe("flowchart TD\n  A --> B");
    });

    it("answer pane pins the play button on the playing paragraph", () => {
      // The third paragraph's second sentence is playing: a unit that shares
      // its block with the sentence before it.
      expect(SENTENCE_UNITS[DELTA - 1].text).toMatch(/^Charlie/);
      expect(SENTENCE_UNITS[DELTA].block).toBe(SENTENCE_UNITS[DELTA - 1].block);
      const h = harness(SENTENCES, { unitIndex: DELTA, unitTime: 0, unitDuration: null });
      h.state = "speaking";
      render(paneElement(speechOf(h)));

      const third = paragraph("Charlie");
      const offset = (third.textContent ?? "").indexOf("Delta");
      expect(offset).toBeGreaterThan(0);
      // Pause, at the line where that sentence starts inside the third
      // paragraph — not at the paragraph's top, and not beside any other block.
      expect(pinned()).toHaveAccessibleName("Pause");
      onLine(pinned(), blockTopOf(third)! + offset);
      // With nothing hovered it is the one ▶ shown.
      expect(shownPlays()).toEqual([pinned()]);
    });

    it("answer pane has no unit rail", () => {
      const h = harness(MARKDOWN, { unitIndex: 1, unitTime: 0, unitDuration: null });
      render(paneElement(speechOf(h)));

      // The body is the text column and nothing beside it: no gutter, no
      // segments, no playhead, no per-unit Play.
      expect(Array.from(body().children).map((child) => child.className)).toEqual(["answer-pane-text"]);
      expect(screen.queryAllByTestId(/^answer-pane-(seg|head|play)-/)).toHaveLength(0);
      // No marking pass of the pane's own: the blocks carry the ▶ layer's marks only.
      expect(prose().querySelector("[data-unit], [data-speaking]")).toBeNull();
      // The ▶ layer instead: one per speakable block — the heading and three
      // paragraphs, never the fence — and the pinned one for the playing unit.
      expect(document.querySelectorAll("button.play-from-here[data-speak-index]")).toHaveLength(4);
      expect(pinned()).not.toBeNull();
    });

    it("the pinned button moves with the unit index and nothing re-renders inside a unit", () => {
      const h = harness(MARKDOWN, { unitIndex: 0, unitTime: 0, unitDuration: null });
      render(paneElement(speechOf(h)));

      onLine(pinned(), 0);
      const proseBefore = prose();
      const rendersBefore = bodyRenders.count;

      // Four ticks inside unit 0 — what `timeupdate` does at ~4 Hz.
      h.progress.tick();
      h.progress.tick();
      h.progress.tick();
      h.progress.tick();
      expect(bodyRenders.count).toBe(rendersBefore);
      expect(prose()).toBe(proseBefore);
      onLine(pinned(), 0);

      // The unit boundary: the pin moves to unit 3, the paragraph after the
      // fence (unit 2 is the fence's placeholder).
      h.progress.set({ unitIndex: 3, unitTime: 0, unitDuration: null });
      onLine(pinned(), 3 * BLOCK_TOP);
      // The text itself was not rebuilt.
      expect(prose()).toBe(proseBefore);
    });

    it("another cell's run pins nothing here", () => {
      // `progressFor` answers null for every cell but the one running.
      const h = harness(MARKDOWN, null);
      render(paneElement(speechOf(h)));

      expect(pinned()).toBeNull();
      expect(shownPlays()).toHaveLength(0);
      // Still matched, still jumpable — only the pin is missing.
      expect(blocks().filter((b) => b.hasAttribute("data-speak-unit"))).toHaveLength(4);
    });

    it("pressing a paragraph's play button jumps the cell's run", () => {
      const h = harness(SENTENCES);
      const speech = speechOf(h);
      const view = render(paneElement(speech));
      const unitOf = (start: string): number => h.units.findIndex((unit) => unit.text.startsWith(start));

      const second = paragraph("The second paragraph");
      fireEvent.mouseOver(second);
      fireEvent.click(playOf(second)!);
      expect(speech.onJumpToUnit).toHaveBeenLastCalledWith("cell-a", unitOf("The second paragraph"));

      // A paragraph read as two sentences starts at its first.
      const third = paragraph("Charlie");
      fireEvent.mouseOver(third);
      fireEvent.click(playOf(third)!);
      expect(speech.onJumpToUnit).toHaveBeenLastCalledWith("cell-a", unitOf("Charlie"));
      expect(speech.onJumpToUnit).toHaveBeenCalledTimes(2);

      // The pinned ▶ while the voice reads is Pause: it pauses the cell's run
      // and jumps nowhere.
      h.state = "speaking";
      h.progress.set({ unitIndex: DELTA, unitTime: 0, unitDuration: null });
      fireEvent.click(pinned()!);
      expect(speech.onPause).toHaveBeenCalledWith("cell-a");
      expect(speech.onJumpToUnit).toHaveBeenCalledTimes(2);

      // Paused, the same ▶ reads Play and picks the voice up where it stopped.
      h.state = "paused";
      view.rerender(paneElement(speech));
      expect(pinned()).toHaveAccessibleName("Play from here");
      fireEvent.click(pinned()!);
      expect(speech.onJumpToUnit).toHaveBeenLastCalledWith("cell-a", DELTA);
      expect(speech.onPause).toHaveBeenCalledTimes(1);
    });

    it("link click and text selection do not jump", () => {
      const linked = [
        "# Deploy plan",
        "",
        "The runbook lives in [the deploy guide](https://example.com/deploy) and explains the migration order before any traffic moves.",
        "",
      ].join("\n");
      const h = harness(linked, null);
      const speech = speechOf(h);
      render(paneElement(speech));

      const link = screen.getByRole("link", { name: "the deploy guide" });
      const para = link.closest("p")!;
      // The paragraph is a speakable block with a ▶ of its own.
      expect(playOf(para)).not.toBeNull();

      fireEvent.click(link);
      fireEvent.keyDown(link, { key: "Enter" });

      // A selection dragged across the paragraph ends in a click on it.
      const selection = window.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(para);
      selection.removeAllRanges();
      selection.addRange(range);
      fireEvent.mouseDown(para);
      fireEvent.mouseUp(para);
      fireEvent.click(para);
      expect(selection.toString()).toContain("The runbook lives in");
      selection.removeAllRanges();

      expect(speech.onJumpToUnit).not.toHaveBeenCalled();
      expect(speech.onSpeak).not.toHaveBeenCalled();
    });

    it("touch tap reveals one paragraph's play button", () => {
      const h = harness(SENTENCES, { unitIndex: DELTA, unitTime: 0, unitDuration: null });
      h.state = "speaking";
      const speech = speechOf(h);
      render(paneElement(speech));

      const first = paragraph("The first paragraph");
      const second = paragraph("The second paragraph");
      // Nothing dimmed beside every paragraph: only the playing one shows.
      expect(shownPlays()).toEqual([pinned()]);

      fireEvent.click(first);
      expect(shownPlays()).toEqual([playOf(first), pinned()]);

      // Another tap moves the reveal; the first paragraph's ▶ goes.
      fireEvent.click(second);
      expect(shownPlays()).toEqual([playOf(second), pinned()]);
      expect(playOf(first)).not.toHaveAttribute("data-shown");
      // A tap reveals; it never plays.
      expect(speech.onJumpToUnit).not.toHaveBeenCalled();
    });

    it("a speakable block is neither a button nor a tab stop", () => {
      const h = harness(MARKDOWN, null);
      const speech = speechOf(h);
      render(paneElement(speech));

      const block = screen.getByText(/^The first paragraph/);
      expect(block).toHaveAttribute("data-speak-unit", "1");
      expect(block).not.toHaveAttribute("role");
      expect(block).not.toHaveAttribute("tabindex");

      fireEvent.keyDown(block, { key: "Enter" });
      fireEvent.keyDown(block, { key: " " });
      expect(speech.onJumpToUnit).not.toHaveBeenCalled();
    });

    it("a code block is inert", () => {
      const h = harness(MARKDOWN, { unitIndex: 2, unitTime: 0, unitDuration: null });
      const speech = speechOf(h);
      render(paneElement(speech));

      // The renderer wraps a fenced block in a `.code-block` div so the copy button
      // can sit beside the `pre`.
      const codeBlock = blocks().find((block) => block.classList.contains("code-block"));
      expect(codeBlock).toBeDefined();
      expect(codeBlock).not.toHaveAttribute("data-speak-unit");
      expect(codeBlock!.querySelector("[data-speak-unit]")).toBeNull();
      expect(codeBlock).not.toHaveAttribute("role");
      expect(codeBlock).not.toHaveAttribute("tabindex");
      // The fence speaks a placeholder unit that no block holds: nothing to pin.
      expect(pinned()).toBeNull();

      fireEvent.mouseOver(codeBlock!);
      expect(shownPlays()).toHaveLength(0);
      fireEvent.click(codeBlock!);
      fireEvent.keyDown(codeBlock!, { key: "Enter" });
      expect(speech.onJumpToUnit).not.toHaveBeenCalled();
    });

    it("copying a fence inside a spoken block does not jump the voice", () => {
      const h = harness(FENCE_IN_LIST_MARKDOWN, null);
      const speech = speechOf(h);
      render(paneElement(speech));

      const button = screen.getByLabelText("Copy code");
      // The precondition the regression needs: the fence sits inside a list
      // item whose text is a speakable block, so a click allowed to bubble
      // would reach the ▶ layer's handlers.
      const item = button.closest("li");
      expect(item).not.toBeNull();
      expect(item!.querySelector("[data-speak-unit]")).not.toBeNull();

      fireEvent.click(button);
      // Copying is not a request to be read to from here.
      expect(speech.onJumpToUnit).not.toHaveBeenCalled();
    });

    it("gestures inside the pane never reach the cell", () => {
      const h = harness(MARKDOWN, null);
      const speech = speechOf(h);
      const cell = { mouseDown: vi.fn(), click: vi.fn(), dragStart: vi.fn() };

      // The cell is the pane's parent: its header is `draggable` and its root
      // focuses on click, so anything that escaped the pane would move a cell or
      // steal focus from the text.
      render(
        <MemoryRouter>
          <div onMouseDown={cell.mouseDown} onClick={cell.click} onDragStart={cell.dragStart}>
            <AnswerPane sessionId="cell-a" speech={speech} send={NO_SEND} />
          </div>
        </MemoryRouter>,
      );

      const heading = h1();
      fireEvent.mouseDown(heading);
      fireEvent.click(heading);
      fireEvent.dragStart(heading);
      const first = paragraph("The first paragraph");
      fireEvent.mouseOver(first);
      fireEvent.mouseDown(playOf(first)!);
      fireEvent.click(playOf(first)!);
      fireEvent.mouseDown(screen.getByTestId("answer-pane-cell-a"));

      expect(cell.mouseDown).not.toHaveBeenCalled();
      expect(cell.click).not.toHaveBeenCalled();
      expect(cell.dragStart).not.toHaveBeenCalled();
      // The ▶ press still did its own work inside the pane; the heading is
      // text and starts nothing.
      expect(speech.onJumpToUnit).toHaveBeenCalledTimes(1);
      expect(speech.onJumpToUnit).toHaveBeenCalledWith("cell-a", 1);
    });

    it("Enter on a link inside a block follows the link and plays nothing", () => {
      const linked = [
        "# Deploy plan",
        "",
        "The runbook lives in [the deploy guide](https://example.com/deploy) and explains the migration order before any traffic moves.",
        "",
      ].join("\n");
      const h = harness(linked, null);
      const speech = speechOf(h);
      render(paneElement(speech));

      const link = screen.getByRole("link", { name: "the deploy guide" });
      const paragraph = link.closest("p");
      // The paragraph is a matched block, and still plain text.
      expect(paragraph).toHaveAttribute("data-speak-unit", "1");
      expect(paragraph).not.toHaveAttribute("role");

      link.focus();
      expect(document.activeElement).toBe(link);
      fireEvent.keyDown(link, { key: "Enter" });
      fireEvent.keyDown(link, { key: " " });
      fireEvent.keyDown(paragraph!, { key: "Enter" });
      expect(speech.onJumpToUnit).not.toHaveBeenCalled();
    });

    it("a new utterance swaps the text in place", () => {
      const h = harness(MARKDOWN, { unitIndex: 1, unitTime: 0, unitDuration: null });
      const speech = speechOf(h);
      const view = render(paneElement(speech));

      const paneBefore = screen.getByTestId("answer-pane-cell-a");
      expect(h1()).toHaveTextContent("Deploy plan");
      expect(document.querySelectorAll("button.play-from-here[data-speak-index]")).toHaveLength(4);

      // The host's queue takes the arrival as `current`; the run that was on
      // is over, so its progress is gone too.
      h.queue = arrived(h.queue, utterance("u-2", OTHER_MARKDOWN));
      h.units = prepare(OTHER_MARKDOWN).units;
      h.progress.set(null);
      view.rerender(paneElement(speech));

      expect(screen.getByTestId("answer-pane-cell-a")).toBe(paneBefore);
      expect(h1()).toHaveTextContent("Other");
      expect(screen.queryByText(/^The first paragraph/)).toBeNull();
      expect(document.querySelectorAll("button.play-from-here[data-speak-index]")).toHaveLength(2);
      expect(pinned()).toBeNull();
      // The new text is matched afresh: heading and paragraph, both jumpable.
      expect(blocks().filter((b) => b.hasAttribute("data-speak-unit")).map((b) => b.tagName)).toEqual([
        "H1",
        "P",
      ]);
    });

    /**
     * A list. The voice reads each item as its own paragraph, so the items are
     * the blocks: each has its own ▶, and the `ul` that holds them is nothing
     * but a container.
     */
    describe("lists", () => {
      it("list items carry the unit marks and the list does not", () => {
        const h = harness(LIST_MARKDOWN, null);
        const expectedUnit = expectedUnitIn(h);
        render(paneElement(speechOf(h)));

        // Heading, lead-in, and one unit per item. The counts are canaries: if
        // preparation changes shape entirely, they say so here.
        expect(h.units).toHaveLength(8);
        expect(items()).toHaveLength(6);
        expect(items().map((item) => item.dataset.speakUnit)).toEqual(
          items().map((item) => String(expectedUnit(item))),
        );

        // The property the feature promises: the six items are six units, in
        // reading order, with no unit skipped between them.
        const marks = items().map((item) => Number(item.dataset.speakUnit));
        expect(marks).toEqual(Array.from({ length: 6 }, (_, i) => marks[0] + i));

        for (const item of items()) {
          expect(item).not.toHaveAttribute("role");
          expect(item).not.toHaveAttribute("tabindex");
        }

        // The container is not a block: no mark, no role, no tab stop.
        expect(list()).not.toHaveAttribute("data-speak-unit");
        expect(list()).not.toHaveAttribute("role");
        expect(list()).not.toHaveAttribute("tabindex");
      });

      it("a list item's Play jumps to its unit", () => {
        const h = harness(LIST_MARKDOWN, null);
        const expectedUnit = expectedUnitIn(h);
        const speech = speechOf(h);
        render(paneElement(speech));

        for (const index of [3, 0, 5]) {
          const item = items()[index];
          // The item itself is text.
          fireEvent.click(item);
          expect(speech.onJumpToUnit).not.toHaveBeenCalled();
          fireEvent.mouseOver(item);
          fireEvent.click(playOf(item)!);
          expect(speech.onJumpToUnit).toHaveBeenLastCalledWith("cell-a", expectedUnit(item));
          vi.mocked(speech.onJumpToUnit).mockClear();
        }
      });

      it("clicking the list container jumps nowhere", () => {
        const h = harness(LIST_MARKDOWN, null);
        const speech = speechOf(h);
        render(paneElement(speech));

        // The padding beside the bullets belongs to the `ul`, which is no unit's.
        fireEvent.click(list());
        fireEvent.keyDown(list(), { key: "Enter" });
        expect(speech.onJumpToUnit).not.toHaveBeenCalled();
      });

      it("the pinned button follows the voice from item to item", () => {
        const h = harness(LIST_MARKDOWN, { unitIndex: 3, unitTime: 0, unitDuration: null });
        const expectedUnit = expectedUnitIn(h);
        render(paneElement(speechOf(h)));

        // Unit 3 speaks one item — the pin sits beside exactly that one, never
        // at the top of the whole list.
        const spoken = items().filter((item) => expectedUnit(item) === 3);
        expect(spoken).toHaveLength(1);
        onLine(pinned(), blockTopOf(spoken[0])!);

        h.progress.set({ unitIndex: 4, unitTime: 0, unitDuration: null });
        const next = items().filter((item) => expectedUnit(item) === 4);
        expect(next).toHaveLength(1);
        onLine(pinned(), blockTopOf(next[0])!);
        expect(document.querySelectorAll("[data-testid='play-from-here-pinned']")).toHaveLength(1);
      });
    });

    /**
     * Following the voice. The pane moves at ONE moment — when it mounts while a
     * unit is playing — and only when there is somewhere to move to. A unit
     * boundary moves the pinned ▶, never the text: the reader's scroll
     * position is theirs for as long as the pane stays open.
     */
    describe("following", () => {
      it("a unit change does not scroll the pane", () => {
        overflowing();
        const h = harness(MARKDOWN, null);
        render(paneElement(speechOf(h)));
        // Nothing is playing: nothing to follow.
        expect(scrolls()).toEqual([]);

        h.progress.set({ unitIndex: 0, unitTime: 0, unitDuration: null });
        onLine(pinned(), 0);

        // Unit 3 is the paragraph after the fence (h1, p, pre, p, p): the pin
        // moves there, the body stays where it is.
        h.progress.set({ unitIndex: 3, unitTime: 0, unitDuration: null });
        onLine(pinned(), 3 * BLOCK_TOP);
        expect(scrollTo).not.toHaveBeenCalled();
      });

      it("does not scroll when the body is rebuilt on the way out of a wait mid-unit", () => {
        overflowing();
        const h = harness(MARKDOWN, { unitIndex: 3, unitTime: 0, unitDuration: null });
        render(paneElement(speechOf(h)));
        // The mount itself lands on the spoken block — pinned below.
        scrollTo.mockClear();

        act(() => beginWaiting("cell-a", "u-1"));
        expect(screen.queryByTestId("answer-pane-waiting-cell-a")).toBeInTheDocument();

        // A transport press hands the body back while unit 3 is still playing:
        // the column is rebuilt and its ▶s with it, and nothing scrolls.
        act(() => noteTransport("cell-a"));
        expect(screen.queryByTestId("answer-pane-waiting-cell-a")).toBeNull();
        onLine(pinned(), 3 * BLOCK_TOP);
        expect(scrollTo).not.toHaveBeenCalled();
      });

      it("does not scroll when the answer fits", () => {
        fitting();
        const h = harness(MARKDOWN, { unitIndex: 0, unitTime: 0, unitDuration: null });
        render(paneElement(speechOf(h)));

        h.progress.set({ unitIndex: 1, unitTime: 0, unitDuration: null });
        h.progress.set({ unitIndex: 2, unitTime: 0, unitDuration: null });
        expect(scrollTo).not.toHaveBeenCalled();
      });

      it("does not scroll again inside a unit", () => {
        overflowing();
        const h = harness(MARKDOWN, { unitIndex: 1, unitTime: 0, unitDuration: null });
        render(paneElement(speechOf(h)));
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
        // Unit 3 is already playing when the eye opens the pane.
        const h = harness(MARKDOWN, { unitIndex: 3, unitTime: 0, unitDuration: null });
        render(paneElement(speechOf(h)));

        expect(scrolls()).toEqual([3 * BLOCK_TOP - layout.clientHeight / 3]);
        onLine(pinned(), 3 * BLOCK_TOP);
      });

      it("opening on a paragraph's later sentence lands on that paragraph", () => {
        overflowing();
        // The playing unit is the third paragraph's second sentence: no block
        // starts at it, and the pane still lands on the block that holds it.
        const h = harness(SENTENCES, { unitIndex: DELTA, unitTime: 0, unitDuration: null });
        render(paneElement(speechOf(h)));

        expect(scrolls()).toEqual([3 * BLOCK_TOP - layout.clientHeight / 3]);
      });

      it("a unit without a block scrolls nothing and pins nothing", () => {
        overflowing();
        const h = harness(MARKDOWN, { unitIndex: 1, unitTime: 0, unitDuration: null });
        // A ghost between the heading and the first paragraph: spoken, never
        // drawn. The fence's own placeholder unit is left out, so the ghost is
        // the only blockless unit.
        h.units = [h.units[0], GHOST, h.units[1], h.units[3], h.units[4]];
        render(paneElement(speechOf(h)));

        expect(scrollTo).not.toHaveBeenCalled();
        expect(pinned()).toBeNull();
        // The blocks are still matched: the heading and three paragraphs.
        expect(blocks().filter((b) => b.hasAttribute("data-speak-unit"))).toHaveLength(4);
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

      it("paints the pane on the speech surface, not the terminal ground", () => {
        // Quoted from the row's own rule rather than repeated as a literal, so
        // the two grounds cannot drift apart without this failing.
        const row = background(".speech-bar");
        expect(row).not.toBeNull();
        // The stylesheet leaves the pane transparent, so a body faded by the
        // project's answer opacity shows the terminal through it; at the
        // default 100 the pane puts the row's ground back inline.
        expect(background(".answer-pane")).toBe("transparent");
        renderPane(readySpeech());
        const probe = document.createElement("div");
        probe.style.background = row!;
        expect(screen.getByTestId("answer-pane-cell-a").style.background).toBe(probe.style.background);

        // The body stops painting the xterm's ground under the text. A second,
        // darker surface inside the pane is precisely the card the pane has
        // stopped being — the text well and the switch row are one ground now,
        // with the row's hairline for the seam. Painted inline by the pane.
        expect(screen.getByTestId("answer-pane-body-cell-a").style.background).toBe(
          probe.style.background,
        );

        // Dropping the paint must not have moved the geometry the scroll reads:
        // the body is still the positioned grid the blocks are measured in.
        const body = cssRule(".answer-pane-body");
        expect(body).toMatch(/position:\s*relative/);
        expect(body).toMatch(/display:\s*grid/);

        // The switch row paints the same ground itself (the pane behind it is
        // transparent). The composer's FIELD is the exception, deliberately: it
        // declares the third ground of design.md's three, darker than both, and
        // `AnswerComposer.send.test.tsx` ("send") reads that out of the stylesheet.
        expect(background(".answer-pane-meta")).toBe(row);
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

        // Vacuity guard: every claim here is about a declaration, and
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
              speech={speechOf(h)}
              send={NO_SEND}
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
    });
  });
});

/**
 * Copy as Markdown: one button in the pane's corner that puts the answer's
 * SOURCE on the clipboard — the `#`, the `[text](url)` and the fences intact —
 * rather than whatever the rendered prose would select as.
 *
 * The clipboard helper is mocked so the test reads exactly what the button
 * handed it; the host is a stub, the units real `prepare()` output.
 */
describe("copy as markdown", () => {
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
      const speech = answerSpeech(COPY_MARKDOWN).speech;
      renderPane(speech);

      const button = screen.getByRole("button", { name: "Copy answer as Markdown" });
      // Outside the scrolling text, so it stays put in the corner.
      expect(screen.getByTestId("answer-pane-body-cell-a")).not.toContainElement(button);

      await act(async () => {
        fireEvent.click(button);
      });

      expect(copyToClipboard).toHaveBeenCalledTimes(1);
      expect(copyToClipboard).toHaveBeenCalledWith(COPY_MARKDOWN);
      // Copying is never also a request to read.
      expect(speech.onJumpToUnit).not.toHaveBeenCalled();
      expect(speech.onSpeak).not.toHaveBeenCalled();
      expect(speech.onResume).not.toHaveBeenCalled();
      expect(speech.onSeekWithinUnit).not.toHaveBeenCalled();
    });

    it("no copy-all while waiting", () => {
      const speech = answerSpeech(COPY_MARKDOWN).speech;
      renderPane(speech);
      expect(screen.getByRole("button", { name: "Copy answer as Markdown" })).toBeInTheDocument();

      act(() => beginWaiting("cell-a", "u-1"));

      expect(screen.queryByRole("button", { name: "Copy answer as Markdown" })).toBeNull();
    });
  });
});

/**
 * Reading starts from a Play button, and the answer's text is just text.
 *
 * The pane used to resolve a click anywhere in a spoken block — a link
 * included — to a jump, so a link inside an answer could not be followed
 * without the voice starting to read from there too. Now every speakable
 * block has a real `<button>` beside its first line — the Play-from-here layer
 * pages use — and the blocks carry no role, no tab stop and no handler.
 *
 * The units are real `prepare()` output and the blocks real react-markdown
 * output, as in `AnswerPane.test.tsx`; the host is a stub.
 */
describe("play buttons", () => {
  /** Heading (unit 0), a paragraph with a link (unit 1), a fence (unit 2), and two paragraphs (units 3, 4). */
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

  /**
   * A fence and two long paragraphs, for an answer that opens or closes with
   * code. The fence is a unit of its own (`⟦code⟧`) that matches no block.
   */
  const FENCE = ["```ts", "const x = 1;", "```", ""];

  const LONG_PARAGRAPHS = [
    "The first paragraph explains why the deploy has to wait for the database migration to finish first, and why the old schema must stay readable until every pod has rolled over to the new release tonight.",
    "",
    "The second paragraph describes the rollback path in case the health checks fail after the switch, including how long the old pods stay warm before they are drained and who signs off on the rollback tonight.",
    "",
  ];

  function playSpeech(
    progress: SpeechProgress | null = null,
    state: CellSpeechState = "ready",
    markdown: string = MARKDOWN,
  ): { speech: GridSpeech; units: readonly SpeechUnit[] } {
    return answerSpeech(markdown, {
      stateFor: vi.fn(() => state),
      progressFor: vi.fn(() => progress),
    });
  }

  const prose = (): HTMLElement => {
    const element = screen.getByTestId("answer-pane-body-cell-a").querySelector(".prose");
    if (!(element instanceof HTMLElement)) throw new Error("no .prose in the body");
    return element;
  };

  /** The rendered block that starts the voice at `unit`, i.e. carries it as `data-speak-unit`. */
  const blockOf = (unit: number): HTMLElement => {
    const block = prose().querySelector<HTMLElement>(`[data-speak-unit="${unit}"]`);
    if (!block) throw new Error(`no block starts at unit ${unit}`);
    return block;
  };

  /** The ▶ beside the block that starts at `unit`. */
  const play = (unit: number): HTMLElement => {
    const index = blockOf(unit).getAttribute("data-speak-index");
    const button = document.querySelector<HTMLElement>(`button.play-from-here[data-speak-index="${index}"]`);
    if (!button) throw new Error(`no play button for unit ${unit}`);
    return button;
  };

  /** Every block's ▶ — not the pinned one. */
  const plays = (): HTMLElement[] =>
    Array.from(document.querySelectorAll<HTMLElement>("button.play-from-here[data-speak-index]"));

  /** The units whose block's ▶ is shown, read off the block the ▶ shares an index with. */
  const shown = (): number[] =>
    plays()
      .filter((button) => button.hasAttribute("data-shown"))
      .map((button) =>
        Number(
          prose()
            .querySelector(`[data-speak-index="${button.getAttribute("data-speak-index")}"]`)!
            .getAttribute("data-speak-unit"),
        ),
      );

  const pinned = (): HTMLElement | null => screen.queryByTestId("play-from-here-pinned");

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("AnswerPane Play buttons", () => {
    it("clicking a link in a spoken block does not start playback", () => {
      const { speech } = playSpeech();
      renderPane(speech);

      const link = screen.getByRole("link", { name: "the deploy guide" });
      // The precondition: the link sits inside a spoken block.
      expect(link.closest("[data-speak-unit]")).toHaveAttribute("data-speak-unit", "1");

      fireEvent.click(link);
      fireEvent.keyDown(link, { key: "Enter" });
      expect(speech.onJumpToUnit).not.toHaveBeenCalled();
    });

    it("clicking text does not start playback", () => {
      const { speech } = playSpeech();
      renderPane(speech);

      const paragraph = screen.getByText(/^The second paragraph/);
      expect(paragraph).toHaveAttribute("data-speak-unit", "3");
      fireEvent.click(paragraph);
      fireEvent.click(prose().querySelector("h1")!);
      expect(speech.onJumpToUnit).not.toHaveBeenCalled();

      // The text is text: no block is a button or a tab stop.
      for (const block of Array.from(prose().querySelectorAll("[data-speak-unit]"))) {
        expect(block).not.toHaveAttribute("role");
        expect(block).not.toHaveAttribute("tabindex");
      }
    });

    it("Play beside a block starts playback at its unit", () => {
      const { speech } = playSpeech();
      renderPane(speech);

      expect(play(3).tagName).toBe("BUTTON");
      expect(play(3)).toHaveAccessibleName("Play from here");
      // Beside the block, never inside it: no block's text moves.
      expect(blockOf(3).contains(play(3))).toBe(false);
      fireEvent.mouseOver(blockOf(3));
      fireEvent.click(play(3));
      expect(speech.onJumpToUnit).toHaveBeenLastCalledWith("cell-a", 3);
      fireEvent.mouseOver(blockOf(0));
      fireEvent.click(play(0));
      expect(speech.onJumpToUnit).toHaveBeenLastCalledWith("cell-a", 0);
      expect(speech.onJumpToUnit).toHaveBeenCalledTimes(2);
    });

    it("Play is keyboard operable", async () => {
      const user = userEvent.setup();
      const { speech } = playSpeech();
      renderPane(speech);

      // A real button: Enter and Space are the browser's, and they arrive as a
      // click — no key handler of ours. user-event plays the browser's part.
      const button = play(1);
      expect(button).toHaveAttribute("type", "button");
      expect(button).not.toHaveAttribute("tabindex");
      act(() => button.focus());
      expect(document.activeElement).toBe(button);
      // Focus reveals it, like a hover does.
      expect(shown()).toEqual([1]);
      await user.keyboard("{Enter}");
      expect(speech.onJumpToUnit).toHaveBeenCalledTimes(1);
      expect(speech.onJumpToUnit).toHaveBeenLastCalledWith("cell-a", 1);

      play(3).focus();
      await user.keyboard(" ");
      expect(speech.onJumpToUnit).toHaveBeenCalledTimes(2);
      expect(speech.onJumpToUnit).toHaveBeenLastCalledWith("cell-a", 3);
    });

    it("the playing unit's button is Pause", () => {
      const { speech } = playSpeech({ unitIndex: 1, unitTime: 0, unitDuration: null }, "speaking");
      renderPane(speech);

      expect(pinned()).toHaveAccessibleName("Pause");
      expect(pinned()).toHaveAttribute("data-playing");
      expect(pinned()).toHaveAttribute("data-shown");
      expect(play(0)).toHaveAccessibleName("Play from here");
      expect(shown()).toEqual([]);

      fireEvent.click(pinned()!);
      expect(speech.onPause).toHaveBeenCalledWith("cell-a");
      expect(speech.onJumpToUnit).not.toHaveBeenCalled();
    });

    it("paused, the pinned button plays from the paused unit", () => {
      const { speech } = playSpeech({ unitIndex: 3, unitTime: 0, unitDuration: null }, "paused");
      renderPane(speech);

      // Still shown, so the reader sees where the voice stopped.
      expect(pinned()).toHaveAttribute("data-shown");
      expect(pinned()).not.toHaveAttribute("data-playing");
      expect(pinned()).toHaveAccessibleName("Play from here");
      fireEvent.click(pinned()!);
      expect(speech.onJumpToUnit).toHaveBeenCalledWith("cell-a", 3);
      expect(speech.onPause).not.toHaveBeenCalled();
    });

    it("hover reveals only the hovered block's Play", () => {
      const { speech } = playSpeech({ unitIndex: 0, unitTime: 0, unitDuration: null }, "speaking");
      renderPane(speech);
      expect(shown()).toEqual([]);
      expect(pinned()).toHaveAttribute("data-shown");

      // Over a word inside the block, not the block itself: the delegation has
      // to find the block from whatever the pointer is over.
      fireEvent.mouseOver(screen.getByRole("link", { name: "the deploy guide" }));
      expect(shown()).toEqual([1]);

      fireEvent.mouseOver(screen.getByText(/^The third paragraph/));
      expect(shown()).toEqual([4]);

      // Moving onto the button itself keeps it shown rather than flickering off.
      fireEvent.mouseOver(play(4));
      expect(shown()).toEqual([4]);
      expect(pinned()).toHaveAttribute("data-shown");
    });

    it("unspoken blocks have no Play", () => {
      const { speech } = playSpeech();
      renderPane(speech);

      // One Play per speakable block — the heading and three paragraphs — and
      // none for the fence.
      expect(plays()).toHaveLength(4);
      const codeBlock = prose().querySelector<HTMLElement>(".code-block");
      expect(codeBlock).not.toBeNull();
      expect(codeBlock).not.toHaveAttribute("data-speak-unit");
      expect(codeBlock!.querySelector("[data-speak-unit]")).toBeNull();
      expect(codeBlock!.querySelector("button.play-from-here")).toBeNull();
    });

    it("a unit with no block has no Play", () => {
      const opening = [...FENCE, ...LONG_PARAGRAPHS].join("\n");
      const closing = [...LONG_PARAGRAPHS, ...FENCE].join("\n");

      for (const markdown of [opening, closing]) {
        const { speech, units } = playSpeech(null, "ready", markdown);
        const { unmount } = renderPane(speech);

        // The precondition: the fence is a unit of its own that speaks no block.
        const fenceUnit = units.findIndex((unit) => unit.source === "⟦code⟧");
        expect(fenceUnit).toBeGreaterThanOrEqual(0);
        expect(prose().querySelector(`[data-speak-unit="${fenceUnit}"]`)).toBeNull();

        // Every speakable block keeps its Play, and each one jumps to its own
        // block's first unit — never to the fence's.
        expect(plays()).toHaveLength(2);
        for (const block of Array.from(prose().querySelectorAll<HTMLElement>("[data-speak-unit]"))) {
          const unit = Number(block.getAttribute("data-speak-unit"));
          expect(unit).not.toBe(fenceUnit);
          fireEvent.mouseOver(block);
          fireEvent.click(play(unit));
          expect(speech.onJumpToUnit).toHaveBeenLastCalledWith("cell-a", unit);
        }
        unmount();
      }
    });

    it("a swapped answer gets its own Play buttons", () => {
      const fenceFirst = [...FENCE, ...LONG_PARAGRAPHS].join("\n");
      const first = playSpeech(null, "ready", fenceFirst);
      const normal = playSpeech();

      const view = renderPane(first.speech);
      const rerenderWith = (speech: GridSpeech): void =>
        view.rerender(
          <MemoryRouter>
            <AnswerPane sessionId="cell-a" speech={speech} send={() => true} />
          </MemoryRouter>,
        );

      expect(plays()).toHaveLength(2);
      rerenderWith(normal.speech);
      expect(plays()).toHaveLength(4);
      expect(blockOf(3)).toHaveTextContent(/^The second paragraph/);
      rerenderWith(first.speech);
      expect(plays()).toHaveLength(2);
    });
  });
});
