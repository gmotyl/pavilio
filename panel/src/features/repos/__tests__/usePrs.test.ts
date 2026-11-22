import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { stubFetch } from "../../../test-utils";
import type { PrFilter } from "../../../preferences/declarations";
import { usePrs } from "../usePrs";
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
});
