/**
 * The launcher pills that fill the reserved speech row until the cell speaks.
 *
 * The row is present from mount (`SpeechControlBar.test.tsx` and
 * `TerminalView.speechRow.test.tsx` pin that), and before the first utterance
 * the transport controls nothing — so it is not rendered at all and the row
 * carries the arm switch and one pill per configured launcher instead. The
 * subject here is therefore the BRANCH, not a component in isolation: the bar
 * is rendered with a real preference behind it and a real `send`, because a
 * pill whose command never reaches the PTY is the only failure that matters.
 *
 * Arming is asserted here too. It is the one control that survives both halves
 * of the branch, and `autoplay.integration.test.tsx` proves it against the real
 * host; what this file pins is that the pills branch did not drop it.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { cssRule } from "../../shell/__tests__/hamburgerGeometry";
import { SpeechControlBar } from "../SpeechControlBar";
import { __resetPtySubmitForTests } from "../ptySubmit";
import { refreshSessions } from "../sessionStore";
import type { SessionMeta } from "../useTerminalSessions";
import { preferences } from "../../../preferences/declarations";
import { writePreference } from "../../../preferences/store";
import type { CellSpeechState, GridSpeech, SpeechUnit, Utterance } from "../../speech/types";
import { emptyUtteranceQueue, type UtteranceQueue } from "../../speech/utteranceQueue";

/** Shared, because a `useSyncExternalStore` snapshot must be referentially
 *  stable between notifications — a fresh `new Map()` per call is an infinite
 *  render loop. */
const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();
const NO_UNITS: readonly SpeechUnit[] = Object.freeze([]);

/**
 * The writes ONE pill press makes: the command, and then the return that runs
 * it as a separate write.
 *
 * A pill used to send `` `${command}\r` `` in one go. That is the shape the
 * answer composer's stuck sends came from — a single burst whose trailing `\r`
 * a TUI with bracketed paste reads as part of the pasted body — and the split
 * lives in `ptySubmit`, so every caller gets it and a short command has to keep
 * working under it. `waitFor` because the return is scheduled, not inline.
 */
const expectRan = async (send: Mock, ...commands: string[]): Promise<void> => {
  const expected = commands.flatMap((command) => [[command], ["\r"]]);
  await waitFor(() => expect(send.mock.calls).toEqual(expected));
};

/** Drops any return still queued, so the next press starts from nothing. */
const resetSends = (send: Mock): void => {
  __resetPtySubmitForTests();
  send.mockClear();
};

interface SpeechOverrides {
  state?: CellSpeechState;
  queue?: UtteranceQueue;
  units?: SpeechUnit[];
  armedSessionId?: string | null;
}

/** A cell that has played nothing has heard nothing — shared, like every other
 *  "nothing here" snapshot on a host. */
const NOTHING_HEARD: ReadonlySet<string> = new Set<string>();

function makeSpeech(over: SpeechOverrides = {}): GridSpeech {
  const units = over.units ?? NO_UNITS;

  return {
    stateFor: () => over.state ?? "empty",
    queueFor: () => over.queue ?? emptyUtteranceQueue,
    heardFor: () => NOTHING_HEARD,
    unitsFor: () => units,
    subscribeProgress: () => () => {},
    progressFor: () => null,
    unitDurationsFor: () => NO_DURATIONS,
    armedSessionId: over.armedSessionId ?? null,
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
  };
}

/** A cell that has spoken: an utterance under the cursor and units to draw. */
function spokenSpeech(): GridSpeech {
  const current: Utterance = { id: "u-1", sessionId: "cell-a", text: "Something", at: 1 };
  return makeSpeech({
    state: "ready",
    queue: { ...emptyUtteranceQueue, current },
    units: [{ text: "Something", chars: 9, source: "Something" }],
  });
}

/** Every pill on a cell's row, in order. */
function pills(sessionId = "cell-a"): HTMLButtonElement[] {
  return screen.queryAllByTestId(
    new RegExp(`^speech-bar-launch-${sessionId}-`),
  ) as HTMLButtonElement[];
}

