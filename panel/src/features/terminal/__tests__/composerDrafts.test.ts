/**
 * The per-session composer drafts.
 *
 * Only the module's OWN behaviour is pinned here — the keying, the empty
 * default, what a clear removes, and that none of it leaves the tab's memory.
 * The other three criteria are written in terms of the PANE ("the pane is
 * closed and reopened", "a new utterance arrives", "the draft is sent"), and a
 * draft that survived a `Map` but not an unmount would satisfy every one of
 * them here while failing the user: those live in `AnswerComposer.send.test.tsx` ("send"),
 * against a composer that is actually mounted, typed into and sent from.
 *
 * Only the last test calls the reset itself, to pin what it clears. The store is a tab-scoped
 * singleton and `test-setup.ts` clears it between tests the same way it clears
 * the session store and the sidebar fold — so the first assertion of "keeps
 * drafts separate per session" is also the proof that the teardown ran: the
 * test above it leaves `cell-a` written.
 */
import { describe, expect, it } from "vitest";

import {
  __resetComposerDraftsForTests,
  clearDraft,
  getDraft,
  holdCaret,
  releaseCaret,
  setDraft,
  takeHeldCaret,
} from "../composerDrafts";

describe("composerDrafts", () => {
  it("answers an empty string for a session that has never been typed in", () => {
    // Never a `null` or an `undefined`: the value goes straight into a
    // controlled textarea, and a field whose `value` is undefined is an
    // uncontrolled one for the rest of its life.
    expect(getDraft("cell-untouched")).toBe("");
  });

  it("forgets a draft that has been cleared", () => {
    setDraft("cell-b", "half a thought");
    expect(getDraft("cell-b")).toBe("half a thought");

    clearDraft("cell-b");

    expect(getDraft("cell-b")).toBe("");
  });

  it("keeps a draft out of browser storage", () => {
    setDraft("cell-a", "in memory only");

    // "In memory only" is the contract, not an implementation detail: a draft
    // is unsent text, it belongs to this tab, and a reload has to come back to
    // an empty field rather than to a reply the user walked away from.
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("keeps drafts separate per session", () => {
    // `cell-a` was written by the test above. Empty here means the teardown
    // cleared the singleton — without it this line fails, and every claim
    // below it would have been about leaked state.
    expect(getDraft("cell-a")).toBe("");

    setDraft("cell-a", "reply to a");
    setDraft("cell-b", "reply to b");

    expect(getDraft("cell-a")).toBe("reply to a");
    expect(getDraft("cell-b")).toBe("reply to b");

    // And a clear is as narrow as a write: sending one cell's reply must not
    // empty the field of the cell beside it.
    clearDraft("cell-a");

    expect(getDraft("cell-a")).toBe("");
    expect(getDraft("cell-b")).toBe("reply to b");
  });

  it("takeHeldCaret returns the held caret once", () => {
    expect(takeHeldCaret("cell-a")).toBeNull();

    holdCaret("cell-a", { start: 4, end: 9 });

    // One rebuilt composer reclaims the field; a second mount for the same
    // session (the eye, an auto-open) must not be handed focus as well.
    expect(takeHeldCaret("cell-a")).toEqual({ start: 4, end: 9 });
    expect(takeHeldCaret("cell-a")).toBeNull();
  });

  it("a blur releases the held caret", () => {
    holdCaret("cell-a", { start: 3, end: 3 });

    releaseCaret("cell-a");

    expect(takeHeldCaret("cell-a")).toBeNull();
  });

  it("drafts and carets do not leak between sessions", () => {
    setDraft("cell-a", "reply to a");
    holdCaret("cell-a", { start: 2, end: 2 });

    expect(getDraft("cell-b")).toBe("");
    expect(takeHeldCaret("cell-b")).toBeNull();

    // A release is as narrow as a hold: leaving one cell's field must not
    // drop the caret another cell is about to reclaim.
    holdCaret("cell-b", { start: 5, end: 7 });
    releaseCaret("cell-a");

    expect(takeHeldCaret("cell-a")).toBeNull();
    expect(takeHeldCaret("cell-b")).toEqual({ start: 5, end: 7 });
    expect(getDraft("cell-a")).toBe("reply to a");
  });

  it("the test teardown forgets held carets too", () => {
    holdCaret("cell-a", { start: 3, end: 3 });

    __resetComposerDraftsForTests();

    expect(takeHeldCaret("cell-a")).toBeNull();
  });
});
