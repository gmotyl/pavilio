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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MOBILE_QUERY } from "../../../lib/breakpoints";
import { cssRule } from "../../shell/__tests__/hamburgerGeometry";
import { preferences } from "../../../preferences/declarations";
import { writePreference } from "../../../preferences/store";
import type { GridSpeech, SpeechUnit } from "../../speech/types";
import { emptyUtteranceQueue, type UtteranceQueue } from "../../speech/utteranceQueue";
import { AnswerPane } from "../AnswerPane";
import { __resetAnswerWaitingForTests } from "../answerWaiting";
import { SUBMIT_RETURN_MS, __resetPtySubmitForTests } from "../ptySubmit";
import { refreshSessions } from "../sessionStore";
import type { SessionMeta } from "../useTerminalSessions";

// The synthesis cache the rail peeks into. Nothing is warm and nothing
// subscribes: this file draws no units at all.
vi.mock("../../speech/synth", () => ({
  isSpeechSynthesized: () => false,
  speechCacheState: () => "cold",
  subscribeSpeechCache: () => () => {},
}));

// One of the draft tests puts a real answer under the cursor, which mounts the
// markdown renderer — and the renderer reaches mermaid's browser-only stack.
// No answer in this file holds a fence, so the mock costs nothing and keeps
// pulling the renderer in from being a reason not to, exactly as in
// `AnswerPane.test.tsx`.
vi.mock("../../markdown/MermaidDiagram", () => ({
  default: ({ chart }: { chart: string }) => <div data-testid="mermaid">{chart}</div>,
}));

/** Referentially stable — a fresh array per call is a `useSyncExternalStore` loop. */
const NO_UNITS: readonly SpeechUnit[] = Object.freeze([]);
const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();

/** A cell that has played nothing has heard nothing — shared, like every other
 *  "nothing here" snapshot on a host. */
const NOTHING_HEARD: ReadonlySet<string> = new Set<string>();

