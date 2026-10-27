import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { nameColor, usePanelTheme } from "../nameColor";

describe("nameColor", () => {
  it("nameColor returns the hex in dark theme", () => {
    expect(nameColor("#e06c75", "dark")).toBe("#e06c75");
  });

  it("nameColor mixes toward black in light theme", () => {
    expect(nameColor("#e06c75", "light")).toBe(
      "color-mix(in srgb, #e06c75 72%, black)",
    );
  });
});

describe("usePanelTheme", () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  it("is dark unless the root element says light, and follows a change", async () => {
    const { result } = renderHook(() => usePanelTheme());
    expect(result.current).toBe("dark");

    await act(async () => {
      document.documentElement.dataset.theme = "light";
      // MutationObserver callbacks are microtasks.
      await Promise.resolve();
    });
    expect(result.current).toBe("light");
  });
});
