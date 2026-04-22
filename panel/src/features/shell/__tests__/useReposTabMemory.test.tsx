import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useReposTabMemory } from "../useReposTabMemory";
import { readLastReposQuery } from "../lastPath";

describe("useReposTabMemory", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("persists the query string when on the repos section", () => {
    const params = new URLSearchParams(
      "repo=abc&file=src%2Ffoo.ts&scope=branch-diff",
    );
    renderHook(() => useReposTabMemory("pavilio", "repos", params));
    expect(readLastReposQuery("pavilio")).toBe(
      "repo=abc&file=src%2Ffoo.ts&scope=branch-diff",
    );
  });

  it("does nothing when section is not repos", () => {
    const params = new URLSearchParams("file=a.md");
    renderHook(() => useReposTabMemory("pavilio", "notes", params));
    expect(readLastReposQuery("pavilio")).toBeNull();
  });

  it("does nothing when project is missing", () => {
    const params = new URLSearchParams("repo=abc");
    renderHook(() => useReposTabMemory(undefined, "repos", params));
    expect(readLastReposQuery("pavilio")).toBeNull();
  });

  it("overwrites the stored query on subsequent renders with new params", () => {
    const { rerender } = renderHook(
      ({ p }: { p: URLSearchParams }) =>
        useReposTabMemory("pavilio", "repos", p),
      { initialProps: { p: new URLSearchParams("repo=a") } },
    );
    expect(readLastReposQuery("pavilio")).toBe("repo=a");

    rerender({ p: new URLSearchParams("repo=b&file=x.ts") });
    expect(readLastReposQuery("pavilio")).toBe("repo=b&file=x.ts");
  });

  it("persists an empty string when params are cleared on repos tab", () => {
    const { rerender } = renderHook(
      ({ p }: { p: URLSearchParams }) =>
        useReposTabMemory("pavilio", "repos", p),
      { initialProps: { p: new URLSearchParams("repo=a") } },
    );
    rerender({ p: new URLSearchParams("") });
    expect(readLastReposQuery("pavilio")).toBe("");
  });
});