function makeSpeech(): GridSpeech {
  return {
    stateFor: () => "ready",
    queueFor: () => emptyUtteranceQueue,
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

/**
 * The two writes ONE submit makes: the body, and then the return that runs it
 * on a turn of its own.
 *
 * A submit is no longer a single `` `${text}\r` `` write, and the split is the
 * point rather than an implementation detail. Concatenated, the trailing `\r`
 * arrives as part of the pasted body — a TUI with bracketed paste enabled
 * inserts it as a newline in its editor instead of submitting on it, which is
 * the "the text landed in the prompt but never ran" bug. `waitFor` because the
 * return is scheduled, not written inline.
 */
const expectSubmitted = async (body: string): Promise<void> => {
  await waitFor(() => expect(send.mock.calls).toEqual([[body], ["\r"]]));
};

const onClose = vi.fn();
/** An ancestor of the pane — the cell, as far as a bubbling key is concerned. */
const cellKeys = vi.fn();
/** Everything that got past the React root: the window-level reach. */
const documentKeys = vi.fn();

/**
 * The tree a pane is mounted in — the cell around it included, because the
 * Escape test asserts what that ancestor did NOT see. Separate from
 * `renderPane` so a test can hand the same shape to `rerender` and keep the
 * React instance alive across a change of answer.
 */
const paneTree = (sessionId: string, speech: GridSpeech) => (
  // The router is for the markdown renderer, which links with `useNavigate` —
  // only the draft test that puts an answer under the cursor mounts it, but
  // one tree for every test is cheaper than two shapes to keep in step.
  <MemoryRouter>
    <div data-testid="cell" onKeyDown={cellKeys}>
      <AnswerPane
        sessionId={sessionId}
        speech={speech}
        onClose={onClose}
        send={send}
        autoOpen={false}
        onAutoOpenChange={() => {}}
      />
    </div>
  </MemoryRouter>
);

function renderPane(sessionId = "cell-a", speech: GridSpeech = makeSpeech()) {
  return render(paneTree(sessionId, speech));
}

/** A speech host with one answer under the cursor for every cell that asks. */
function speechWith(text: string): GridSpeech {
  const queue: UtteranceQueue = {
    previous: [],
    current: { id: text, sessionId: "cell-a", text, at: 1 },
    pending: [],
    cursor: 0,
  };
  return { ...makeSpeech(), queueFor: () => queue };
}

const fieldFor = (sessionId: string): HTMLTextAreaElement =>
  screen.getByTestId(`answer-pane-composer-${sessionId}`) as HTMLTextAreaElement;

const field = (): HTMLTextAreaElement => fieldFor("cell-a");

const maybeField = (): HTMLElement | null =>
  screen.queryByTestId("answer-pane-composer-cell-a");

const grip = (): HTMLElement | null => screen.queryByTestId("pane-resize-composer");

const sendButton = (): HTMLButtonElement =>
  screen.getByRole("button", { name: "Send to terminal" }) as HTMLButtonElement;

/** The pane's rows, top to bottom, by the class each one is known by. */
function regionOrder(): string[] {
  const root = screen.getByTestId("answer-pane-cell-a");
  return Array.from(root.children).map((row) => row.className.split(/\s+/)[0]);
}

const composerSwitch = (): HTMLInputElement =>
  screen.getByTestId("answer-pane-composer-on-cell-a") as HTMLInputElement;

/** The project every cell in this file belongs to — the composer height's scope. */
const PROJECT = "alpha";

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
 * The composer's height is remembered per PROJECT, and the composer is handed
 * a `sessionId` and nothing else — so the tab's session list is where the
 * project comes from, exactly as it is for the launcher row's
 * `pavilio-session-start` argument. `refreshSessions` is the store's own
 * fetch-and-publish, so this is the real path the project reaches the row by;
 * `test-setup.ts` clears the store between tests.
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

beforeEach(async () => {
  send.mockClear();
  // Module-level and keyed by session, so it outlives a test: a draft sent in
  // one case would otherwise still be "waiting" in the next, and the pane no
  // longer clears it on mount — the row does.
  __resetAnswerWaitingForTests();
  // Same reason, one module along: a queued return from the previous test
  // would fire into this one's `send`.
  __resetPtySubmitForTests();
  onClose.mockClear();
  cellKeys.mockClear();
  documentKeys.mockClear();
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  installMatchMedia(false);
  // Without a session list the pane cannot name its project, and a height
  // written here would land under a different key than the one the composer
  // reads.
  await seedSessions([session("cell-a", PROJECT), session("cell-b", PROJECT)]);
});

afterEach(() => {
  // `seedSessions` stubs `fetch`, and a stub left behind would answer the next
  // file's session load.
  vi.unstubAllGlobals();
});

describe("AnswerComposer", () => {
  it("sends the field's contents with a trailing return on Enter", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("yes, both scopes");
    await user.keyboard("{Enter}");

    // The body, and the return that runs it as a SEPARATE write — a send
    // without the `\r` leaves the agent waiting on a line that was never
    // submitted, and a send that carries the `\r` inside the same write leaves
    // the line sitting in the prompt with a newline in it.
    await expectSubmitted("yes, both scopes");
  });

  it("sends a multi-line reply as one body and one separate return", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    // Shift+Enter is the textarea's own newline — the same key Greg uses to
    // write the long, multi-paragraph replies the send used to stall on.
    await user.keyboard("first paragraph{Shift>}{Enter}{/Shift}second paragraph");
    expect(field().value).toBe("first paragraph\nsecond paragraph");

    await user.keyboard("{Enter}");

    // Every line in the ONE body write, and the submitting return after it.
    // Splitting the body per line would submit each paragraph on its own.
    await expectSubmitted("first paragraph\nsecond paragraph");
  });

  it("does not interleave two replies sent in quick succession", () => {
    vi.useFakeTimers();
    try {
      renderPane();

      fireEvent.change(field(), { target: { value: "first" } });
      fireEvent.keyDown(field(), { key: "Enter" });
      fireEvent.change(field(), { target: { value: "second" } });
      fireEvent.keyDown(field(), { key: "Enter" });

      // The second body is withheld until the first has been submitted:
      // `first second \r \r` would put both replies on one prompt line.
      expect(send.mock.calls).toEqual([["first"]]);

      vi.advanceTimersByTime(SUBMIT_RETURN_MS);
      expect(send.mock.calls).toEqual([["first"], ["\r"], ["second"]]);

      vi.advanceTimersByTime(SUBMIT_RETURN_MS);
      expect(send.mock.calls).toEqual([["first"], ["\r"], ["second"], ["\r"]]);
    } finally {
      vi.useRealTimers();
    }
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
    writePreference(preferences.answerComposerHeight, 140, PROJECT);
    renderPane();

    // No grip: an 8px rail on a phone sits under the thumb that is scrolling
    // the pane it borders.
    expect(grip()).toBeNull();
    // And one row, laid out by the viewport rather than by the stored height.
    expect(field().rows).toBe(1);
    expect(field().closest(".answer-pane-composer")).not.toHaveStyle({ height: "140px" });
  });

  it("sends what was typed, untrimmed", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(field());
    await user.keyboard("  indented  ");
    await user.keyboard("{Enter}");

    // The whitespace is the user's. `trim()` on the way out is the obvious
    // tidying to reach for, and it is wrong twice over: leading indentation in
    // a pasted snippet is part of the snippet, and a trailing space is how a
    // CLI is told the next token is an argument. Whitespace decides only
    // whether there is anything to send at all — never what is sent.
    await expectSubmitted("  indented  ");
  });

  it("opens at the declared default when nothing has been stored", () => {
    renderPane();

    // `preferences.answerComposerHeight` declares 62, and an unstored pane has
    // to open at it: two lines plus the field's padding, which is the shape the
    // BOUNDS floor is reasoned from.
    expect(field().closest(".answer-pane-composer")).toHaveStyle({ height: "62px" });
    expect(grip()).toHaveAttribute("aria-valuenow", "62");
  });

  it("opens at the height the grip last left behind", () => {
    writePreference(preferences.answerComposerHeight, 140, PROJECT);
    renderPane();

    expect(grip()).toBeInTheDocument();
    expect(field().closest(".answer-pane-composer")).toHaveStyle({ height: "140px" });
    expect(grip()).toHaveAttribute("aria-valuenow", "140");
  });

  /**
   * What a half-typed reply survives.
   *
   * All three criteria here are stated about the PANE — closed and reopened, a
   * new answer arriving, the reply sent — so they are asserted against a
   * mounted pane rather than against the draft store, which is pinned on its
   * own in `composerDrafts.test.ts`.
   *
   * Closing is Escape, not `unmount()`, and that is the whole point of
   * `PaneHarness`: `TerminalView` renders the pane only while it is open, so
   * the real close is the pane's own `onClose` taking it out of the tree. A
   * test that unmounted by hand would pin the remount but leave the close path
   * itself — the Escape handler, and anything a future hand hung off it —
   * untested, and a `clearDraft` added there would not redden a thing.
   */
  describe("drafts", () => {
    /**
     * The pane as its host renders it: on screen while it is open, gone when
     * it closes itself, and rebuilt from nothing when it is opened again.
     */
    function PaneHarness({ sessionId, speech }: { sessionId: string; speech: GridSpeech }) {
      const [open, setOpen] = useState(true);
      return (
        <MemoryRouter>
          <div data-testid="cell" onKeyDown={cellKeys}>
            <button data-testid="reopen" onClick={() => setOpen(true)}>
              Open the pane
            </button>
            {open ? (
              <AnswerPane
                sessionId={sessionId}
                speech={speech}
                onClose={() => setOpen(false)}
                send={send}
                autoOpen={false}
                onAutoOpenChange={() => {}}
              />
            ) : null}
          </div>
        </MemoryRouter>
      );
    }

    /** Escape from inside the field — the way a reader actually leaves the pane. */
    async function closePane(user: ReturnType<typeof userEvent.setup>): Promise<void> {
      await user.keyboard("{Escape}");
      // Genuinely out of the tree: every assertion after a reopen is about a
      // field that was built again, not one that was never taken down.
      expect(screen.queryByTestId("answer-pane-composer-cell-a")).toBeNull();
    }

    const reopenPane = (user: ReturnType<typeof userEvent.setup>): Promise<void> =>
      user.click(screen.getByTestId("reopen"));

    it("keeps a draft across closing and reopening the pane", async () => {
      const user = userEvent.setup();
      render(<PaneHarness sessionId="cell-a" speech={makeSpeech()} />);

      await user.click(field());
      await user.keyboard("not sent yet");

      await closePane(user);
      await reopenPane(user);

      expect(field().value).toBe("not sent yet");
      // And nothing was written to the PTY on the way: closing a pane is not
      // sending what was in it.
      expect(send).not.toHaveBeenCalled();
    });

    it("keeps a draft when a new answer arrives", async () => {
      const user = userEvent.setup();
      const second = speechWith("A second answer arrived.");
      const view = render(
        <PaneHarness sessionId="cell-a" speech={speechWith("The first answer.")} />,
      );

      await user.click(field());
      await user.keyboard("half a reply");

      view.rerender(<PaneHarness sessionId="cell-a" speech={second} />);

      // The new answer is on screen, and the reply being typed underneath it
      // is untouched — the cell answered again while the user was mid-sentence.
      expect(screen.getByTestId("answer-pane-body-cell-a")).toHaveTextContent(
        "A second answer arrived.",
      );
      expect(field().value).toBe("half a reply");

      // That much a `useState` nothing re-keyed would also survive. The claim
      // is stronger than the field's own state: the new answer did not clear
      // the STORED draft, so it is still there after the pane closes and opens.
      await user.click(field());
      await closePane(user);
      await reopenPane(user);

      expect(field().value).toBe("half a reply");
    });

    it("clears the draft only when it is sent", async () => {
      const user = userEvent.setup();
      render(<PaneHarness sessionId="cell-a" speech={makeSpeech()} />);

      await user.click(field());
      await user.keyboard("ship it");

      // Closing did not consume it — the "only" half of the criterion, and the
      // half that tells a draft which was KEPT from one that was never stored
      // in the first place. Without it the send assertion below would pass
      // against a composer that has no drafts at all.
      await closePane(user);
      await reopenPane(user);
      expect(field().value).toBe("ship it");

      await user.click(field());
      await user.keyboard("{Enter}");
      await expectSubmitted("ship it");

      // Sent, so consumed: reopening offers an empty field rather than the
      // reply the agent already has.
      await closePane(user);
      await reopenPane(user);

      expect(field().value).toBe("");
    });

    it("opens a second cell's pane with an empty composer", async () => {
      const user = userEvent.setup();
      const speechA = makeSpeech();
      const speechB = makeSpeech();
      // cell-b's pane is deliberately NOT in the first tree. The criterion is
      // about a pane being OPENED, and a composer reads its seed exactly once,
      // at mount: with both mounted up front cell-b reads the store BEFORE
      // cell-a has a draft in it, and from that moment the two fields are
      // independent `useState`s that a store with no keying at all — one
      // global string for the whole panel — would keep apart just as well.
      const view = render(
        <>
          {paneTree("cell-a", speechA)}
          {null}
        </>,
      );

      await user.click(fieldFor("cell-a"));
      await user.keyboard("for cell a only");

      // Opened now, with the neighbour's draft already sitting in the store.
      view.rerender(
        <>
          {paneTree("cell-a", speechA)}
          {paneTree("cell-b", speechB)}
        </>,
      );

      // The draft is the cell's, not the panel's: the neighbour opened empty
      // and stays empty while its neighbour is typed in.
      expect(fieldFor("cell-b").value).toBe("");

      await user.click(fieldFor("cell-b"));
      await user.keyboard("for cell b");

      expect(fieldFor("cell-a").value).toBe("for cell a only");
      expect(fieldFor("cell-b").value).toBe("for cell b");
    });
  });

  /**
   * The composer's designed shape.
   *
   * Greg's verdict on the shipped one was that it "does not look like design",
   * and the gap was structural rather than cosmetic: a bare borderless
   * textarea with the switch row UNDER it, no send button, and no key hint.
   * design.md puts the switches above the composer, gives the field a well of
   * its own, and ends the pane on a hint line — an order these tests read off
   * the DOM, and a well they read out of the stylesheet, because jsdom does no
   * layout and loads no CSS.
   */
  describe("the designed shape", () => {
    it("lays the pane's rows out in the design's order", () => {
      renderPane();

      // Body, then the two switches, then the grip, then the field, then the
      // hint. The switch row moving ABOVE the composer is the change: it was
      // the pane's footer when the auto-open switch was its only control, and
      // it stayed there when the composer arrived underneath it — which put
      // the reply box between the answer and its own switches.
      //
      // The pane's own drag row comes after all of them, because it IS the
      // pane's bottom edge: dragging it up shortens the whole column and
      // uncovers the terminal, where the grip two rows above it only moves the
      // boundary between the answer and the reply.
      expect(regionOrder()).toEqual([
        "answer-pane-body",
        "answer-pane-meta",
        "answer-pane-grip",
        "answer-pane-composer",
        "answer-pane-hint",
        "answer-pane-drag",
      ]);
    });

    it("names the composer's switch for what it does", () => {
      renderPane();

      // "Composer" named the control after the component. "Send to terminal"
      // is design.md's label and says where the text goes, which is the thing
      // the switch is actually deciding.
      expect(composerSwitch()).toBe(
        screen.getByRole("checkbox", { name: "Send to terminal" }),
      );
    });

    it("gives the field the design's well", () => {
      renderPane();

      // The placeholder says what the field is for, not merely that it is a
      // field: a reply typed here reaches the PTY, not a chat.
      expect(field()).toHaveAttribute("placeholder", "Reply to the terminal…");

      // Read out of the stylesheet — `getComputedStyle` in jsdom answers for a
      // rule it never saw, and `cssRule` throws on a renamed selector rather
      // than agreeing with nothing.
      const well = cssRule(".answer-pane-composer-field").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(well).toMatch(/(^|;)\s*background:\s*#101014\s*(;|$)/);
      expect(well).toMatch(/(^|;)\s*border:\s*1px solid var\(--border-default\)\s*(;|$)/);
      expect(well).toMatch(/(^|;)\s*border-radius:\s*6px\s*(;|$)/);
    });

    it("sends on the button exactly as it sends on Enter", async () => {
      const user = userEvent.setup();
      renderPane();

      await user.click(field());
      await user.keyboard("both scopes");
      await user.click(sendButton());

      // Identical to Enter, down to the return that submits the line on its
      // own turn, and the field is consumed the same way.
      await expectSubmitted("both scopes");
      expect(field().value).toBe("");
    });

    it("sends nothing from the button when the field is empty", async () => {
      const user = userEvent.setup();
      renderPane();

      await user.click(sendButton());
      await user.click(field());
      await user.keyboard("   ");
      await user.click(sendButton());

      // Whitespace is empty here too: a bare return reaches the agent as a
      // prompt containing nothing, and a button is easier to hit by accident
      // than a key.
      expect(send).not.toHaveBeenCalled();
    });

    it("drops the grip and the hint on a narrow viewport", () => {
      installMatchMedia(true);
      renderPane();

      // There is no Shift+Enter on a phone, so the hint has nothing to say;
      // the send button carries the whole action instead. The pane's own drag
      // row goes with them, for the reason the grip does: the pane is laid out
      // by the viewport there, and a 7px rail is a thumb's width from the
      // scroll it borders.
      expect(regionOrder()).toEqual([
        "answer-pane-body",
        "answer-pane-meta",
        "answer-pane-composer",
      ]);
      expect(grip()).toBeNull();
      expect(field().rows).toBe(1);
      // The button is the one control that does NOT go away with the keyboard
      // affordances — it is the only way to send on a phone.
      expect(sendButton()).toBeInTheDocument();
    });

    it("writes the key hint in the pane's own furniture ink", () => {
      renderPane();

      expect(screen.getByTestId("answer-pane-hint-cell-a")).toHaveTextContent(
        "ENTER SENDS · SHIFT+ENTER NEWLINE · ESC CLOSES THE ANSWER",
      );

      // The hint and the grip paint the pane's own ground rather than the
      // field's well, which is what keeps the composer reading as one box
      // inside the surface instead of three stacked strips.
      const surface = cssRule(".answer-pane").match(/background:\s*([^;]+)/)?.[1].trim();
      expect(surface).toBe("#17171d");
      expect(cssRule(".answer-pane-hint")).toMatch(
        new RegExp(`background:\\s*${surface}\\s*(;|$)`, "m"),
      );
      expect(cssRule(".answer-pane-grip")).toMatch(
        new RegExp(`background:\\s*${surface}\\s*(;|$)`, "m"),
      );
      // The grip's own bar, at design.md's size.
      const bar = cssRule(".answer-pane-grip-bar");
      expect(bar).toMatch(/(^|;)\s*width:\s*34px\s*(;|$)/);
      expect(bar).toMatch(/(^|;)\s*height:\s*2px\s*(;|$)/);
    });
  });

  /**
   * The composer's ground, read out of the stylesheet that owns it.
   *
   * `AnswerPane.test.tsx` says the composer "is darker than both of the other
   * two" and points here for the reading; this is that reading. jsdom loads no
   * stylesheet, so `getComputedStyle` would answer for a rule it never saw —
   * `cssRule` returns one selector's declaration block, throws when none
   * matches and refuses to guess when several do, which is what keeps a rename
   * from turning these into assertions about nothing.
   */
  describe("the third ground", () => {
    /** The ground a rule paints, comments out of the way first. */
    const ground = (selector: string): string => {
      const declarations = cssRule(selector).replace(/\/\*[\s\S]*?\*\//g, "");
      const found = [
        ...declarations.matchAll(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/g),
      ];
      if (found.length === 0) throw new Error(`${selector} paints no ground`);
      return found[found.length - 1][1].trim();
    };

    /** Rec. 709 relative luminance of a `#rrggbb`, 0 (black) to 255 (white). */
    const luminance = (hex: string): number => {
      const n = Number.parseInt(hex.slice(1), 16);
      return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    };

    /**
     * The xterm's own ground, read out of the module that hands it to the
     * terminal rather than repeated here as a literal. Importing
     * `terminalInstances` for it would pull xterm — and that module's
     * window/document listeners — into a file about a textarea, so the value is
     * read the way `cssRule` reads the stylesheet: from the file that owns it,
     * throwing rather than defaulting if it has moved.
     */
    const xtermGround = (): string => {
      const src = readFileSync(resolve("src/features/terminal/terminalInstances.ts"), "utf8");
      const found = src.match(/export const THEME = \{\s*background:\s*"(#[0-9a-fA-F]{6})"/);
      if (!found) throw new Error("no THEME.background in terminalInstances.ts");
      return found[1];
    };

    it("paints a ground darker than the pane's and the xterm's", () => {
      // The well is the FIELD's, not the whole row's. design.md's composer row
      // paints the speech ground and the box you type into is the darker one
      // inside it — which is also what makes the send button read as part of
      // the surface rather than as part of the input. The claim itself is
      // unchanged: three grounds, and yours is the darkest of them.
      const composer = ground(".answer-pane-composer-field");
      expect(composer).toBe("#101014");

      // Darker than BOTH, not merely different from them: the pane and the
      // speech bar share `#17171d`, the cell keeps the xterm's own, and what
      // YOU type is neither agent nor shell.
      const pane = ground(".answer-pane");
      expect(pane).toBe("#17171d");
      expect(luminance(composer)).toBeLessThan(luminance(pane));
      expect(luminance(composer)).toBeLessThan(luminance(xtermGround()));
    });
  });
});
