/**
 * The per-session answer pane store. It exists because `TerminalView` remounts
 * on every layout change (maximize, preset, drag, seam resize — the grid swaps
 * its whole body subtree), so pane state kept in component state died with the
 * view. The store outlives the view the way `terminalInstances` keeps the xterm
 * alive; it is in-memory only, so a reload still starts closed.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getStoredAutoOpenAnswer, setStoredAutoOpenAnswer } from "../../speech/autoOpenAnswer";
import {
  anyAnswerPaneOpen,
  forgetAnswerPane,
  getAnswerPaneState,
  markSeenUtterances,
  setAnswerPaneOpen,
  subscribeAnswerPane,
  useAnyAnswerPaneOpen,
} from "../answerPaneState";

// A pass-through spy on the preference read, so a test can prove the store
// never consults it: the arrival reads the preference itself, at arrival.
vi.mock("../../speech/autoOpenAnswer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../speech/autoOpenAnswer")>();
  return { ...actual, getStoredAutoOpenAnswer: vi.fn(actual.getStoredAutoOpenAnswer) };
});

const storeDefault = (on: boolean): void => {
  setStoredAutoOpenAnswer(on);
};

beforeEach(() => {
  forgetAnswerPane("s-1");
  forgetAnswerPane("s-2");
  storeDefault(false);
});

describe("answerPaneState", () => {
  it("the entry snapshot no longer carries an autoOpen field", () => {
    storeDefault(true);
    const read = vi.mocked(getStoredAutoOpenAnswer);
    read.mockClear();

    const first = getAnswerPaneState("s-1");
    expect(first).toEqual({ open: false });
    expect("autoOpen" in first).toBe(false);
    // Creating the entry did not consult the stored preference.
    expect(read).not.toHaveBeenCalled();

    // The control: the spy is the binding every importer sees, so a read from
    // the store would have been counted.
    getStoredAutoOpenAnswer();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("setAnswerPaneOpen notifies subscribers and yields a new snapshot", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAnswerPane(listener);
    const before = getAnswerPaneState("s-1");

    setAnswerPaneOpen("s-1", true);
    expect(listener).toHaveBeenCalledTimes(1);
    const after = getAnswerPaneState("s-1");
    expect(after).not.toBe(before);
    expect(after).toEqual({ open: true });

    unsubscribe();
    setAnswerPaneOpen("s-1", false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("an unchanged write keeps the same snapshot object and notifies nobody", () => {
    const listener = vi.fn();
    subscribeAnswerPane(listener);
    setAnswerPaneOpen("s-1", true);
    const snapshot = getAnswerPaneState("s-1");
    listener.mockClear();

    setAnswerPaneOpen("s-1", true);
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
    markSeenUtterances("s-1", ["u-1"]);

    forgetAnswerPane("s-1");
    expect(getAnswerPaneState("s-1")).toEqual({ open: false });
    // The seen set went with it: the first call seeds again.
    expect(markSeenUtterances("s-1", ["u-9"])).toEqual([]);
  });

  it("anyAnswerPaneOpen is true when any listed session's pane is open", () => {
    setAnswerPaneOpen("s-1", true);
    expect(anyAnswerPaneOpen(["s-1", "s-2"])).toBe(true);
    // Order does not matter — the fact is "any", not "the first".
    expect(anyAnswerPaneOpen(["s-2", "s-1"])).toBe(true);
  });

  it("anyAnswerPaneOpen is false for unknown and closed sessions", () => {
    // Neither has ever been given an entry.
    expect(anyAnswerPaneOpen(["s-1", "s-2"])).toBe(false);

    // Opened, then closed again — still false, and the closed entry itself
    // does not count as "unknown".
    setAnswerPaneOpen("s-1", true);
    setAnswerPaneOpen("s-1", false);
    expect(anyAnswerPaneOpen(["s-1", "s-2"])).toBe(false);

    // An id nothing has ever created an entry for.
    expect(anyAnswerPaneOpen(["s-unknown"])).toBe(false);
  });

  it("useAnyAnswerPaneOpen follows opens and closes", () => {
    const { result } = renderHook(() => useAnyAnswerPaneOpen(["s-1", "s-2"]));
    expect(result.current).toBe(false);

    act(() => setAnswerPaneOpen("s-2", true));
    expect(result.current).toBe(true);

    act(() => setAnswerPaneOpen("s-2", false));
    expect(result.current).toBe(false);
  });
});
