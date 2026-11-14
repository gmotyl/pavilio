/**
 * The composer's draft at the CELL level: a whole `TerminalView` (speech row
 * visible, answer pane open, composer on) under a host that can do the two
 * things a live grid does to a cell while the user is typing a reply —
 *
 * - file a NEW answer in the cell's queue (an arrival), and
 * - REMOUNT the cell's subtree with the same session: maximize, grid presets,
 *   drag and seam resize swap the grid's body, so the cell's components are
 *   rebuilt while `composerDrafts`, `answerPaneState` and the pooled xterm
 *   live on outside React. The host does that the way the grid does it, by
 *   replacing the element the view sits in (a new React `key`).
 *
 * The pane-level test ("keeps a draft when a new answer arrives") proves
 * nothing here: there the pane's host never changes. What this file asks is
 * whether keystrokes typed AFTER the rebuild still reach the field — so after
 * a remount the test types with `user.keyboard` without clicking the field
 * again, and the keys land wherever focus really is.
 *
 * Scenarios R1–R5 of the change `2026-10-07-composer-draft-lost-on-answer`.
 */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setStoredAutoOpenAnswer } from "../../speech/autoOpenAnswer";
import { prepare } from "../../speech/prepare";
import type { GridSpeech } from "../../speech/types";
import {
  emptyUtteranceQueue,
  utteranceQueueReducer,
  type UtteranceQueue,
} from "../../speech/utteranceQueue";
import { StubResizeObserver, installMatchMedia } from "../../../test-utils";
import { readySpeech } from "./answerPane.harness";

// The pool as a mounted cell sees it: each holder carries an xterm helper
// textarea and the instance's `focus` lands DOM focus on it, as the real
// terminal does — so a cell that refocuses its terminal on mount really takes
// the keyboard away from wherever it was.
vi.mock("../terminalInstances", async () =>
  (await import("./answerPane.mocks")).terminalViewInstancesMock(),
);
vi.mock("../useMobileReconnect", () => ({ useMobileReconnect: () => {} }));
vi.mock("../../markdown/MermaidDiagram", async () => (await import("./answerPane.mocks")).mermaidMock());
vi.mock("../../speech/synth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../speech/synth")>()),
  ...(await import("./answerPane.mocks")).synthMock(),
}));

// Imported after the mocks so they pick them up.
const { TerminalView } = await import("../TerminalView");
const { forgetAnswerPane, setAnswerPaneOpen } = await import("../answerPaneState");
const { __resetComposerDraftsForTests, getDraft } = await import("../composerDrafts");

const SESSION = "cell-a";
/** Answer `n`'s text: every arrival says something new, so the pane visibly moves to it. */
const answerText = (n: number): string =>
  `# Deploy plan ${n}\n\nThe migration has to finish before traffic moves.\n`;

/**
 * A ready host with one answer already under the cursor (old news — it seeds
 * the cell's seen set) and `arrive` to file a new one. The cell only sees an
 * arrival once it is re-rendered with the new queue reference.
 */
function speechHost(): { speech: GridSpeech; arrive: () => void } {
  let at = 1;
  let units = prepare(answerText(at)).units;
  const file = (base: UtteranceQueue): UtteranceQueue => {
    const text = answerText(at);
    units = prepare(text).units;
    return utteranceQueueReducer(base, {
      type: "arrived",
      utterance: { id: `${SESSION}-u-${at}`, sessionId: SESSION, text, at: at++ },
      speaking: false,
    });
  };
  let queue = file(emptyUtteranceQueue);
  const speech = readySpeech({
    queueFor: () => queue,
    unitsFor: () => units,
    progressFor: () => null,
  });
  return {
    speech,
    arrive: () => {
      queue = file(queue);
    },
  };
}

/**
 * The grid's body, reduced to what matters: the view sits in an element whose
 * `key` is the body's generation. Bumping it rebuilds the cell exactly the way
 * the grid swapping its body subtree does — same session, fresh components.
 * The cell is the grid's focused one: the one the user is replying in.
 */
