/**
 * The one place a line of text is submitted to a PTY.
 *
 * The criterion this file exists for is a shape, not a value: the body and the
 * return that runs it must reach the socket as TWO writes. A TUI reading its
 * stdin — Claude Code is Ink/React on a bracketed-paste-enabled stdin — treats
 * one large write as one paste, and a `\r` at the end of that paste is part of
 * the pasted BODY: it lands in the multi-line editor as a newline instead of
 * submitting. Short commands survive it, which is why the bug reads as
 * intermittent and tracks the size of what was sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SUBMIT_RETURN_MS, __resetPtySubmitForTests, submitToPty } from "../ptySubmit";

beforeEach(() => {
  __resetPtySubmitForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  __resetPtySubmitForTests();
  vi.useRealTimers();
});

describe("submitToPty", () => {
  it("writes the body now and the return on a later turn", () => {
    const send = vi.fn((_data: string) => true);

    submitToPty("cell-a", send, "ship it");

    // The body alone: nothing that could be read as the end of a paste has
    // been written yet.
    expect(send.mock.calls).toEqual([["ship it"]]);

    vi.advanceTimersByTime(SUBMIT_RETURN_MS);

    expect(send.mock.calls).toEqual([["ship it"], ["\r"]]);
  });

  it("never concatenates the return onto the body", () => {
    const send = vi.fn((_data: string) => true);

    submitToPty("cell-a", send, "ship it");
    vi.advanceTimersByTime(SUBMIT_RETURN_MS);

    for (const [data] of send.mock.calls) {
      if (data === "\r") continue;
      expect(data).not.toMatch(/\r/);
    }
  });

  it("keeps every line of a multi-line body in the one body write", () => {
    const send = vi.fn((_data: string) => true);
    const body = "first paragraph\nsecond paragraph\nthird";

    submitToPty("cell-a", send, body);
    vi.advanceTimersByTime(SUBMIT_RETURN_MS);

    // The body is not split into lines — only the submitting return is split
    // off it. A per-line write would submit each line to the TUI separately.
    expect(send.mock.calls).toEqual([[body], ["\r"]]);
  });

  it("does not interleave two sends made in the same tick", () => {
    const send = vi.fn((_data: string) => true);

    submitToPty("cell-a", send, "first");
    submitToPty("cell-a", send, "second");

    // The second body is withheld: writing it here would put it on the same
    // prompt line as the first, which has not been submitted yet.
    expect(send.mock.calls).toEqual([["first"]]);

    vi.advanceTimersByTime(SUBMIT_RETURN_MS);
    expect(send.mock.calls).toEqual([["first"], ["\r"], ["second"]]);

    vi.advanceTimersByTime(SUBMIT_RETURN_MS);
    expect(send.mock.calls).toEqual([["first"], ["\r"], ["second"], ["\r"]]);
  });

  it("queues per session rather than across the panel", () => {
    const a = vi.fn((_data: string) => true);
    const b = vi.fn((_data: string) => true);

    submitToPty("cell-a", a, "for a");
    submitToPty("cell-b", b, "for b");

    // Two cells are two PTYs; one waiting on the other would make every reply
    // slower for no reason.
    expect(a.mock.calls).toEqual([["for a"]]);
    expect(b.mock.calls).toEqual([["for b"]]);

    vi.advanceTimersByTime(SUBMIT_RETURN_MS);
    expect(a.mock.calls).toEqual([["for a"], ["\r"]]);
    expect(b.mock.calls).toEqual([["for b"], ["\r"]]);
  });

  it("gives the return a turn of its own rather than a microtask", async () => {
    const send = vi.fn((_data: string) => true);

    submitToPty("cell-a", send, "ship it");
    await Promise.resolve();

    // A microtask runs before the socket has drained anything: the two frames
    // would still reach the pty back to back, which is the burst this splits.
    expect(send.mock.calls).toEqual([["ship it"]]);
    expect(SUBMIT_RETURN_MS).toBeGreaterThanOrEqual(16);
  });
});

/**
 * Every report `submitToPty` raises is a call into code this module does not
 * own: the answer pane's move into its waiting state, a launcher store
 * notification that reaches every subscriber of it. Any of it may throw, and
 * when it does the queue must still be left in a state a later submit can use.
 * The failure this pins is silent and permanent — the session's entry stays
 * standing as the busy flag, nothing is scheduled to clear it, and every
 * further submit for that cell is pushed onto an array nothing will ever drain,
 * so the composer and the launcher row are dead until the page is reloaded.
 */
describe("submitToPty when a caller's own callback throws", () => {
  it("still schedules the return, and still takes the next submit, when onDelivered throws", () => {
    const send = vi.fn((_data: string) => true);

    // The throw is the caller's bug and is left to reach the caller: this
    // module does the bookkeeping it owes and re-raises rather than eating an
    // error, which is the very thing the rest of this file exists to undo.
    expect(() =>
      submitToPty("cell-a", send, "first", {
        onDelivered: () => {
          throw new Error("a subscriber blew up");
        },
      }),
    ).toThrow("a subscriber blew up");

    // The body is already on the socket, so the return is owed regardless of
    // what the caller did with the news: without it the line sits unsubmitted
    // in the TUI's prompt.
    vi.advanceTimersByTime(SUBMIT_RETURN_MS);
    expect(send.mock.calls).toEqual([["first"], ["\r"]]);

    submitToPty("cell-a", send, "second");
    expect(send.mock.calls).toEqual([["first"], ["\r"], ["second"]]);
  });

  it("still advances the queue when onFailed throws on a refused body", () => {
    const dead = vi.fn((_data: string) => false);

    expect(() =>
      submitToPty("cell-a", dead, "first", {
        onFailed: () => {
          throw new Error("a subscriber blew up");
        },
      }),
    ).toThrow("a subscriber blew up");

    // A refused body has no return to wait for, so nothing further was written.
    expect(dead.mock.calls).toEqual([["first"]]);

    const live = vi.fn((_data: string) => true);
    submitToPty("cell-a", live, "second");
    expect(live.mock.calls).toEqual([["second"]]);
  });

  it("still advances the queue when onFailed throws on a refused return", () => {
    const bodyOnly = vi.fn((data: string) => data !== "\r");

    submitToPty("cell-a", bodyOnly, "first", {
      onFailed: (stage) => {
        throw new Error(`a subscriber blew up on ${stage}`);
      },
    });
    expect(bodyOnly.mock.calls).toEqual([["first"]]);

    // The throw happens inside the scheduled return, so this is where it
    // surfaces — asserted here so the suite catches it deliberately rather
    // than meeting it as an unhandled error.
    expect(() => vi.advanceTimersByTime(SUBMIT_RETURN_MS)).toThrow(
      "a subscriber blew up on return",
    );
    expect(bodyOnly.mock.calls).toEqual([["first"], ["\r"]]);

    const live = vi.fn((_data: string) => true);
    submitToPty("cell-a", live, "second");
    expect(live.mock.calls).toEqual([["second"]]);
  });
});
