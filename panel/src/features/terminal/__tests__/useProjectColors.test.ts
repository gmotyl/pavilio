import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { derivedProjectColor } from "../../projects/projectMark";
import { readPreference, writePreference } from "../../../preferences/store";
import { preferences } from "../../../preferences/declarations";
import { useProjectColors } from "../useProjectColors";
import { installProjectColors } from "./projectColors.harness";

describe("useProjectColors", () => {
  beforeEach(() => installProjectColors({ alpha: "#f0c674" }));
  afterEach(() => {
    delete (globalThis as { __PAVILIO_PREFS__?: unknown }).__PAVILIO_PREFS__;
  });

  it("returns the stored colour", () => {
    const { result } = renderHook(() => useProjectColors());
    expect(result.current.colorFor("alpha")).toBe("#f0c674");
  });

  it("unset colour derives from the project name and writes nothing", () => {
    const { result } = renderHook(() => useProjectColors());
    expect(result.current.colorFor("gamma")).toBe(derivedProjectColor("gamma"));
    expect(result.current.colorFor("gamma")).toBe(derivedProjectColor("gamma"));
    expect(
      (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> }).__PAVILIO_PREFS__,
    ).toEqual({ version: 1, "project.color@alpha": "#f0c674" });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.colors).toEqual({ alpha: "#f0c674" });
  });

  it("setColor stores the preference and every consumer repaints", async () => {
    const a = renderHook(() => useProjectColors());
    const b = renderHook(() => useProjectColors());
    await act(async () => {
      await a.result.current.setColor("gamma", "#123456");
    });
    expect(readPreference(preferences.projectColor, "gamma")).toBe("#123456");
    expect(a.result.current.colorFor("gamma")).toBe("#123456");
    expect(b.result.current.colorFor("gamma")).toBe("#123456");
    expect(b.result.current.colors.gamma).toBe("#123456");
  });

  it("rejects a malformed colour and saves nothing", async () => {
    const { result } = renderHook(() => useProjectColors());
    await expect(result.current.setColor("alpha", "red")).rejects.toThrow();
    expect(result.current.colorFor("alpha")).toBe("#f0c674");
  });

  it("keeps a stable snapshot between unrelated renders", () => {
    const { result, rerender } = renderHook(() => useProjectColors());
    const first = result.current.colors;
    rerender();
    expect(result.current.colors).toBe(first);
  });

  it("picks up a colour stored later for a project that had none here", () => {
    const { result } = renderHook(() => useProjectColors());
    expect(result.current.colorFor("gamma")).toBe(derivedProjectColor("gamma"));
    // Stands in for another tab's change landing through the preference store.
    act(() => writePreference(preferences.projectColor, "#123456", "gamma"));
    expect(result.current.colorFor("gamma")).toBe("#123456");
    expect(result.current.colors.gamma).toBe("#123456");
  });
});
