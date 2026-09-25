/**
 * A send that cannot be delivered must not eat the text.
 *
 * The cell's `send` used to take the `if` on a socket that was not OPEN and
 * return normally — no value, no throw — so `ptySubmit` believed the body had
 * gone, scheduled its `\r`, and the composer cleared. The reply was gone with
 * no error and not so much as a `console.warn`. Greg hit it in use: "if the
 * socket is broken and you post a message on the answer form, it is lost."
 *
 * So the subject here is a chain rather than a unit: the write reports whether
 * it landed, `submitToPty` propagates that to whoever asked for the submit, and
 * the composer keeps the text and says so. Asserted through `AnswerPane`, as
 * every other composer criterion is, because the notice is part of the pane the
 * user is looking at rather than of a field rendered on its own.
 *
 * The half-sent case is in here too, and it is not hypothetical: the body and
 * the return are two frames on two different turns, so a socket that dies
 * between them leaves the reply sitting in the TUI's prompt, unsubmitted. Text
 * that reached the prompt must NOT come back into the composer — it would then
 * exist twice — but the user still has to be told the line never ran.
 *
 * ## Why a refusal is still the FIRST answer in this file
 *
 * A refused body is no longer reported on the spot everywhere: `ptySubmit` now
 * rebuilds the cell's socket and offers the frame to it once before reporting
 * anything. That repair is deliberately not attempted for a session this
 * browser holds no terminal for — there is no socket to rebuild, so waiting for
 * one would only stall the cell's queue before saying what is already known.
 *
 * Every session in this file is exactly that: the panes and bars here are
 * rendered against a session id with no pooled instance behind it, so the
 * reconnect path is not reached and these criteria read as they always have.
 * They are also the right shape for what this file is about — what the USER is
 * left with when a send does not go — and no assertion here is weakened by the
 * retry existing. The retry itself is a timing shape rather than a rendering
 * and is pinned in `ptySubmit.reconnect.test.ts`, where the connection can be
 * driven by hand.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ToastHost from "../../../components/ToastHost";
import { MOBILE_QUERY } from "../../../lib/breakpoints";
import { getToastSnapshot, dismissToast } from "../../../lib/toast";
import { preferences } from "../../../preferences/declarations";
import { writePreference } from "../../../preferences/store";
import type { CellSpeechState, GridSpeech, SpeechUnit } from "../../speech/types";
import { emptyUtteranceQueue } from "../../speech/utteranceQueue";
import { AnswerPane } from "../AnswerPane";
import { SpeechControlBar } from "../SpeechControlBar";
import { __resetAnswerWaitingForTests } from "../answerWaiting";
import { getDraft, __resetComposerDraftsForTests } from "../composerDrafts";
import { SUBMIT_RETURN_MS, __resetPtySubmitForTests, submitToPty } from "../ptySubmit";
import { refreshSessions } from "../sessionStore";
import type { SessionMeta } from "../useTerminalSessions";

// The pane's rail peeks into the synthesis cache; nothing here is warm and
// nothing subscribes, exactly as in the other composer suites.
vi.mock("../../speech/synth", () => ({
  isSpeechSynthesized: () => false,
  speechCacheState: () => "cold",
  subscribeSpeechCache: () => () => {},
}));

// No answer is put under the cursor in this file, so the markdown renderer is
// never mounted — but the mock keeps mermaid's browser-only stack from being a
// reason the suite cannot run.
vi.mock("../../markdown/MermaidDiagram", () => ({
  default: ({ chart }: { chart: string }) => <div data-testid="mermaid">{chart}</div>,
}));

/** Referentially stable — a fresh array per call is a `useSyncExternalStore` loop. */
const NO_UNITS: readonly SpeechUnit[] = Object.freeze([]);
const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();
const NOTHING_HEARD: ReadonlySet<string> = new Set<string>();

const SESSION = "cell-a";
const PROJECT = "alpha";