function body(speech: GridSpeech, generation: number) {
  return (
    <MemoryRouter>
      <div key={generation} data-testid="grid-body">
        <TerminalView sessionId={SESSION} speech={speech} focused speechBarVisible />
      </div>
    </MemoryRouter>
  );
}

/** Lets the mount effects' rAF (the focused cell's terminal focus) and settle timer run. */
async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
}

const field = (): HTMLTextAreaElement =>
  screen.getByTestId(`answer-pane-composer-${SESSION}`) as HTMLTextAreaElement;

/** What holds the keyboard, named so a failure says where the keys went. */
function activeName(): string {
  const el = document.activeElement;
  if (!el || el === document.body) return "body";
  if (el === field()) return "composer";
  const label = el.getAttribute("aria-label");
  const testId = el.getAttribute("data-testid");
  return `${el.tagName.toLowerCase()}${label ? `[aria-label="${label}"]` : ""}${testId ? `[data-testid="${testId}"]` : ""}`;
}

/** The three facts every scenario is judged on, in one object so a diff shows all of them. */
const observe = () => ({ field: field().value, store: getDraft(SESSION), active: activeName() });

/** One cell with its pane open (by the eye's store write) and settled. */
async function mountOpen() {
  const host = speechHost();
  let generation = 0;
  setAnswerPaneOpen(SESSION, true, { byUser: true });
  const view = render(body(host.speech, generation));
  await settle();
  return {
    ...host,
    /** Re-render the same cell: hands it the current queue. */
    rerender: () => view.rerender(body(host.speech, generation)),
    /** Rebuild the cell's subtree, the grid's way. */
    remount: () => view.rerender(body(host.speech, ++generation)),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  installMatchMedia();
  forgetAnswerPane(SESSION);
  forgetAnswerPane("cell-b");
  __resetComposerDraftsForTests();
  setStoredAutoOpenAnswer(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the composer draft across an arrival and a cell remount", () => {
  it("keeps every character typed across an arriving answer", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const cell = await mountOpen();

    await user.click(field());
    await user.keyboard("half a re");

    cell.arrive();
    cell.rerender();
    await settle();
    // The arrival really reached the pane — without this the scenario would
    // pass just as well with no answer having arrived at all.
    expect(screen.getByTestId(`answer-pane-body-${SESSION}`)).toHaveTextContent("Deploy plan 2");

    await user.keyboard("ply");

    expect(observe()).toEqual({ field: "half a reply", store: "half a reply", active: "composer" });
  });

  it("keeps the draft and later keystrokes when the cell is rebuilt mid-typing", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const cell = await mountOpen();

    await user.click(field());
    await user.keyboard("half a re");

    cell.remount();
    await settle();

    // No click: the keys go wherever the rebuilt cell left focus.
    await user.keyboard("ply");

    expect(observe()).toEqual({ field: "half a reply", store: "half a reply", active: "composer" });
  });

  it("keeps the draft when an arriving answer rebuilds the cell", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const cell = await mountOpen();

    await user.click(field());
    await user.keyboard("half a re");

    cell.arrive();
    cell.remount();
    await settle();

    await user.keyboard("ply");

    expect(observe()).toEqual({ field: "half a reply", store: "half a reply", active: "composer" });
  });

  it("a rebuilt composer that held focus keeps focus and caret", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const cell = await mountOpen();

    await user.click(field());
    await user.keyboard("half a reply");
    // The caret mid-text, neither at the start nor at the end: a rebuilt
    // textarea starts at [0,0] in jsdom and wherever the browser puts it in a
    // real one, so only a caret that was really restored passes.
    await user.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    expect(field().selectionStart).toBe(9);

    cell.arrive();
    cell.remount();
    await settle();

    expect({
      ...observe(),
      selection: [field().selectionStart, field().selectionEnd],
    }).toEqual({
      field: "half a reply",
      store: "half a reply",
      active: "composer",
      selection: [9, 9],
    });
  });

  it("an arriving answer does not focus a composer the user was not in", async () => {
    const host = speechHost();
    let generation = 0;
    // Pane closed: the arrival is what opens it.
    const view = render(body(host.speech, generation));
    await settle();
    expect(screen.queryByTestId(`answer-pane-${SESSION}`)).toBeNull();

    host.arrive();
    view.rerender(body(host.speech, generation));
    await settle();
    // It auto-opened, with the composer in it — and the composer was not focused.
    expect(screen.getByTestId(`answer-pane-${SESSION}`)).toBeInTheDocument();
    expect(document.activeElement).not.toBe(field());
    // Where it went instead: the pane's root, as an opening pane always does.
    expect(activeName()).toBe('div[aria-label="Answer"][data-testid="answer-pane-cell-a"]');

    // Nor by a further arrival, nor by one that rebuilds the cell.
    host.arrive();
    view.rerender(body(host.speech, generation));
    await settle();
    expect(document.activeElement).not.toBe(field());

    host.arrive();
    view.rerender(body(host.speech, ++generation));
    await settle();
    expect(document.activeElement).not.toBe(field());
    // The rebuilt focused cell still hands the keyboard to its terminal: the
    // terminal yields only to a composer that really held focus, not to every
    // remount.
    expect(activeName()).toBe('textarea[aria-label="terminal input cell-a"]');
    expect(field().value).toBe("");
  });

  it("a remount after the user left the composer does not refocus it", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const cell = await mountOpen();

    await user.click(field());
    await user.keyboard("half a re");
    // Clicked elsewhere: the reply is parked, the user is not in it any more.
    await user.click(screen.getByTestId(`answer-pane-body-${SESSION}`));
    expect(document.activeElement).not.toBe(field());

    cell.remount();
    await settle();

    expect(observe()).toEqual({
      field: "half a re",
      store: "half a re",
      active: 'textarea[aria-label="terminal input cell-a"]',
    });
  });

  it("a caret held by a pane closed mid-typing does not focus the composer on a later open", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await mountOpen();

    await user.click(field());
    await user.keyboard("half a re");

    // Closed while the field holds focus: the composer unmounts holding the
    // caret, and nothing mounts in the same commit to reclaim it.
    act(() => setAnswerPaneOpen(SESSION, false));
    expect(screen.queryByTestId(`answer-pane-${SESSION}`)).toBeNull();
    // The end of the task the composer was taken down in: the hold is dropped.
    await settle();

    // Opened again much later, by the eye: nobody was typing in this field.
    act(() => setAnswerPaneOpen(SESSION, true, { byUser: true }));
    await settle();

    expect(field().value).toBe("half a re");
    expect(document.activeElement).not.toBe(field());
  });

  it("the focused cell's terminal yields only to a composer inside that cell", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const OTHER = "cell-b";
    const host = speechHost();
    const grid = (focusedId: string) => (
      <MemoryRouter>
        <TerminalView sessionId={SESSION} speech={host.speech} focused={focusedId === SESSION} speechBarVisible />
        <TerminalView sessionId={OTHER} speech={host.speech} focused={focusedId === OTHER} speechBarVisible />
      </MemoryRouter>
    );
    setAnswerPaneOpen(SESSION, true, { byUser: true });
    const view = render(grid(SESSION));
    await settle();

    await user.click(field());
    await user.keyboard("half a re");
    expect(document.activeElement).toBe(field());

    // The user moves to cell B: B's terminal takes the keyboard, because the
    // composer holding focus is A's, not B's.
    view.rerender(grid(OTHER));
    await settle();

    expect(activeName()).toBe(`textarea[aria-label="terminal input ${OTHER}"]`);
    expect(getDraft(SESSION)).toBe("half a re");
  });
});
