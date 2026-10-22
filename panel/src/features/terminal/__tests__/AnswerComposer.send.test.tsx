/**
 * The answer composer, mounted the way a user meets it: sending, drafts, the
 * designed shape, the mobile auto-grow, and the socket repair a focus starts.
 *
 * One file, one `describe` per former file (`AnswerComposer.test.tsx` as
 * "send", `.autogrow`, `.focusReconnect` as "focus repair"); each section
 * keeps its own fixtures and hooks, and its original header sits above it.
 * Module mocks are file-wide, so they are listed once here:
 *
 * - xterm and its addons are faked for the focus section, which mounts the
 *   REAL terminal pool (see its header); no other section acquires a terminal,
 *   so the fakes are inert there.
 * - the activity channel is stubbed at the channel, for the same section; the
 *   others never change a cell's activity, so `idle` throughout is what the
 *   real channel would have answered them too.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cssRule } from "../../shell/__tests__/hamburgerGeometry";
import { preferences } from "../../../preferences/declarations";
import { writePreference } from "../../../preferences/store";
import type { GridSpeech } from "../../speech/types";
import type { UtteranceQueue } from "../../speech/utteranceQueue";
import { AnswerPane } from "../AnswerPane";
import { __resetAnswerWaitingForTests } from "../answerWaiting";
import { SUBMIT_RETURN_MS, __resetPtySubmitForTests } from "../ptySubmit";
import { refreshSessions } from "../sessionStore";
import type { SessionMeta } from "../useTerminalSessions";
import { installMatchMedia, StubResizeObserver } from "../../../test-utils";
import { onSubmitted, readySpeech, renderComposer, renderPane } from "./answerPane.harness";
import { __resetComposerDraftsForTests } from "../composerDrafts";

// The synthesis cache the rail peeks into. Nothing is warm and nothing
// subscribes: this file draws no units at all.
vi.mock("../../speech/synth", async () => (await import("./answerPane.mocks")).synthMock());

// One of the draft tests puts a real answer under the cursor, which mounts the
// markdown renderer — and the renderer reaches mermaid's browser-only stack.
// No answer in this file holds a fence, so the mock costs nothing and keeps
// pulling the renderer in from being a reason not to, exactly as in
// `AnswerPane.test.tsx`.
vi.mock("../../markdown/MermaidDiagram", async () => (await import("./answerPane.mocks")).mermaidMock());

// jsdom has none of the surface xterm measures itself against, and this file
// cares only about the ws lifecycle behind the pool — the same stubs
// `terminalInstances.test.ts` installs, for the same reason.
vi.mock("@xterm/xterm", () => {
  class FakeTerminal {
    cols = 80;
    rows = 24;
    buffer = {
      active: {
        viewportY: 0,
        baseY: 0,
        getLine: (_index: number) =>
          undefined as { translateToString: (trim?: boolean) => string } | undefined,
      },
    };
    loadAddon = vi.fn();
    open = vi.fn();
    write = vi.fn();
    focus = vi.fn();
    scrollLines = vi.fn();
    dispose = vi.fn();
    refresh = vi.fn();
    attachCustomKeyEventHandler = vi.fn();
    onData = vi.fn((_cb: (data: string) => void) => ({ dispose: vi.fn() }));
  }
  return { Terminal: FakeTerminal };
});

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));

vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

/**
 * The LED the composer's focus has always dismissed.
 *
 * Stubbed at the CHANNEL rather than at `attentionArrival`, so the dismissal
 * runs its real path: the rule reads the state through here and writes the
 * frame through the pool, and the last case asserts that frame on the socket.
 */
const activity = vi.hoisted(() => ({ state: "idle" as "idle" | "busy" | "attention" }));

