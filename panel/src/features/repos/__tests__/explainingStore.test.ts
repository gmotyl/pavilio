import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  EXPLAIN_TIMEOUT_MS,
  __resetExplainingForTests,
  settleExplaining,
  startExplaining,
  useExplaining,
} from "../explainingStore";

const T = 1_000_000;

afterEach(() => {
  __resetExplainingForTests();
});

function entries(project: string) {
  return renderHook(() => useExplaining(project)).result.current;
}

describe("explainingStore", () => {
  it("explain entry clears when its story appears", () => {
    startExplaining("pavilio", "pavilio#7", { lang: "pl", kind: "explain" }, T);
    expect(entries("pavilio").get("pavilio#7")).toEqual({ startedAt: T, lang: "pl", kind: "explain" });

    settleExplaining("pavilio", new Map([["pavilio#8", T - 5]]), T + 1000);
    expect(entries("pavilio").has("pavilio#7")).toBe(true);

    // An older file still counts: an explain waits for the story to exist at all.
    settleExplaining("pavilio", new Map([["pavilio#7", T - 5]]), T + 2000);
    expect(entries("pavilio").has("pavilio#7")).toBe(false);
  });

  it("rebuild entry clears only after a newer modified time", () => {
    startExplaining("pavilio", "pavilio#7", { lang: "en", kind: "rebuild" }, T);

    settleExplaining("pavilio", new Map([["pavilio#7", T - 60_000]]), T + 1000);
    expect(entries("pavilio").has("pavilio#7")).toBe(true);
    settleExplaining("pavilio", new Map([["pavilio#7", T]]), T + 1000);
    expect(entries("pavilio").has("pavilio#7")).toBe(true);
    settleExplaining("pavilio", new Map(), T + 1000);
    expect(entries("pavilio").has("pavilio#7")).toBe(true);

    settleExplaining("pavilio", new Map([["pavilio#7", T + 1]]), T + 2000);
    expect(entries("pavilio").has("pavilio#7")).toBe(false);
  });

  it("entry times out after 15 minutes and a new launch replaces it", () => {
    expect(EXPLAIN_TIMEOUT_MS).toBe(15 * 60_000);
    startExplaining("pavilio", "pavilio#7", { lang: "pl", kind: "explain" }, T);

    settleExplaining("pavilio", new Map(), T + EXPLAIN_TIMEOUT_MS - 1);
    expect(entries("pavilio").get("pavilio#7")).toEqual({ startedAt: T, lang: "pl", kind: "explain" });

    settleExplaining("pavilio", new Map(), T + EXPLAIN_TIMEOUT_MS);
    expect(entries("pavilio").get("pavilio#7")).toEqual({ timedOut: true });

    // The note stays until the next launch on that row.
    settleExplaining("pavilio", new Map(), T + 2 * EXPLAIN_TIMEOUT_MS);
    expect(entries("pavilio").get("pavilio#7")).toEqual({ timedOut: true });

    const later = T + 3 * EXPLAIN_TIMEOUT_MS;
    startExplaining("pavilio", "pavilio#7", { lang: "en", kind: "rebuild" }, later);
    expect(entries("pavilio").get("pavilio#7")).toEqual({ startedAt: later, lang: "en", kind: "rebuild" });
  });

  it("useExplaining is per project and notifies subscribers", () => {
    const pavilio = renderHook(() => useExplaining("pavilio"));
    const woozle = renderHook(() => useExplaining("woozle"));
    expect(pavilio.result.current.size).toBe(0);

    act(() => startExplaining("pavilio", "pavilio#7", { lang: "en", kind: "explain" }, T));
    expect(pavilio.result.current.get("pavilio#7")).toEqual({ startedAt: T, lang: "en", kind: "explain" });
    expect(woozle.result.current.size).toBe(0);

    act(() => startExplaining("woozle", "woo-dev-be#375", { lang: "pl", kind: "rebuild" }, T));
    expect(woozle.result.current.has("woo-dev-be#375")).toBe(true);
    expect(pavilio.result.current.has("woo-dev-be#375")).toBe(false);

    // Settling one project leaves the other alone, even with a matching key.
    act(() => settleExplaining("woozle", new Map([["pavilio#7", T + 1]]), T + 1000));
    expect(pavilio.result.current.has("pavilio#7")).toBe(true);

    act(() => settleExplaining("pavilio", new Map([["pavilio#7", T + 1]]), T + 1000));
    expect(pavilio.result.current.size).toBe(0);
    expect(woozle.result.current.has("woo-dev-be#375")).toBe(true);
  });
});
