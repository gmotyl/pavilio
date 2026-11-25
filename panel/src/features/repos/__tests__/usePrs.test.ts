import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { jsonResponse, stubFetch } from "../../../test-utils";
import type { PrFilter } from "../../../preferences/declarations";
import { __resetKnownLoginForTests, knownLogin, usePrs } from "../usePrs";
import { ME, PRS } from "./prFixtures";

const numbers = (prs: { number: number }[]) => prs.map((p) => p.number);

describe("usePrs", () => {
  it("filter presets and author narrow the list and counts", async () => {
    const fetch = stubFetch({ "/api/prs": { me: ME, prs: PRS, unavailable: [{ repo: "gone", reason: "not-github" }] } });
    const { result, rerender } = renderHook(({ filter }: { filter: PrFilter }) => usePrs("pavilio", filter), {
      initialProps: { filter: { preset: "mine", author: null } },
    });
    await waitFor(() => expect(result.current.me).toBe(ME));
    expect(fetch.mock.calls[0][0]).toBe("/api/prs?project=pavilio");
    expect(result.current.unavailable).toEqual([{ repo: "gone", reason: "not-github" }]);
    expect(numbers(result.current.prs)).toEqual([1, 2]);
    expect(result.current.counts).toEqual({ mine: 2, review: 3, all: 6 });
    expect(result.current.reviewRequested).toBe(3);
    expect(result.current.authors).toEqual(["anna", "bob", ME]);

    rerender({ filter: { preset: "review", author: null } });
    expect(numbers(result.current.prs)).toEqual([3, 4, 5]);

    rerender({ filter: { preset: "all", author: null } });
    expect(numbers(result.current.prs)).toEqual([1, 2, 3, 4, 5, 6]);

    rerender({ filter: { preset: "review", author: "anna" } });
    expect(numbers(result.current.prs)).toEqual([3, 4]);
    expect(result.current.counts).toEqual({ mine: 0, review: 2, all: 2 });
    // The pill count ignores the author narrowing.
    expect(result.current.reviewRequested).toBe(3);

    rerender({ filter: { preset: "all", author: "bob" } });
    expect(numbers(result.current.prs)).toEqual([5, 6]);
    expect(result.current.counts).toEqual({ mine: 0, review: 1, all: 2 });
  });

  describe("project switch", () => {
    const ALL: PrFilter = { preset: "all", author: null };
    const deferred = () => {
      let resolve!: (r: Response) => void;
      const promise = new Promise<Response>((r) => (resolve = r));
      return { promise, resolve };
    };

    it("drops the previous project's PRs until the new project's list arrives", async () => {
      const b = deferred();
      stubFetch({ "project=a": { me: ME, prs: PRS, unavailable: [] }, "project=b": () => b.promise });
      const { result, rerender } = renderHook(({ project }: { project: string }) => usePrs(project, ALL), {
        initialProps: { project: "a" },
      });
      await waitFor(() => expect(result.current.all).toHaveLength(6));

      rerender({ project: "b" });
      expect(result.current.all).toEqual([]);
      expect(result.current.prs).toEqual([]);
      expect(result.current.me).toBeNull();
      expect(result.current.loading).toBe(true);

      await act(async () => b.resolve(jsonResponse({ me: "bob", prs: [PRS[5]], unavailable: [] })));
      await waitFor(() => expect(result.current.me).toBe("bob"));
      expect(numbers(result.current.all)).toEqual([6]);
    });

    it("a failed fetch for the new project shows no stale PRs", async () => {
      stubFetch({ "project=a": { me: ME, prs: PRS, unavailable: [] }, "project=b": () => new Response("", { status: 500 }) });
      const { result, rerender } = renderHook(({ project }: { project: string }) => usePrs(project, ALL), {
        initialProps: { project: "a" },
      });
      await waitFor(() => expect(result.current.all).toHaveLength(6));
      rerender({ project: "b" });
      await waitFor(() => expect(result.current.error).toBe("HTTP 500"));
      expect(result.current.all).toEqual([]);
      expect(result.current.me).toBeNull();
    });

    it("ignores a late response for the project left behind", async () => {
      const a = deferred();
      stubFetch({ "project=a": () => a.promise, "project=b": { me: "bob", prs: [PRS[5]], unavailable: [] } });
      const { result, rerender } = renderHook(({ project }: { project: string }) => usePrs(project, ALL), {
        initialProps: { project: "a" },
      });
      rerender({ project: "b" });
      await waitFor(() => expect(result.current.me).toBe("bob"));
      await act(async () => a.resolve(jsonResponse({ me: ME, prs: PRS, unavailable: [] })));
      expect(result.current.me).toBe("bob");
      expect(numbers(result.current.all)).toEqual([6]);
    });

    it("a stale response resolving last does not update the known login", async () => {
      __resetKnownLoginForTests();
      const a = deferred();
      stubFetch({ "project=a": () => a.promise, "project=b": { me: "bob", prs: [PRS[5]], unavailable: [] } });
      const { result, rerender } = renderHook(({ project }: { project: string }) => usePrs(project, ALL), {
        initialProps: { project: "a" },
      });
      rerender({ project: "b" });
      await waitFor(() => expect(result.current.me).toBe("bob"));
      expect(knownLogin()).toBe("bob");
      await act(async () => a.resolve(jsonResponse({ me: ME, prs: PRS, unavailable: [] })));
      expect(knownLogin()).toBe("bob");
    });

    it("reload refetches the current project", async () => {
      let n = 0;
      stubFetch({ "project=a": () => jsonResponse({ me: ME, prs: PRS.slice(0, ++n), unavailable: [] }) });
      const { result } = renderHook(() => usePrs("a", ALL));
      await waitFor(() => expect(result.current.all).toHaveLength(1));
      act(() => result.current.reload());
      await waitFor(() => expect(result.current.all).toHaveLength(2));
    });
  });
});
