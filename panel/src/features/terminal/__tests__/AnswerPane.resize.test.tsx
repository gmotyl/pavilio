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
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MOBILE_QUERY } from "../../../lib/breakpoints";
import { cssRule } from "../../shell/__tests__/hamburgerGeometry";
import { preferences } from "../../../preferences/declarations";
import { readPreference, writePreference } from "../../../preferences/store";
import type { GridSpeech, SpeechUnit, Utterance } from "../../speech/types";
import type { UtteranceQueue } from "../../speech/utteranceQueue";
import { AnswerPane } from "../AnswerPane";
import { __resetSessionStoreForTests, refreshSessions } from "../sessionStore";
import type { SessionMeta } from "../useTerminalSessions";

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
/** A second cell of the SAME project — the two that share a height. */
const SIBLING = "cell-b";
/** The project both cells belong to, and the scope both heights are kept per. */
const PROJECT = "alpha";

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

function session(id: string, project: string): SessionMeta {
  return {
    id,
    name: id,
    project,
    cwd: `/srv/git/${project}`,
    pid: 4242,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * Puts a session list in the tab's store, the way a load does.
 *
 * The pane's height is remembered per PROJECT, and a cell is handed a
 * `sessionId` and nothing else — so the tab's session list is where the
 * project comes from, exactly as it is for the launcher row's
 * `pavilio-session-start` argument. `refreshSessions` is the store's own
 * fetch-and-publish, so this is the real path the project reaches the pane by
 * rather than a hand-set module field; `test-setup.ts` clears the store
 * between tests.
 */
async function seedSessions(sessions: SessionMeta[]): Promise<void> {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(sessions),
        }) as unknown as Promise<Response>,
    ),
  );
  await refreshSessions();
}

/**
 * The pane inside a terminal area of `areaHeight` pixels — the positioned box
 * `TerminalView` wraps the xterm container in, which is the pane's
 * `offsetParent` and its ceiling.
 *
 * `areaHeight` is a parameter rather than a constant because ZERO is a real
 * answer, not a missing one: it is what every box measures in jsdom, what a
 * detached element measures in a browser, and what any pane measures on the
 * frame before layout has run. The component has to tell that apart from an
 * area of no height, so a test has to be able to hand it either.
 */
interface RenderedPane {
  area: HTMLElement;
  /**
   * Draw the pane again, unchanged — a render this component has for reasons
   * of its own all day (a speech frame, a queue change, a resized cell) and
   * that no test here can trigger through its stubs. What it is used for is
   * the one thing that needs a SECOND render to be visible: a value the pane
   * reads during render, like the project its session belongs to, arriving
   * after the pane was already on screen.
   */
  redraw: () => void;
}

function renderPaneFor(sessionId = SESSION, areaHeight = AREA): RenderedPane {
  const area = document.createElement("div");
  Object.defineProperty(area, "clientHeight", { value: areaHeight, configurable: true });
  document.body.appendChild(area);
  const ui = () => (
    <MemoryRouter>
      <AnswerPane
        sessionId={sessionId}
        speech={makeSpeech()}
        onClose={() => {}}
        send={() => true}
        autoOpen={false}
        onAutoOpenChange={() => {}}
      />
    </MemoryRouter>
  );
  const { rerender } = render(ui(), { container: area });
  return { area, redraw: () => rerender(ui()) };
}

function renderPane(): RenderedPane {
  return renderPaneFor();
}

const paneFor = (sessionId: string): HTMLElement =>
  screen.getByTestId(`answer-pane-${sessionId}`);

const pane = (): HTMLElement => paneFor(SESSION);

const handleFor = (sessionId: string): HTMLElement | null =>
  screen.queryByTestId(`pane-resize-answer-pane-${sessionId}`);

const handle = (): HTMLElement | null => handleFor(SESSION);

/** The composer row of a given cell's pane — the other height that is shared. */
const composerRowFor = (sessionId: string): HTMLElement =>
  screen
    .getByTestId(`answer-pane-composer-${sessionId}`)
    .closest(".answer-pane-composer") as HTMLElement;

beforeEach(async () => {
  // jsdom implements none of these
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    StubResizeObserver;
  installMatchMedia(false);
  // Both cells belong to one project, because that is the scope both heights
  // are now kept per: without a list the pane cannot name its project.
  await seedSessions([session(SESSION, PROJECT), session(SIBLING, PROJECT)]);
});