function makeSpeech(state: CellSpeechState = "ready"): GridSpeech {
  return {
    stateFor: () => state,
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

/** Puts a session list in the tab's store, the way a load does. */
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

/** A write to a socket that is not OPEN: nothing left the panel. */
const deadSend = () => vi.fn((_data: string) => false);
/** A write to a live socket. */
const liveSend = () => vi.fn((_data: string) => true);

function renderPane(send: (data: string) => boolean) {
  return render(
    <MemoryRouter>
      <AnswerPane
        sessionId={SESSION}
        speech={makeSpeech()}
        onClose={() => {}}
        send={send}
        autoOpen={false}
        onAutoOpenChange={() => {}}
      />
    </MemoryRouter>,
  );
}

const field = (): HTMLTextAreaElement =>
  screen.getByTestId(`answer-pane-composer-${SESSION}`) as HTMLTextAreaElement;

const failure = (): HTMLElement | null =>
  screen.queryByTestId(`answer-pane-send-failed-${SESSION}`);

/** Types a reply and presses the key that sends it. */
function submit(text: string): void {
  fireEvent.change(field(), { target: { value: text } });
  fireEvent.keyDown(field(), { key: "Enter" });
}

beforeEach(async () => {
  __resetAnswerWaitingForTests();
  __resetPtySubmitForTests();
  __resetComposerDraftsForTests();
  dismissToast();
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  installMatchMedia(false);
  await seedSessions([session(SESSION, PROJECT)]);
});

afterEach(() => {
  __resetPtySubmitForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("a submit on a dead socket", () => {
  it("keeps the draft in the composer when the socket is dead", () => {
    const send = deadSend();
    renderPane(send);

    submit("the whole of my reply");

    // The field still holds it, and so does the store the field is rebuilt
    // from after the pane is closed — a clear in either place is the bug.
    expect(field().value).toBe("the whole of my reply");
    expect(getDraft(SESSION)).toBe("the whole of my reply");
  });

  it("tells the user the send failed", () => {
    const send = deadSend();
    renderPane(send);

    submit("did this go?");

    const notice = failure();
    expect(notice).not.toBeNull();
    // Announced, not merely drawn: the pane is not where a screen reader is
    // looking when a send is refused, so the notice has to say so itself.
    expect(notice).toHaveAttribute("role", "alert");
    expect(notice?.textContent ?? "").toMatch(/not sent/i);
  });

  it("clears the composer and sends nothing extra when the socket is live", async () => {
    const send = liveSend();
    renderPane(send);

    submit("ship it");

    // Exactly today's behaviour: the field empties, the draft is consumed, and
    // the failure path is not reachable from here.
    expect(field().value).toBe("");
    expect(getDraft(SESSION)).toBe("");
    expect(failure()).toBeNull();
    await waitFor(() => expect(send.mock.calls).toEqual([["ship it"], ["\r"]]));
  });

  it("reports failure without queueing a retry", () => {
    vi.useFakeTimers();
    const send = deadSend();
    renderPane(send);

    // Everything the mounted pane already has on a clock, so the assertion
    // below is about what the SUBMIT scheduled and not about React's own
    // housekeeping.
    const before = vi.getTimerCount();

    act(() => submit("no second attempt"));

    // The body was refused, so there is nothing for a return to submit and
    // nothing to try again LATER. Queue-and-flush was weighed and rejected: an
    // answer that lands two minutes late replies to a prompt the agent has
    // moved past, and a silent retry is worse than an honest refusal. The
    // reconnect-and-retry added since is not that and does not appear here:
    // it happens inside this gesture, and only where there is a pooled socket
    // to rebuild, which this session has not got.
    expect(send.mock.calls).toEqual([["no second attempt"]]);

    // Not one timer more than the pane had before it was pressed: the
    // assertion a retry could not slip past, whatever it was scheduled on.
    expect(vi.getTimerCount()).toBe(before);

    act(() => vi.advanceTimersByTime(SUBMIT_RETURN_MS * 20));

    expect(send.mock.calls).toEqual([["no second attempt"]]);
  });

  it("does not restore text that already reached the prompt", () => {
    vi.useFakeTimers();
    // The body lands; the socket dies before the return that submits it.
    const send = vi.fn((data: string) => data !== "\r");
    renderPane(send);

    act(() => submit("a line that reached the prompt"));
    expect(field().value).toBe("");

    act(() => vi.advanceTimersByTime(SUBMIT_RETURN_MS));

    // The text is in the TUI's prompt. Putting it back in the composer would
    // give the user two copies of one reply and invite a second send of what
    // is already typed there.
    expect(field().value).toBe("");
    expect(getDraft(SESSION)).toBe("");
    // But it never ran, and only the panel knows that.
    const notice = failure();
    expect(notice).not.toBeNull();
    expect(notice?.textContent ?? "").toMatch(/not submitted/i);
    // And the pane stays handed over. The body reached the TUI's prompt, so
    // the reply really is on the far side and one keypress in the terminal
    // runs it — a refused RETURN must therefore not take the wait back, which
    // is the half of this case that lives only in prose on `AnswerComposer`
    // and `ptySubmit` until it is pinned here.
    expect(screen.getByTestId(`answer-pane-waiting-${SESSION}`)).toBeInTheDocument();
  });

  it("does not hand the pane over to the waiting state when nothing was sent", () => {
    const send = deadSend();
    renderPane(send);

    submit("nothing left the panel");

    // The waiting state means "the agent is working on what I just said". It
    // said nothing, so there is nothing to wait for.
    expect(screen.queryByTestId(`answer-pane-waiting-${SESSION}`)).toBeNull();
  });

  it("hands the pane over to the waiting state when the body does reach the socket", () => {
    const send = liveSend();
    renderPane(send);

    submit("on its way");

    // The control every "does not wait" case in this file rests on: this pane
    // CAN show the state, so an absent wave means the submit was refused and
    // not merely that the harness never draws one.
    expect(screen.getByTestId(`answer-pane-waiting-${SESSION}`)).toBeInTheDocument();
  });

  it("does not wait for a queued reply whose body is refused when its turn comes", () => {
    vi.useFakeTimers();
    // Something else on this cell is already mid-submit — a launcher pill
    // pressed a moment earlier writes through the same per-session queue — so
    // this reply is ENQUEUED rather than written, and whether it will reach
    // the socket is not known by the time `submit` returns.
    const earlier = vi.fn((_data: string) => true);
    submitToPty(SESSION, earlier, "pavilio-session-start alpha");
    const send = deadSend();
    renderPane(send);

    act(() => submit("queued behind the pill"));

    // Nothing has been written for this reply yet, so nothing about it can be
    // known — least of all that the agent is working on it.
    expect(send).not.toHaveBeenCalled();
    expect(screen.queryByTestId(`answer-pane-waiting-${SESSION}`)).toBeNull();

    act(() => vi.advanceTimersByTime(SUBMIT_RETURN_MS));

    // Its turn came and the socket refused the body, so the pane is left
    // exactly as any other refusal leaves it: the text is back in the field,
    // the notice is up, and nothing is being waited for.
    expect(send.mock.calls).toEqual([["queued behind the pill"]]);
    expect(field().value).toBe("queued behind the pill");
    expect(failure()).not.toBeNull();
    expect(screen.queryByTestId(`answer-pane-waiting-${SESSION}`)).toBeNull();
  });

  it("waits for a queued reply from the moment its body is written", () => {
    vi.useFakeTimers();
    const earlier = vi.fn((_data: string) => true);
    submitToPty(SESSION, earlier, "pavilio-session-start alpha");
    const send = liveSend();
    renderPane(send);

    act(() => submit("queued behind the pill"));

    // Still only enqueued: the agent has not been told anything yet.
    expect(screen.queryByTestId(`answer-pane-waiting-${SESSION}`)).toBeNull();

    act(() => vi.advanceTimersByTime(SUBMIT_RETURN_MS));

    // The wait is about a write, so it begins where the write does.
    expect(send.mock.calls).toEqual([["queued behind the pill"]]);
    expect(screen.getByTestId(`answer-pane-waiting-${SESSION}`)).toBeInTheDocument();
  });

  it("takes the notice down on the next keystroke", () => {
    const send = deadSend();
    renderPane(send);

    submit("did this go?");
    expect(failure()).not.toBeNull();

    fireEvent.change(field(), { target: { value: "did this go? " } });

    // Typing is the user having read the refusal and moved on. A notice that
    // outlived the reply it was about would go on claiming the next one failed
    // too, in a live region, while the user was typing it.
    expect(failure()).toBeNull();
  });

  it("takes the notice down on the next submit", async () => {
    let open = false;
    const send = vi.fn((_data: string) => open);
    renderPane(send);

    submit("first try");
    expect(failure()).not.toBeNull();

    // The socket comes back and the user presses Enter on the very text the
    // refusal put back — no keystroke in between, so the submit itself is the
    // only thing that can have taken the notice down.
    open = true;
    fireEvent.keyDown(field(), { key: "Enter" });

    expect(failure()).toBeNull();
    await waitFor(() =>
      expect(send.mock.calls).toEqual([["first try"], ["first try"], ["\r"]]),
    );
  });

  it("does not strand the submits queued behind a failed body", () => {
    vi.useFakeTimers();
    // First body lands, its return lands, and the socket dies before the
    // second body — the one submit that can be sitting in the queue when a
    // body is refused.
    const send = vi.fn((_data: string) => true);
    renderPane(send);

    act(() => submit("first"));
    send.mockImplementation(() => false);
    act(() => submit("second"));
    const before = vi.getTimerCount();

    act(() => vi.advanceTimersByTime(SUBMIT_RETURN_MS));

    // The queued body was attempted rather than left in the map forever, its
    // refusal was reported, and the queue is empty afterwards: a third submit
    // is written straight away rather than waiting behind a submit that will
    // never finish.
    expect(send.mock.calls).toEqual([["first"], ["\r"], ["second"]]);
    expect(failure()).not.toBeNull();
    // The refused body left nothing behind on a clock: the queue advanced
    // instead of waiting out a gap that only separates a paste from a keypress.
    expect(vi.getTimerCount()).toBeLessThan(before);

    // And the session's turn came back. A refused body that did NOT advance
    // would leave the queue's entry in place forever, and this third submit —
    // the user trying again on a socket that has since come back — would be
    // pushed behind a submit that can never finish and never be written at all.
    send.mockImplementation(() => true);
    act(() => submit("third"));

    expect(send.mock.calls).toEqual([["first"], ["\r"], ["second"], ["third"]]);
  });
});

describe("a launcher pill on a dead socket", () => {
  /**
   * The bar alone, which is where the pills live before a cell has spoken —
   * with `ToastHost` beside it, because what the pills promise is that the
   * refusal is ANNOUNCED. Asserting the store alone would have rested that
   * claim on the host's own suite rather than on this path, which is the same
   * reason `AnswerComposer.paste.test.tsx` mounts it for its failed upload.
   */
  function renderBar(send: (data: string) => boolean) {
    return render(
      <MemoryRouter>
        <SpeechControlBar
          sessionId={SESSION}
          // The pills are the row's contents only before a cell has spoken;
          // once there is an utterance the transport takes the row.
          speech={makeSpeech("empty")}
          answerOpen={false}
          onToggleAnswer={() => {}}
          send={send}
        />
        <ToastHost />
      </MemoryRouter>,
    );
  }

  /** Every launcher pill on the row, in order. */
  const launcherPills = (): HTMLElement[] =>
    screen.queryAllByTestId(new RegExp(`^speech-bar-launch-${SESSION}-`));

  it("says a launcher command was not sent", async () => {
    writePreference(preferences.terminalLaunchers, [{ name: "claude", command: "claude" }]);
    const send = deadSend();
    renderBar(send);

    fireEvent.click(await screen.findByTestId(`speech-bar-launch-${SESSION}-0`));

    // The pills have no pane of their own to write into, so they say it where
    // the panel says everything else — the toast host, which is a live region.
    const announced = await screen.findByTestId("toast");
    expect(announced).toHaveTextContent(/not sent/i);
    // In a live region rather than merely on screen: nothing draws a pill's
    // attention to itself, so a screen reader has to be told.
    expect(announced).toHaveAttribute("role", "status");
    expect(announced).toHaveAttribute("aria-live", "polite");
    // The store still carries the severity the host paints from — the only
    // part of "this is an error" that never reaches the text.
    expect(getToastSnapshot()?.kind).toBe("error");
  });

  it("leaves every launcher on the row when the command was not sent", async () => {
    writePreference(preferences.terminalLaunchers, [
      { name: "claude", command: "claude" },
      { name: "codex", command: "codex" },
    ]);
    const send = deadSend();
    renderBar(send);

    fireEvent.click(await screen.findByTestId(`speech-bar-launch-${SESSION}-0`));

    // Nothing was launched, so the row must not claim one was. Swapping the
    // pills for `start` here is the owner's own bug in another place: the UI
    // moving on from a write that never happened — and it costs the user the
    // only way back to `codex` on this cell.
    expect(launcherPills()).toHaveLength(2);
    expect(screen.queryByTestId(`speech-bar-start-${SESSION}`)).toBeNull();
  });

  it("swaps the row for the start pill when the command does go", async () => {
    writePreference(preferences.terminalLaunchers, [
      { name: "claude", command: "claude" },
      { name: "codex", command: "codex" },
    ]);
    const send = liveSend();
    renderBar(send);

    fireEvent.click(await screen.findByTestId(`speech-bar-launch-${SESSION}-0`));

    // Exactly today's behaviour on a live socket: an agent was asked for, so
    // the row offers the step that follows a launch instead of the launchers.
    expect(launcherPills()).toEqual([]);
    expect(screen.getByTestId(`speech-bar-start-${SESSION}`)).toBeInTheDocument();
    expect(send.mock.calls).toEqual([["claude"]]);
  });
});