/** Every pill on the row, in order, read by its label. */
function pillLabels(): string[] {
  return pills().map((pill) => pill.textContent ?? "");
}

/**
 * Puts a session list in the tab's store, the way a load does.
 *
 * `refreshSessions` is the store's own fetch-and-publish, so this is the real
 * path a project reaches the row by — not a hand-set module field. It does not
 * start the poll, and `test-setup.ts` clears the store between tests.
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

function session(id: string, project: string): SessionMeta {
  return {
    id,
    name: id,
    project,
    cwd: `/srv/git/${project || "unknown"}`,
    pid: 4242,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/** The pill a used row carries in place of the launchers. */
function startPill(sessionId = "cell-a"): HTMLButtonElement | null {
  return screen.queryByTestId(`speech-bar-start-${sessionId}`) as HTMLButtonElement | null;
}

// `seedSessions` stubs `fetch`; vitest is not configured to unstub globals, and
// a stub left behind would answer the next file's session load.
beforeEach(() => {
  // The submit queue is module state keyed by session: a return still queued
  // from the previous test would fire into this one's `send`.
  __resetPtySubmitForTests();
});

afterEach(() => {
  __resetPtySubmitForTests();
  vi.unstubAllGlobals();
});

function bar(speech: GridSpeech, send: (data: string) => boolean, sessionId = "cell-a") {
  return (
    <SpeechControlBar
      sessionId={sessionId}
      speech={speech}
      answerOpen={false}
      onToggleAnswer={() => {}}
      send={send}
    />
  );
}

function renderBar(speech: GridSpeech, send: (data: string) => boolean) {
  return render(bar(speech, send));
}

