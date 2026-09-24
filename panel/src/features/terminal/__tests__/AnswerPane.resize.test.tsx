/**
 * The pane's bottom edge — the handle that shortens it, and what shortening
 * uncovers.
 *
 * The pane is `position: absolute` over the terminal with all four insets at
 * zero, so "how tall is it" is not a question the stylesheet answers on its
 * own any more: an unresized pane is as tall as the terminal area it is
 * absolute within, and a dragged one is as tall as the number the drag left
 * behind. Both of those are applied as inline style by the component, which is
 * what these tests read — never `getComputedStyle`, which in a jsdom that
 * loads no stylesheet would answer for a rule it never saw.
 *
 * ## Why the pane is rendered into an area of a known height
 *
 * jsdom does no layout, so every box measures zero. The pane's ceiling is the
 * area it is inside — it must never hang past the bottom of the cell — so the
 * tests here supply that measurement the one way a test can: the container the
 * pane is rendered into declares its own `clientHeight`. That is the fact the
 * component reads in a browser too, off the same element.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MOBILE_QUERY } from "../../../lib/breakpoints";
import { preferences } from "../../../preferences/declarations";
import { readPreference, writePreference } from "../../../preferences/store";
import type { GridSpeech, SpeechUnit, Utterance } from "../../speech/types";
import type { UtteranceQueue } from "../../speech/utteranceQueue";
import { AnswerPane } from "../AnswerPane";

// The activity channel opens a WebSocket at import time and re-arms a 2s
// reconnect timer whenever that socket closes. A socket that never closes
// keeps jsdom from dialling `ws://localhost/ws/terminal-activity` and leaving
// that timer behind in this file.
vi.hoisted(() => {
  class QuietSocket {
    onopen: unknown = null;
    onmessage: unknown = null;
    onclose: unknown = null;
    onerror: unknown = null;
    close(): void {}
    send(): void {}
  }
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = QuietSocket;
});

// The synthesis cache the rail peeks into. Nothing is warm and nothing
// subscribes: no test here draws a segment.
vi.mock("../../speech/synth", () => ({
  isSpeechSynthesized: () => false,
  speechCacheState: () => "cold",
  subscribeSpeechCache: () => () => {},
}));

// mermaid's rendering stack is browser-only and no answer here holds a fence.
vi.mock("../../markdown/MermaidDiagram", () => ({
  default: ({ chart }: { chart: string }) => <div data-testid="mermaid">{chart}</div>,
}));

const SESSION = "cell-a";

/** The height of the terminal area the pane is rendered into. */
const AREA = 600;

/** Referentially stable — a fresh array per call is a `useSyncExternalStore` loop. */
const NO_UNITS: readonly SpeechUnit[] = Object.freeze([]);
const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();
const NOTHING_HEARD: ReadonlySet<string> = new Set<string>();

const ANSWER: Utterance = {
  id: "u1",
  sessionId: SESSION,
  text: "The answer the pane is showing while its bottom edge is dragged.",
  at: 1,
};

const QUEUE: UtteranceQueue = {
  previous: [],
  current: ANSWER,
  pending: [],
  cursor: 0,
};

function makeSpeech(): GridSpeech {
  return {
    stateFor: () => "ready",
    queueFor: () => QUEUE,
    heardFor: () => NOTHING_HEARD,
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
    onNewestAnswer: vi.fn(),
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

/** Controllable matchMedia stub — jsdom has none. */
function installMatchMedia(mobile: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query === MOBILE_QUERY ? mobile : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

/**
 * The pane inside a terminal area of {@link AREA} pixels — the positioned box
 * `TerminalView` wraps the xterm container in, which is the pane's
 * `offsetParent` and its ceiling.
 */
function renderPane(): HTMLElement {
  const area = document.createElement("div");
  Object.defineProperty(area, "clientHeight", { value: AREA, configurable: true });
  document.body.appendChild(area);
  render(
    <MemoryRouter>
      <AnswerPane
        sessionId={SESSION}
        speech={makeSpeech()}
        onClose={() => {}}
        send={() => {}}
        autoOpen={false}
        onAutoOpenChange={() => {}}
      />
    </MemoryRouter>,
    { container: area },
  );
  return area;
}

const pane = (): HTMLElement => screen.getByTestId(`answer-pane-${SESSION}`);

const handle = (): HTMLElement | null =>
  screen.queryByTestId(`pane-resize-answer-pane-${SESSION}`);

beforeEach(() => {
  // jsdom implements none of these
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    StubResizeObserver;
  installMatchMedia(false);
});

afterEach(() => {
  // The area is this file's own container, so testing-library does not take it
  // away — and a pane left in the document is one the next test would find.
  document.body.innerHTML = "";
});

describe("the answer pane's bottom edge", () => {
  it("uncovers the terminal when the pane is shortened", () => {
    renderPane();

    // Before the drag: the pane is as tall as the area it is in, which is what
    // "covers the terminal" means for a box pinned to the area's top edge.
    expect(pane().style.height).toBe(`${AREA}px`);

    const rail = handle();
    expect(rail).not.toBeNull();

    fireEvent.pointerDown(rail!, { pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(rail!, { pointerId: 1, clientY: 460 });

    // 40px up the screen is 40px off the pane...
    expect(pane().style.height).toBe(`${AREA - 40}px`);
    // ...and the bottom inset the stylesheet pins it by is given up, so the
    // strip the pane no longer occupies is terminal again rather than a pane
    // stretched to both edges.
    expect(pane().style.bottom).toBe("auto");
    expect(Number.parseInt(pane().style.height, 10)).toBeLessThan(AREA);
  });

  it("persists the settled height to the preference, as a whole number", () => {
    renderPane();
    const rail = handle()!;

    fireEvent.pointerDown(rail, { pointerId: 1, clientY: 500 });
    // A pointer coordinate is not an integer — a trackpad, a scaled display and
    // a touch digitizer all report fractions — and what is written here is read
    // back as a CSS length on the next mount.
    fireEvent.pointerMove(rail, { pointerId: 1, clientY: 460.4 });
    fireEvent.pointerUp(rail, { pointerId: 1, clientY: 460.4 });

    const stored = readPreference(preferences.answerPaneHeight);
    expect(stored).toBe(560);
    expect(Number.isInteger(stored)).toBe(true);
  });

  it("drops the handle on a narrow viewport", () => {
    installMatchMedia(true);
    // Stored, so that the absence below is the viewport's doing and not an
    // empty preference's.
    writePreference(preferences.answerPaneHeight, 240);
    renderPane();

    // No rail: an 8px pointer target on a phone sits under the thumb that is
    // scrolling the pane it borders.
    expect(handle()).toBeNull();
    // And no stored height either — the pane is laid out by the viewport
    // there, exactly as the composer's row is.
    expect(pane().style.height).toBe("");
  });
});