vi.mock("../useTerminalActivityChannel", () => ({
  getActivityState: () => activity.state,
  useActivityState: () => activity.state,
  // The waiting row watches the cell through this; nothing here changes state
  // mid-test, so the subscription is a no-op that unsubscribes cleanly.
  subscribeActivity: () => () => {},
}));

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
describe("send", () => {
  /** A live socket: the write landed. `send` reports delivery now, and a stub
   *  that returned nothing would read as a socket that is not OPEN. */
  const send = vi.fn((_data: string) => true);

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
        />
      </div>
    </MemoryRouter>
  );

  function renderPane(sessionId = "cell-a", speech: GridSpeech = readySpeech()) {
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
    return { ...readySpeech(), queueFor: () => queue };
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
    installMatchMedia();
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

    it("drops the grip and starts at two rows on a narrow viewport", () => {
      installMatchMedia({ mobile: true });
      writePreference(preferences.answerComposerHeight, 140, PROJECT);
      renderPane();

      // No grip: an 8px rail on a phone sits under the thumb that is scrolling
      // the pane it borders.
      expect(grip()).toBeNull();
      // Two rows to start — `MOBILE_COMPOSER_MIN_ROWS`, the auto-grow floor —
      // laid out by the viewport rather than by the stored height.
      expect(field().rows).toBe(2);
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
        render(<PaneHarness sessionId="cell-a" speech={readySpeech()} />);

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
        render(<PaneHarness sessionId="cell-a" speech={readySpeech()} />);

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
        const speechA = readySpeech();
        const speechB = readySpeech();
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
        //
        // The chip row is a row of its own between the grip and the field's row,
        // outside the height the grip drags — see "keeps the chip row out of the
        // dragged height" below.
        expect(regionOrder()).toEqual([
          "answer-pane-body",
          "answer-pane-meta",
          "answer-pane-grip",
          "answer-pane-chip-row",
          "answer-pane-composer",
          "answer-pane-hint",
          "answer-pane-drag",
        ]);
      });

      it("keeps the chip row out of the dragged height", () => {
        renderPane();

        // The `/ skills` chip is always drawn, so a chip row inside the row the
        // grip sizes would always be paid for out of the field — 16.5px of it at
        // the default 62px, less than one line. It sits above that row instead,
        // in a row that takes its own height.
        const chip = screen.getByRole("button", { name: "/ skills" });
        expect(chip.closest(".answer-pane-composer")).toBeNull();
        expect(chip.closest(".answer-pane-chip-row")).not.toBeNull();
        const row = cssRule(".answer-pane-chip-row").replace(/\/\*[\s\S]*?\*\//g, "");
        expect(row).toMatch(/(^|;)\s*flex:\s*none\s*(;|$)/);
        expect(row).not.toMatch(/(^|;)\s*(min-|max-)?height\s*:/);
      });

      it("never lets the grip squeeze the field below one line", () => {
        // Stored far below the floor: the row clamps to BOUNDS.min.
        writePreference(preferences.answerComposerHeight, 1, PROJECT);
        renderPane();
        const row = field().closest(".answer-pane-composer") as HTMLElement;
        const rowHeight = Number.parseFloat(row.style.height);

        // One line of the field, read out of the stylesheet — its line box, its
        // vertical padding and its border — plus the row's own vertical padding,
        // which the stored height pays for too.
        const decl = (selector: string, property: string): string => {
          const found = cssRule(selector)
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
          if (!found) throw new Error(`no ${property} in ${selector}`);
          return found[1].trim();
        };
        const vertical = (shorthand: string): number => {
          const [top, , bottom = top] = shorthand.split(/\s+/).map(Number.parseFloat);
          return top + bottom;
        };
        const fieldLine =
          Number.parseFloat(decl(".answer-pane-composer-field", "font-size")) *
            Number.parseFloat(decl(".answer-pane-composer-field", "line-height")) +
          vertical(decl(".answer-pane-composer-field", "padding")) +
          2 * Number.parseFloat(decl(".answer-pane-composer-field", "border"));
        const floor = fieldLine + vertical(decl(".answer-pane-composer", "padding"));

        expect(rowHeight).toBeGreaterThanOrEqual(floor);
        // And the declared default opens above that floor too.
        expect(preferences.answerComposerHeight.default).toBeGreaterThanOrEqual(floor);
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

      it("the field's placeholder says the reply goes to the terminal", () => {
        renderPane();

        // The placeholder says what the field is for, not merely that it is a
        // field: a reply typed here reaches the PTY, not a chat.
        expect(field()).toHaveAttribute("placeholder", "Reply to the terminal…");
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
        installMatchMedia({ mobile: true });
        renderPane();

        // There is no Shift+Enter on a phone, so the hint has nothing to say;
        // the send button carries the whole action instead. The pane's own drag
        // row goes with them, for the reason the grip does: the pane is laid out
        // by the viewport there, and a 7px rail is a thumb's width from the
        // scroll it borders.
        expect(regionOrder()).toEqual([
          "answer-pane-body",
          "answer-pane-meta",
          "answer-pane-chip-row",
          "answer-pane-composer",
        ]);
        expect(grip()).toBeNull();
        expect(field().rows).toBe(2);
        // The button is the one control that does NOT go away with the keyboard
        // affordances — it is the only way to send on a phone.
        expect(sendButton()).toBeInTheDocument();
      });

      it("writes the key hint on the pane's own ground", () => {
        renderPane();

        expect(screen.getByTestId("answer-pane-hint-cell-a")).toHaveTextContent(
          "ENTER SENDS · SHIFT+ENTER NEWLINE · ESC CLOSES THE ANSWER",
        );

        // The hint and the grip paint the pane's own ground rather than the
        // field's well, which is what keeps the composer reading as one box
        // inside the surface instead of three stacked strips.
        const surface = cssRule(".answer-pane").match(/background:\s*([^;]+)/)?.[1].trim();
        // Vacuity guard: an undeclared ground would make the matches below vacuous.
        expect(surface).toBeTruthy();
        expect(cssRule(".answer-pane-hint")).toMatch(
          new RegExp(`background:\\s*${surface}\\s*(;|$)`, "m"),
        );
        expect(cssRule(".answer-pane-grip")).toMatch(
          new RegExp(`background:\\s*${surface}\\s*(;|$)`, "m"),
        );
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
});

/**
 * The mobile composer's auto-grow: the field follows `scrollHeight` up to six
 * rows, and desktop's grip-driven height is left entirely alone.
 *
 * jsdom does no real layout, so `scrollHeight` reports `0` for every element
 * forever and `getComputedStyle` never resolves the stylesheet's unitless
 * `line-height: 1.5` into a pixel value the way a real engine does — the two
 * numbers the effect under test actually reads. Both are stubbed here rather
 * than asserted against a real render: `scrollHeight` as a getter on
 * `HTMLTextAreaElement.prototype`, filtered to the composer's own field the
 * same way `AnswerPane.test.tsx` filters its `scrollHeight` stub to the
 * pane's body (`isBody`); `getComputedStyle` as a `vi.spyOn` that answers a
 * fixed `line-height` for that field and falls through to the real
 * implementation for everything else, so nothing else in the tree notices.
 */
describe("autogrow", () => {
  const SESSION = "cell-a";

  const isField = (element: Element): boolean =>
    element.classList.contains("answer-pane-composer-field");

  /**
   * What the field's `scrollHeight` reports — the browser's own measurement of
   * how tall the content wants the box to be, which is exactly the number this
   * component's effect reads and jsdom never computes for real. A single
   * module-level knob because exactly one field exists per test.
   */
  let scrollHeightPx = 40;

  let savedScrollHeight: PropertyDescriptor | undefined;

  function installScrollHeightStub(): void {
    savedScrollHeight = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "scrollHeight");
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLTextAreaElement) {
        return isField(this) ? scrollHeightPx : 0;
      },
    });
  }

  function restoreScrollHeightStub(): void {
    if (savedScrollHeight) {
      Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", savedScrollHeight);
    } else {
      delete (HTMLTextAreaElement.prototype as unknown as Record<string, unknown>).scrollHeight;
    }
  }

  /** The `line-height` the field's `getComputedStyle` answers with, in pixels —
   *  20px, the same fallback the component itself falls back to when a real
   *  stylesheet is not loaded, so a test that never touches this constant still
   *  exercises the same arithmetic the fallback path would. */
  const LINE_HEIGHT_PX = 20;

  /** Two rows' worth at the stubbed line height — the field's own floor. */
  const MOBILE_COMPOSER_MIN_ROWS_PX = 2 * LINE_HEIGHT_PX;

  const REAL_GET_COMPUTED_STYLE = window.getComputedStyle.bind(window);

  function installGetComputedStyle(): void {
    vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
      if (element instanceof Element && isField(element)) {
        return { lineHeight: `${LINE_HEIGHT_PX}px` } as unknown as CSSStyleDeclaration;
      }
      return REAL_GET_COMPUTED_STYLE(element, pseudo ?? undefined);
    });
  }

  const field = (): HTMLTextAreaElement =>
    screen.getByTestId(`answer-pane-composer-${SESSION}`) as HTMLTextAreaElement;

  beforeEach(() => {
    __resetPtySubmitForTests();
    __resetComposerDraftsForTests();
    onSubmitted.mockClear();
    scrollHeightPx = MOBILE_COMPOSER_MIN_ROWS_PX;
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    installScrollHeightStub();
    installGetComputedStyle();
  });

  afterEach(() => {
    __resetPtySubmitForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restoreScrollHeightStub();
  });

  describe("the mobile composer grows with the reply", () => {
    it("on mobile the field grows with scrollHeight", () => {
      installMatchMedia({ mobile: true });
      renderComposer();

      // A reply that wraps to four rows: the browser would report a taller
      // `scrollHeight`, which is exactly what is stubbed here.
      scrollHeightPx = 4 * LINE_HEIGHT_PX;
      fireEvent.change(field(), { target: { value: "one\ntwo\nthree\nfour" } });

      expect(field().style.height).toBe(`${4 * LINE_HEIGHT_PX}px`);
    });

    it("on mobile the field caps at six rows", () => {
      installMatchMedia({ mobile: true });
      renderComposer();

      // Far more than six rows' worth — the field must not follow it past the cap.
      scrollHeightPx = 20 * LINE_HEIGHT_PX;
      fireEvent.change(field(), { target: { value: "a very long reply".repeat(20) } });

      expect(field().style.height).toBe(`${6 * LINE_HEIGHT_PX}px`);
    });

    it("sending returns the field to its minimum", () => {
      installMatchMedia({ mobile: true });
      const send = vi.fn((_data: string) => true);
      renderComposer(send);

      scrollHeightPx = 8 * LINE_HEIGHT_PX;
      fireEvent.change(field(), { target: { value: "a reply grown tall" } });
      expect(field().style.height).toBe(`${6 * LINE_HEIGHT_PX}px`);

      // The moment the field empties, the browser's own `scrollHeight` for an
      // empty two-row field is two rows' worth — this is what "sending returns
      // the field to its minimum" falls out of, not a special case in the
      // component: the effect reruns on the cleared text and measures again.
      scrollHeightPx = MOBILE_COMPOSER_MIN_ROWS_PX;
      fireEvent.keyDown(field(), { key: "Enter" });

      expect(send.mock.calls[0]?.[0]).toBe("a reply grown tall");
      expect(field().value).toBe("");
      expect(field().style.height).toBe(`${MOBILE_COMPOSER_MIN_ROWS_PX}px`);
    });

    it("on desktop the field height is left to the grip", () => {
      installMatchMedia();
      renderComposer();

      // Whatever a real browser would report here, the desktop field's own
      // inline height must stay untouched — the row's height on this viewport
      // is the grip's, not `scrollHeight`'s.
      scrollHeightPx = 20 * LINE_HEIGHT_PX;
      fireEvent.change(field(), { target: { value: "a very long reply".repeat(20) } });

      expect(field().style.height).toBe("");
      expect(field().rows).toBe(2);
    });
  });
});

