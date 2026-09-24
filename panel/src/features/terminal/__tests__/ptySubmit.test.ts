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