afterEach(() => {
  // The area is this file's own container, so testing-library does not take it
  // away — and a pane left in the document is one the next test would find.
  document.body.innerHTML = "";
  // `seedSessions` stubs `fetch`, and a stub left behind would answer the next
  // file's session load.
  vi.unstubAllGlobals();
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

    // Read back under the CELL'S PROJECT, which is the scope the drag wrote
    // it under: the height belongs to the project the cell is in, not to the
    // browser.
    const stored = readPreference(preferences.answerPaneHeight, PROJECT);
    expect(stored).toBe(560);
    expect(Number.isInteger(stored)).toBe(true);
  });

  it("drops the handle on a narrow viewport", () => {
    installMatchMedia(true);
    // Stored, so that the absence below is the viewport's doing and not an
    // empty preference's.
    writePreference(preferences.answerPaneHeight, 240, PROJECT);
    renderPane();

    // No rail: an 8px pointer target on a phone sits under the thumb that is
    // scrolling the pane it borders.
    expect(handle()).toBeNull();
    // And no stored height either — the pane is laid out by the viewport
    // there, exactly as the composer's row is.
    expect(pane().style.height).toBe("");
  });

  /**
   * The zero-measurement guard, pinned.
   *
   * `clientHeight` is 0 for every box in jsdom, for a detached element in a
   * real browser, and for any element on the frame before layout has run. The
   * component reads that as "not measured yet" and applies NO height, leaving
   * the stylesheet's four insets to say "cover the terminal area".
   *
   * Without the guard the measurement would be 0, the bounds would clamp to
   * `Math.max(120, 0)` and every pane would open at its 120px floor with the
   * terminal exposed below it — the behaviour change #115 rejected — on the
   * first frame of every real mount. Nothing else in this suite sees it: the
   * other tests all declare a measured area, so they never reach the branch.
   */
  it("applies no height while the terminal area measures zero", () => {
    renderPaneFor(SESSION, 0);

    // Not "120px", and not "0px": no height at all, which is the only thing
    // that leaves `.answer-pane`'s bottom inset in force.
    expect(pane().style.height).toBe("");
    expect(pane().style.bottom).toBe("");
    // The handle is still there — the pane is resizable, it simply has no
    // ceiling to be resized against yet — and it reports the full default
    // rather than the floor.
    expect(handle()).not.toBeNull();
    expect(handle()).toHaveAttribute("aria-valuenow", "4000");
  });

  it("shares a height between two cells of the same project", () => {
    // Accepted, and asserted so that it is a decision rather than a surprise:
    // the scope is the PROJECT, so two cells of one project are two readers of
    // one number. A per-cell height would have to be keyed by a session id,
    // which names nothing after a restart.
    renderPaneFor(SESSION);
    renderPaneFor(SIBLING);

    const rail = handleFor(SESSION)!;
    fireEvent.pointerDown(rail, { pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(rail, { pointerId: 1, clientY: 420 });
    fireEvent.pointerUp(rail, { pointerId: 1, clientY: 420 });

    // The drag settled at 520 and the sibling followed it, because the write
    // notifies every hook mounted on the key — one project, one height.
    expect(pane().style.height).toBe(`${AREA - 80}px`);
    expect(paneFor(SIBLING).style.height).toBe(`${AREA - 80}px`);

    // Both heights, not just the pane's: the composer's is the same scope and
    // the same sharing.
    // `act`, because this write is not a user gesture: it lands in the store,
    // which notifies both composers' hooks — and a `setState` React did not
    // schedule is not flushed before the next assertion reads the DOM.
    act(() => writePreference(preferences.answerComposerHeight, 140, PROJECT));
    expect(composerRowFor(SESSION)).toHaveStyle({ height: "140px" });
    expect(composerRowFor(SIBLING)).toHaveStyle({ height: "140px" });
  });

  /**
   * The row the handle lives in, read back out of the stylesheet that owns it.
   *
   * Both declarations are load-bearing and neither is visible to jsdom, which
   * does no layout: `position: relative` is what the `PaneResizer` inside the
   * row is `absolute bottom-0` against — without it the rail escapes to the
   * nearest positioned ancestor, the pane itself, and lands on the pane's
   * bottom edge over whatever row is actually there — and `flex: none` is what
   * stops the 7px row claiming the column's slack from the body above it.
   *
   * Gutting this rule to nothing leaves every behavioural test in the terminal
   * and shell suites green, which is exactly why the claim is made here.
   */
  it("gives the drag row its own position and none of the column's slack", () => {
    const drag = cssRule(".answer-pane-drag").replace(/\/\*[\s\S]*?\*\//g, "");

    expect(drag).toMatch(/(^|;)\s*position:\s*relative\s*(;|$)/);
    expect(drag).toMatch(/(^|;)\s*flex:\s*none\s*(;|$)/);
    // The row's own height, and the gesture it advertises — a 7px strip with
    // no `ns-resize` cursor is a handle nobody can find.
    expect(drag).toMatch(/(^|;)\s*height:\s*7px\s*(;|$)/);
    expect(drag).toMatch(/(^|;)\s*cursor:\s*ns-resize\s*(;|$)/);
  });
});

/**
 * A cell whose project the tab's session list cannot name.
 *
 * Both heights are `project`-scoped, and the project is looked up rather than
 * threaded down — so there is a real state in which the pane is on screen and
 * the scope is not known yet: a cell mounted by `QuickTerminalModal`, which
 * fetches its own list and never touches `sessionStore`, and every cell on
 * screen for the 8s after a failed session load. The store is emptied here to
 * put the pane in exactly that state.
 *
 * What the pane must do there is what `writeTerminalFocus` already does with an
 * unresolved project: show the declared default, keep working under the hand,
 * and WRITE NOTHING. A placeholder scope would write — and the number would go
 * under a key nothing reads back once the project resolves, so the drag the
 * user just made would be silently discarded, with every unnameable cell in the
 * tab sharing the one value in the meantime.
 */
describe("the answer pane with no project to name", () => {
  /** Both `project`-scoped heights, under every scope they could be keyed by. */
  function heightKeysInStorage(): string[] {
    const prefixes = [
      preferences.answerPaneHeight.key,
      preferences.answerComposerHeight.key,
    ];
    const keys: string[] = [];
    // `Object.keys` answers for the Storage OBJECT, not its entries — the
    // index API is the only one that enumerates what was actually stored.
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key !== null && prefixes.some((p) => key === p || key.startsWith(`${p}@`))) {
        keys.push(key);
      }
    }
    return keys;
  }

  beforeEach(() => {
    // Undo the file's own seeding: this is the cold store, which is what the
    // store holds before its first successful load and what it returns to
    // after a failed one.
    __resetSessionStoreForTests();
  });

  it("drags without persisting either height", () => {
    renderPane();

    // It renders, and at the declared default clamped to the area — the pane
    // covers the terminal exactly as it does for a named project.
    expect(pane().style.height).toBe(`${AREA}px`);

    const rail = handle()!;
    fireEvent.pointerDown(rail, { pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(rail, { pointerId: 1, clientY: 420 });
    // The drag WORKS: the pane follows the pointer, because an unresolved
    // scope is a reason not to store a number, not a reason to refuse one.
    expect(pane().style.height).toBe(`${AREA - 80}px`);

    fireEvent.pointerUp(rail, { pointerId: 1, clientY: 420 });
    // And it holds for the life of the pane, in the hook's own state.
    expect(pane().style.height).toBe(`${AREA - 80}px`);

    // The composer's rail is the same hook and the same scope: drag it too, so
    // the assertion below covers both heights rather than one.
    const composerRail = screen.getByTestId("pane-resize-composer");
    fireEvent.pointerDown(composerRail, { pointerId: 2, clientY: 300 });
    fireEvent.pointerMove(composerRail, { pointerId: 2, clientY: 260 });
    expect(composerRowFor(SESSION)).toHaveStyle({ height: "102px" });
    fireEvent.pointerUp(composerRail, { pointerId: 2, clientY: 260 });

    // Nothing stored, under any scope — not the real project, and not a
    // placeholder standing in for one. Both declarations are `portable: false`,
    // so `localStorage` is the whole surface a write could have reached.
    expect(heightKeysInStorage()).toEqual([]);
  });

  it("adopts the project's stored height once the list names one", async () => {
    // What the pane gives up by writing nothing: only the number from the gap.
    // The moment the project resolves, the pane is a reader of that project's
    // height like any other.
    writePreference(preferences.answerPaneHeight, 300, PROJECT);
    const rendered = renderPane();
    expect(pane().style.height).toBe(`${AREA}px`);

    const { redraw } = rendered;
    await seedSessions([session(SESSION, PROJECT)]);
    // The lookup is a plain read during render, so the project reaches the
    // pane on its next render, whatever causes that render. Nothing here
    // touches either height.
    redraw();

    expect(pane().style.height).toBe("300px");
  });
});