/**
 * The caret landing in the answer composer repairs that cell's socket.
 *
 * Putting the caret here is the user saying *I am about to send something*, so
 * it is the moment to reconnect — not the Enter that follows it. A reconnect
 * started while the reply is still being typed has the whole draft's worth of
 * time to finish, so the send finds a live socket and the refusal path the
 * composer keeps for it is never reached.
 *
 * ## Why the REAL `terminalInstances` is wired up here
 *
 * Three of the six cases are about what `reconnectOnActivate` REFUSES to do —
 * a healthy socket, an exited session, a second focus during the handshake —
 * and a stubbed `reconnectOnActivate` would answer all three by construction:
 * the test would assert that the mock the test itself wrote did nothing. So
 * this file mounts the pane over the real pool, with xterm and the websocket
 * faked exactly as `terminalInstances.test.ts` fakes them, and reads the
 * verdict off the sockets that were actually opened and the reconnect-log
 * lines that were actually posted.
 *
 * ## Why the auto-open case is a regression guard, not a formality
 *
 * The whole safety argument for this trigger is that the composer has NO
 * autofocus, so a focus event is always a real user action. If the field ever
 * took focus when the pane auto-opened on an arriving answer, the trigger
 * would fire on an ANSWER LANDING — which is precisely the "a dead socket is
 * never reopened unasked" rule the living terminal requires (ADR 0010). So
 * that case asserts the ABSENCE of focus on mount as well as the absence of a
 * reconnect: add `autoFocus` to the textarea and it fails on both counts.
 */
