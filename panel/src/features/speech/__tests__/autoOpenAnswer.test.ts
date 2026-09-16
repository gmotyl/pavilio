import { describe, expect, it, vi } from "vitest";
import {
  AUTO_OPEN_ANSWER_STORAGE_KEY,
  getStoredAutoOpenAnswer,
  setStoredAutoOpenAnswer,
} from "../autoOpenAnswer";

describe("the auto-open default", () => {
  it("the default is off until chosen and off when storage throws", () => {
    expect(AUTO_OPEN_ANSWER_STORAGE_KEY).toBe("panel-answer-pane-auto-open");
    // Nothing stored: off.
    expect(getStoredAutoOpenAnswer()).toBe(false);

    // Chosen: on, stored as "1", and read back as on.
    expect(setStoredAutoOpenAnswer(true)).toBe(true);
    expect(localStorage.getItem(AUTO_OPEN_ANSWER_STORAGE_KEY)).toBe("1");
    expect(getStoredAutoOpenAnswer()).toBe(true);

    // Unchosen again: the key goes, the read is off.
    expect(setStoredAutoOpenAnswer(false)).toBe(false);
    expect(localStorage.getItem(AUTO_OPEN_ANSWER_STORAGE_KEY)).toBeNull();
    expect(getStoredAutoOpenAnswer()).toBe(false);

    // Any other stored value is not "on".
    localStorage.setItem(AUTO_OPEN_ANSWER_STORAGE_KEY, "true");
    expect(getStoredAutoOpenAnswer()).toBe(false);

    // Storage that throws reads as off — spied on the INSTANCE, and asserted
    // reached, so the guard is what is under test rather than a bypass of it.
    localStorage.setItem(AUTO_OPEN_ANSWER_STORAGE_KEY, "1");
    const getItem = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("site data blocked");
    });
    expect(getStoredAutoOpenAnswer()).toBe(false);
    expect(getItem).toHaveBeenCalled();

    // A write that throws neither crashes nor loses the value for this page.
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("site data blocked");
    });
    expect(setStoredAutoOpenAnswer(true)).toBe(true);
    expect(setItem).toHaveBeenCalled();
  });
});
