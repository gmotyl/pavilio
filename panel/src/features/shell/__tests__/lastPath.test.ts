import { beforeEach, describe, expect, it, vi } from "vitest";
import { readLastPath, writeLastPath, STORAGE_PREFIX } from "../lastPath";

describe("lastPath helpers", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("writes the path under the project-scoped key", () => {
    writeLastPath("pavilio", "/project/pavilio/repos?file=a.ts");
    expect(sessionStorage.getItem(`${STORAGE_PREFIX}pavilio`)).toBe(
      "/project/pavilio/repos?file=a.ts",
    );
  });

  it("reads back what was written", () => {
    writeLastPath("pavilio", "/project/pavilio/notes?note=foo");
    expect(readLastPath("pavilio")).toBe("/project/pavilio/notes?note=foo");
  });

  it("returns null when nothing stored", () => {
    expect(readLastPath("missing")).toBeNull();
  });

  it("silently no-ops when sessionStorage throws on write", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeLastPath("pavilio", "/foo")).not.toThrow();
    spy.mockRestore();
  });

  it("returns null when sessionStorage throws on read", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    expect(readLastPath("pavilio")).toBeNull();
    spy.mockRestore();
  });
});