describe("focus repair", () => {
  interface FakeWs {
    url: string;
    readyState: number;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    onopen: ((ev: Event) => void) | null;
    onmessage: ((ev: MessageEvent) => void) | null;
    onerror: ((ev: Event) => void) | null;
    onclose: ((ev: CloseEvent) => void) | null;
  }

  const createdSockets: FakeWs[] = [];

  class FakeWebSocket implements FakeWs {
    url: string;
    readyState = 1; // OPEN
    send = vi.fn();
    close = vi.fn(() => {
      this.readyState = 3;
    });
    onopen: ((ev: Event) => void) | null = null;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;
    onclose: ((ev: CloseEvent) => void) | null = null;
    constructor(url: string) {
      this.url = url;
      createdSockets.push(this);
    }
  }

  /** One answer under the cursor — what the pane auto-opens ON. */
  function speechWith(sessionId: string, text: string): GridSpeech {
    const queue: UtteranceQueue = {
      previous: [],
      current: { id: text, sessionId, text, at: 1 },
      pending: [],
      cursor: 0,
    };
    return readySpeech({ queueFor: () => queue });
  }

  const PROJECT = "alpha";

  function session(id: string): SessionMeta {
    return {
      id,
      name: id,
      project: PROJECT,
      cwd: `/srv/git/${PROJECT}`,
      pid: 4242,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
  }

  const SESSIONS = ["cell-a", "cell-b"];

  let fetchMock: ReturnType<typeof vi.fn>;

  /** Bodies of the reconnect-log POSTs, in order — the trigger is what we read. */
  function loggedTriggers(): string[] {
    return fetchMock.mock.calls
      .filter(([url]) => url === "/api/terminal/reconnect-log")
      .map(([, init]) => JSON.parse((init as RequestInit).body as string).trigger as string);
  }

  /** A socket that died without the session exiting — the repairable state. */
  function killSocket(ws: FakeWs): void {
    ws.readyState = 3;
    ws.onclose?.(new Event("close") as CloseEvent);
  }

  /** The PTY said the process is gone — the state no focus may revive. */
  function reportExit(ws: FakeWs): void {
    ws.onmessage?.({ data: JSON.stringify({ type: "exit", code: 0 }) } as MessageEvent);
  }

  const field = (sessionId = "cell-a"): HTMLTextAreaElement =>
    screen.getByTestId(`answer-pane-composer-${sessionId}`) as HTMLTextAreaElement;

  beforeEach(async () => {
    createdSockets.length = 0;
    activity.state = "idle";
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    installMatchMedia();
    // One stub for both fetches this file makes: the tab's session load, and the
    // pool's fire-and-forget reconnect log. jsdom has no server behind either.
    fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(SESSIONS.map(session)),
      } as unknown as Response),
    );
    vi.stubGlobal("fetch", fetchMock);
    await refreshSessions();
    const mod = await import("../terminalInstances");
    mod.__setWebSocketCtorForTests(FakeWebSocket as unknown as new (url: string) => WebSocket);
  });

  afterEach(async () => {
    // Instances are keyed by sessionId at module scope, so a cell left in the
    // pool would hand the next test a socket it did not open.
    const mod = await import("../terminalInstances");
    for (const id of SESSIONS) mod.destroyTerminal(id);
    mod.__setWebSocketCtorForTests(null);
    vi.unstubAllGlobals();
  });

  describe("AnswerComposer focus repairs the socket", () => {
    it("focusing the composer reconnects a disconnected session", async () => {
      const mod = await import("../terminalInstances");
      // Two broken cells, so "reconnects" can be told apart from "reconnects
      // THIS one" — a repair aimed at the pool would pass with one.
      mod.acquireTerminal("cell-a");
      mod.acquireTerminal("cell-b");
      killSocket(createdSockets[0]);
      killSocket(createdSockets[1]);
      renderPane(readySpeech());

      field().focus();

      expect(createdSockets).toHaveLength(3);
      expect(createdSockets[2].url).toMatch(/\/ws\/terminal\/cell-a$/);
      expect(mod.getConnectionState("cell-a")).toBe("connected");
      expect(mod.getConnectionState("cell-b")).toBe("disconnected");
      expect(loggedTriggers().filter((t) => t === "auto-activate")).toEqual(["auto-activate"]);
    });

    it("focusing a healthy session reconnects nothing", async () => {
      const mod = await import("../terminalInstances");
      mod.acquireTerminal("cell-a");
      renderPane(readySpeech());

      field().focus();

      // A live socket has nothing to repair, and tearing it down to prove a
      // point would lose the buffer the user is reading.
      expect(createdSockets).toHaveLength(1);
      expect(loggedTriggers()).toEqual([]);
    });

    it("focusing an exited session reconnects nothing", async () => {
      const mod = await import("../terminalInstances");
      mod.acquireTerminal("cell-a");
      // The terminal already prints [Process exited]; reopening replays it.
      reportExit(createdSockets[0]);
      killSocket(createdSockets[0]);
      renderPane(readySpeech());

      field().focus();

      expect(createdSockets).toHaveLength(1);
      expect(loggedTriggers().filter((t) => t === "auto-activate")).toEqual([]);
    });

    it("refocusing does not start a second reconnect", async () => {
      const mod = await import("../terminalInstances");
      mod.acquireTerminal("cell-a");
      killSocket(createdSockets[0]);
      renderPane(readySpeech());

      // The caret leaves the field and comes back — routine while a reply is
      // written, and the handshake is still in flight both times.
      field().focus();
      field().blur();
      field().focus();

      expect(createdSockets).toHaveLength(2);
      expect(loggedTriggers().filter((t) => t === "auto-activate")).toEqual(["auto-activate"]);
    });

    it("the composer has no autofocus, so auto-open reconnects nothing", async () => {
      const mod = await import("../terminalInstances");
      mod.acquireTerminal("cell-a");
      killSocket(createdSockets[0]);

      // Every focus that lands anywhere in the tree while the pane opens.
      // `document.activeElement` alone would NOT catch an `autoFocus` here: the
      // pane's root takes the caret back on mount for its own Escape handling,
      // so the field can have been focused — and the reconnect fired — with the
      // root reading as the active element a tick later. The EVENT is the fact
      // this guard is about.
      const focused: (string | null)[] = [];
      const record = (e: Event) => {
        const target = e.target as HTMLElement | null;
        focused.push(target?.getAttribute?.("data-testid") ?? target?.tagName ?? null);
      };
      document.addEventListener("focusin", record);
      try {
        // The pane as it opens ON an arriving answer: an utterance under the
        // cursor.
        renderPane(speechWith("cell-a", "the answer that opened the pane"));
      } finally {
        document.removeEventListener("focusin", record);
      }

      // The field is mounted and empty-handed: nothing gave it the caret.
      expect(field()).toBeInTheDocument();
      expect(focused).not.toContain("answer-pane-composer-cell-a");
      expect(document.activeElement).not.toBe(field());
      // And so the repair never ran — a dead socket stays dead until asked.
      expect(createdSockets).toHaveLength(1);
      expect(mod.getConnectionState("cell-a")).toBe("disconnected");
      expect(loggedTriggers().filter((t) => t === "auto-activate")).toEqual([]);
    });

    it("focus still dismisses the attention LED", async () => {
      const mod = await import("../terminalInstances");
      const inst = mod.acquireTerminal("cell-a");
      activity.state = "attention";
      renderPane(readySpeech());
      const socket = createdSockets[0];
      socket.send.mockClear();

      field().focus();

      // The arrival rule the composer's focus has always run, unchanged by the
      // repair now sharing the handler.
      expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "dismiss-attention" }));
      expect(inst.sessionId).toBe("cell-a");
    });
  });
});
