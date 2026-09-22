import { describe, expect, it } from "vitest";
import { getStoredAutoOpenAnswer, setStoredAutoOpenAnswer } from "../autoOpenAnswer";
import { preferences } from "../../../preferences/declarations";
import { storageKey } from "../../../preferences/types";

type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

const KEY = storageKey(preferences.answerPaneAutoOpen);

describe("the auto-open default", () => {
  it("the default is off until chosen, and off again when unchosen", () => {
    // Nothing stored: off.
    expect(getStoredAutoOpenAnswer()).toBe(false);

    // Chosen: on, and read back as on. It is PORTABLE, so it lands in the
    // workspace document and never in browser storage.
    expect(setStoredAutoOpenAnswer(true)).toBe(true);
    expect(globals.__PAVILIO_PREFS__![KEY]).toBe(true);
    expect(localStorage.length).toBe(0);
    expect(getStoredAutoOpenAnswer()).toBe(true);

    // Unchosen again: the read is off.
    expect(setStoredAutoOpenAnswer(false)).toBe(false);
    expect(getStoredAutoOpenAnswer()).toBe(false);
  });

  it("a malformed stored value reads as off", () => {
    globals.__PAVILIO_PREFS__![KEY] = "yes please";
    expect(getStoredAutoOpenAnswer()).toBe(false);
  });

  it("a page with no document of its own reads off and still applies the choice", () => {
    // The auth interlock: `GET /api/preferences.js` was refused, so this page
    // knows nothing about the stored file and the store drops portable writes
    // rather than PATCHing defaults over the user's real values. The choice
    // still takes effect for this page, which is what the return value is for
    // — the same contract the old "storage unavailable" branch offered.
    delete globals.__PAVILIO_PREFS__;

    expect(getStoredAutoOpenAnswer()).toBe(false);
    expect(setStoredAutoOpenAnswer(true)).toBe(true);
    expect(getStoredAutoOpenAnswer()).toBe(false);
  });
});
