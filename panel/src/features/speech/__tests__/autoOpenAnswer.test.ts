import { describe, expect, it } from "vitest";
import { getStoredAutoOpenAnswer, setStoredAutoOpenAnswer } from "../autoOpenAnswer";
import { preferences } from "../../../preferences/declarations";
import { storageKey } from "../../../preferences/types";

type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

const KEY = storageKey(preferences.answerPaneAutoOpen);

describe("the auto-open default", () => {
  it("the default is on until cleared, and the cleared choice is what reads back", () => {
    // Nothing stored: ON. An answer the user asked for opens its own pane.
    expect(getStoredAutoOpenAnswer()).toBe(true);

    // Cleared: stored as false, and read back as false — the stored choice
    // beats the default, which is the whole point of keeping the box. It is
    // PORTABLE, so it lands in the workspace document, never in browser
    // storage.
    expect(setStoredAutoOpenAnswer(false)).toBe(false);
    expect(globals.__PAVILIO_PREFS__![KEY]).toBe(false);
    expect(localStorage.length).toBe(0);
    expect(getStoredAutoOpenAnswer()).toBe(false);

    // Ticked again: on, and STORED as on rather than left to the default.
    expect(setStoredAutoOpenAnswer(true)).toBe(true);
    expect(globals.__PAVILIO_PREFS__![KEY]).toBe(true);
    expect(getStoredAutoOpenAnswer()).toBe(true);
  });

  it("a cleared box survives the reload that re-injects the document", () => {
    // A reload is a new page handed the stored document by
    // `GET /api/preferences.js`. Nothing is cached across it: the read below
    // is the first this "page" makes, and it must still be the user's false
    // rather than the declared true.
    setStoredAutoOpenAnswer(false);
    const stored = { ...globals.__PAVILIO_PREFS__! };
    expect(stored[KEY]).toBe(false);

    delete globals.__PAVILIO_PREFS__;
    globals.__PAVILIO_PREFS__ = stored;

    expect(getStoredAutoOpenAnswer()).toBe(false);
  });

  it("a malformed stored value falls back to the default, which is on", () => {
    globals.__PAVILIO_PREFS__![KEY] = "yes please";
    expect(getStoredAutoOpenAnswer()).toBe(true);
  });

  it("a page with no document of its own reads the default and still applies the choice", () => {
    // The auth interlock: `GET /api/preferences.js` was refused, so this page
    // knows nothing about the stored file and the store drops portable writes
    // rather than PATCHing defaults over the user's real values. The choice
    // still takes effect for this page, which is what the return value is for
    // — the same contract the old "storage unavailable" branch offered.
    //
    // The write is the OPPOSITE of the default on purpose: written the same
    // way round, a dropped write and a landed one read back alike and this
    // test would prove nothing.
    delete globals.__PAVILIO_PREFS__;

    expect(getStoredAutoOpenAnswer()).toBe(true);
    expect(setStoredAutoOpenAnswer(false)).toBe(false);
    expect(getStoredAutoOpenAnswer()).toBe(true);
  });
});
