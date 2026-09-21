import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readLastPath,
  writeLastPath,
  readLastReposQuery,
  writeLastReposQuery,
  clearLastReposQuery,
} from "../lastPath";
import { preferences } from "../../../preferences/declarations";

describe("lastPath helpers", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("writes the path under the project-scoped key", () => {
    writeLastPath("pavilio", "/project/pavilio/repos?file=a.ts");
    // Still sessionStorage, still one key per project — the declaration's key
    // now, and JSON as every stored preference is.
    expect(sessionStorage.getItem(`${preferences.lastPath.key}@pavilio`)).toBe(
      JSON.stringify("/project/pavilio/repos?file=a.ts"),
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

describe("lastReposQuery helpers", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("writes and reads back the query string", () => {
    writeLastReposQuery(
      "pavilio",
      "repo=abc&file=src%2Ffoo.ts&scope=branch-diff",
    );
    expect(readLastReposQuery("pavilio")).toBe(
      "repo=abc&file=src%2Ffoo.ts&scope=branch-diff",
    );
  });

  it("returns null when nothing stored", () => {
    expect(readLastReposQuery("missing")).toBeNull();
  });

  it("clears the stored query", () => {
    writeLastReposQuery("pavilio", "repo=abc");
    clearLastReposQuery("pavilio");
    expect(readLastReposQuery("pavilio")).toBeNull();
  });

  it("silently no-ops on write when sessionStorage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeLastReposQuery("pavilio", "x=1")).not.toThrow();
    spy.mockRestore();
  });

  it("returns null on read when sessionStorage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    expect(readLastReposQuery("pavilio")).toBeNull();
    spy.mockRestore();
  });
});