describe("LauncherPills", () => {
  it("renders a pill per configured launcher while the cell has nothing to play", () => {
    renderBar(makeSpeech({ state: "empty" }), vi.fn());

    // Nothing stored, so the row shows the declared defaults, in order.
    expect(pillLabels()).toEqual(["claude", "codex", "opencode"]);
    // …and nothing has been launched here, so the row does not yet offer to
    // start a session in it.
    expect(startPill()).toBeNull();
    // …and the transport, which controls nothing yet, is not there at all.
    expect(screen.queryByTestId("speech-bar-playpause-cell-a")).toBeNull();
    expect(screen.queryByTestId("speech-bar-previous-cell-a")).toBeNull();
    expect(screen.queryByTestId("speech-bar-next-cell-a")).toBeNull();
    expect(screen.queryByTestId("speech-bar-scrubber-cell-a")).toBeNull();
  });

  it("sends the command with a trailing return, once, on click", async () => {
    const user = userEvent.setup();
    const send = vi.fn((_data: string) => true);
    renderBar(makeSpeech({ state: "empty" }), send);

    await user.click(screen.getByRole("button", { name: "claude" }));

    // Exactly the command and exactly one return, from exactly one press: a
    // pill that fired twice would run the agent twice.
    await expectRan(send, "claude");
  });

  it("labels the pill with the name and sends the command", async () => {
    const user = userEvent.setup();
    const send = vi.fn((_data: string) => true);
    writePreference(preferences.terminalLaunchers, [
      { name: "resume", command: "claude --resume" },
    ]);

    renderBar(makeSpeech({ state: "empty" }), send);

    // The name is the label — the command never appears on screen.
    expect(pillLabels()).toEqual(["resume"]);
    expect(screen.queryByRole("button", { name: "claude --resume" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "resume" }));

    // …and the command is what the PTY receives, verbatim.
    await expectRan(send, "claude --resume");
  });

  it("swaps the pills for the transport once the cell has spoken", () => {
    const send = vi.fn((_data: string) => true);
    const view = renderBar(makeSpeech({ state: "empty" }), send);
    expect(pillLabels()).toEqual(["claude", "codex", "opencode"]);

    view.rerender(
      <SpeechControlBar
        sessionId="cell-a"
        speech={spokenSpeech()}
        answerOpen={false}
        onToggleAnswer={() => {}}
        send={send}
      />,
    );

    // The launchers are gone and do not come back; the transport is live.
    expect(pillLabels()).toEqual([]);
    expect(screen.getByTestId("speech-bar-playpause-cell-a")).toHaveAttribute(
      "data-speech",
      "ready",
    );
    expect(screen.getByTestId("speech-bar-scrubber-cell-a")).toBeInTheDocument();
  });

  it("arms a cell that has never spoken", async () => {
    const user = userEvent.setup();
    const speech = makeSpeech({ state: "empty" });
    renderBar(speech, vi.fn());

    // The switch is the reason the row is reachable before the first answer.
    await user.click(screen.getByTestId("speech-bar-autoplay-cell-a"));

    expect(speech.onArm).toHaveBeenCalledTimes(1);
    expect(speech.onArm).toHaveBeenCalledWith("cell-a");
  });

  /**
   * Once a launcher has been used in a cell, the row stops offering launchers
   * and offers the step that comes next instead.
   *
   * The cell's speech state is NOT the signal: `SpeechControlBar` swaps the
   * pills for the transport only when the cell has SPOKEN, and an agent runs
   * for minutes before its first utterance. Greg clicked `claude`, watched it
   * load in the cell, and the three pills were still sitting there offering to
   * launch — a click then does not start a second agent, it types `claude`
   * into the prompt of the one already running.
   *
   * The first answer to that greyed the pills out, and three dead buttons are
   * not worth the width. What Greg types by hand in that window is
   * `pavilio-session-start <project>`, the moment the agent finishes booting —
   * so that is the one pill the row carries there now.
   */
  describe("once a launcher has been used", () => {
    it("leaves a cell that has not launched showing its launchers", () => {
      renderBar(makeSpeech({ state: "empty" }), vi.fn());

      // Three pills, all of them pressable, and no start pill. This is also
      // what proves the flag is cleared between tests — a case above clicked a
      // pill in `cell-a`, and a flag that leaked would put `start` here.
      expect(pills()).toHaveLength(3);
      for (const pill of pills()) expect(pill).toBeEnabled();
      expect(startPill()).toBeNull();
    });

    it("replaces the launchers with a single start pill the moment one is clicked", async () => {
      const user = userEvent.setup();
      const send = vi.fn((_data: string) => true);
      renderBar(makeSpeech({ state: "empty" }), send);

      await user.click(screen.getByRole("button", { name: "claude" }));

      // The launch itself is unchanged — the command, and its return after it.
      await expectRan(send, "claude");

      // And the row's whole offer changes: not `codex` greyed out beside a
      // spent `claude`, but one live pill for the step that actually follows.
      expect(pills()).toEqual([]);
      const start = startPill();
      expect(start).toBeInTheDocument();
      expect(start).toHaveTextContent("start");
      expect(start).toBeEnabled();

      // Still inside the fixed-height strip the launchers filled: the row is a
      // 56px box spent at mount, and swapping three pills for one must not be
      // a resize under a running TUI.
      expect(screen.getByTestId("speech-bar-launchers-cell-a")).toContainElement(start);
    });

    it("sends the session-start command for the cell's own project", async () => {
      const user = userEvent.setup();
      const send = vi.fn((_data: string) => true);
      await seedSessions([session("cell-b", "pavilio"), session("cell-a", "my-blog")]);
      renderBar(makeSpeech({ state: "empty" }), send);

      await user.click(screen.getByRole("button", { name: "claude" }));
      resetSends(send);

      await user.click(screen.getByRole("button", { name: "start" }));

      // Verbatim, with no leading slash: this is prompt text typed into a
      // running agent, not a client-side slash command. The project is this
      // cell's, resolved by session id — `cell-b`'s would load the wrong one.
      await expectRan(send, "pavilio-session-start my-blog");
    });

    it("sends the bare command when the cell's project is unknown", async () => {
      const user = userEvent.setup();
      const send = vi.fn((_data: string) => true);
      // Nothing seeded: the store has not loaded, which is the real case on a
      // fresh tab, and the session is simply not in the list.
      renderBar(makeSpeech({ state: "empty" }), send);

      await user.click(screen.getByRole("button", { name: "claude" }));
      resetSends(send);

      await user.click(screen.getByRole("button", { name: "start" }));

      // The bare command, which is a valid invocation. Not a trailing space,
      // and not the word `undefined` — both of which would be typed into the
      // prompt exactly as written.
      await expectRan(send, "pavilio-session-start");
    });

    it("sends the bare command when the session carries an empty project", async () => {
      const user = userEvent.setup();
      const send = vi.fn((_data: string) => true);
      // A session with no project of its own — a quick terminal, say. The list
      // HAS loaded and the cell IS in it, so a lookup that only guarded
      // `undefined` would send a trailing separator with nothing after it.
      await seedSessions([session("cell-a", "")]);
      renderBar(makeSpeech({ state: "empty" }), send);

      await user.click(screen.getByRole("button", { name: "claude" }));
      resetSends(send);

      await user.click(screen.getByRole("button", { name: "start" }));

      await expectRan(send, "pavilio-session-start");
    });

    it("keeps the start pill live for a second press", async () => {
      const user = userEvent.setup();
      const send = vi.fn((_data: string) => true);
      await seedSessions([session("cell-a", "pavilio")]);
      renderBar(makeSpeech({ state: "empty" }), send);

      await user.click(screen.getByRole("button", { name: "claude" }));
      resetSends(send);

      await user.click(screen.getByRole("button", { name: "start" }));
      await user.click(screen.getByRole("button", { name: "start" }));

      // Not one-shot, unlike the launchers: re-loading a project's context into
      // the agent is a legitimate thing to ask for twice, and its effect is
      // visible in the prompt either way.
      // Two presses, two submits — and the second command is not written
      // until the first has been submitted.
      await expectRan(send, "pavilio-session-start pavilio", "pavilio-session-start pavilio");
      expect(startPill()).toBeEnabled();
    });

    it("leaves a second cell's launchers alone", async () => {
      const user = userEvent.setup();
      const sendA = vi.fn((_data: string) => true);
      const sendB = vi.fn((_data: string) => true);
      render(
        <>
          {bar(makeSpeech({ state: "empty" }), sendA, "cell-a")}
          {bar(makeSpeech({ state: "empty" }), sendB, "cell-b")}
        </>,
      );

      await user.click(screen.getAllByRole("button", { name: "claude" })[0]);

      // The fact is the SESSION's. Keyed globally — one flag for the panel —
      // launching in one cell would turn every other cell's row into a start
      // pill, and the second terminal a user opens would arrive with no way to
      // launch anything in it.
      expect(pills("cell-a")).toEqual([]);
      expect(startPill("cell-a")).toBeInTheDocument();
      expect(startPill("cell-b")).toBeNull();
      expect(pills("cell-b")).toHaveLength(3);
      for (const pill of pills("cell-b")) expect(pill).toBeEnabled();

      await user.click(screen.getAllByRole("button", { name: "codex" })[0]);
      await expectRan(sendB, "codex");
      await expectRan(sendA, "claude");
    });

    it("lifts every pill under the pointer, with no disabled state to withhold it from", () => {
      // jsdom loads no stylesheet, so `getComputedStyle` would answer for a
      // rule it never saw. `cssRule` reads the declaration block out of
      // `index.css`, throws when the selector matches nothing, and refuses to
      // guess when it matches more than one — which is what keeps a rename
      // from turning this into an assertion about nothing.
      expect(cssRule(".speech-bar-launch:hover")).toMatch(/background/);

      // Nothing renders a disabled pill any more, so the guard the hover rule
      // used to carry and the greyed rule it guarded against are both gone —
      // a dead selector left behind would be a promise the markup cannot keep.
      expect(() => cssRule(".speech-bar-launch:hover:not([disabled])")).toThrow(/no rule/);
      expect(() => cssRule(".speech-bar-launch[disabled]")).toThrow(/no rule/);
    });
  });
});
