/**
 * The per-session answer pane store. It exists because `TerminalView` remounts
 * on every layout change (maximize, preset, drag, seam resize — the grid swaps
 * its whole body subtree), so pane state kept in component state died with the
 * view. The store outlives the view the way `terminalInstances` keeps the xterm
 * alive; it is in-memory only, so a reload still starts closed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setStoredAutoOpenAnswer } from "../../speech/autoOpenAnswer";
import {
  forgetAnswerPane,
  getAnswerPaneState,
  markSeenUtterances,
  setAnswerPaneAutoOpen,
  setAnswerPaneOpen,
  subscribeAnswerPane,
} from "../answerPaneState";

const storeDefault = (on: boolean): void => {
  setStoredAutoOpenAnswer(on);
};

beforeEach(() => {
  forgetAnswerPane("s-1");
  forgetAnswerPane("s-2");
  storeDefault(false);
});

describe("answerPaneState", () => {
  it("a fresh entry starts closed and seeds autoOpen from the browser default once", () => {
    storeDefault(true);
    const first = getAnswerPaneState("s-1");
    expect(first).toEqual({ open: false, autoOpen: true });

    // The default changing later does not reach an entry that already exists…
    storeDefault(false);
    expect(getAnswerPaneState("s-1")).toBe(first);
    expect(getAnswerPaneState("s-1").autoOpen).toBe(true);
    // …but a session first seen afterwards takes the new default.
    expect(getAnswerPaneState("s-2").autoOpen).toBe(false);
  });

  it("setAnswerPaneOpen notifies subscribers and yields a new snapshot", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAnswerPane(listener);
    const before = getAnswerPaneState("s-1");

    setAnswerPaneOpen("s-1", true);
    expect(listener).toHaveBeenCalledTimes(1);
    const after = getAnswerPaneState("s-1");
    expect(after).not.toBe(before);
    expect(after).toEqual({ open: true, autoOpen: false });

    setAnswerPaneAutoOpen("s-1", true);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getAnswerPaneState("s-1")).toEqual({ open: true, autoOpen: true });

    unsubscribe();
    setAnswerPaneOpen("s-1", false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("an unchanged write keeps the same snapshot object and notifies nobody", () => {
    const listener = vi.fn();
    subscribeAnswerPane(listener);
    setAnswerPaneOpen("s-1", true);
    const snapshot = getAnswerPaneState("s-1");
    listener.mockClear();

    setAnswerPaneOpen("s-1", true);
    setAnswerPaneAutoOpen("s-1", false);
    expect(getAnswerPaneState("s-1")).toBe(snapshot);
    expect(listener).not.toHaveBeenCalled();
  });

  it("markSeenUtterances seeds silently, then reports only ids not seen before", () => {
    expect(markSeenUtterances("s-1", ["u-1", "u-2"])).toEqual([]);
    expect(markSeenUtterances("s-1", ["u-1", "u-2"])).toEqual([]);
    expect(markSeenUtterances("s-1", ["u-2", "u-3"])).toEqual(["u-3"]);
    // Once reported, an id is old news.
    expect(markSeenUtterances("s-1", ["u-3"])).toEqual([]);
    // Sessions do not share a set.
    expect(markSeenUtterances("s-2", ["u-3"])).toEqual([]);
  });

  it("forgetAnswerPane drops the entry: the next read is a fresh default", () => {
    setAnswerPaneOpen("s-1", true);
    setAnswerPaneAutoOpen("s-1", true);
    markSeenUtterances("s-1", ["u-1"]);

    forgetAnswerPane("s-1");
    expect(getAnswerPaneState("s-1")).toEqual({ open: false, autoOpen: false });
    // The seen set went with it: the first call seeds again.
    expect(markSeenUtterances("s-1", ["u-9"])).toEqual([]);
  });
});
