import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCellReaderTab, writeCellReaderTab, STORAGE_KEY } from "../cellReaderTab";

describe("cellReaderTab storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to the screen source when nothing has been chosen", () => {
    expect(readCellReaderTab()).toBe("screen");
  });

  it("restores the source that was last written", () => {
    writeCellReaderTab("answer");
    expect(readCellReaderTab()).toBe("answer");
  });

  it("falls back to the screen source when the stored value is unrecognized", () => {
    // Hand-edited storage, or a key left behind by an older build.
    localStorage.setItem(STORAGE_KEY, "transcript");
    expect(readCellReaderTab()).toBe("screen");
  });

  it("survives a localStorage that throws on read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    expect(() => readCellReaderTab()).not.toThrow();
    expect(readCellReaderTab()).toBe("screen");
  });

  it("survives a localStorage that throws on write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeCellReaderTab("answer")).not.toThrow();
  });
});
