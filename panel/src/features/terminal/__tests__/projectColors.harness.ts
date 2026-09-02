import { vi } from "vitest";

import { __resetProjectColorsForTests } from "../useProjectColors";

/**
 * Colour is a *project* property now, so every surface test that asserts one
 * needs the shared `useProjectColors` store primed. The store fetches once per
 * page load, so priming means stubbing `fetch` and resetting the singleton —
 * not passing a prop.
 */
export const TEST_PROJECT_COLORS: Record<string, string> = {
  alpha: "#f0c674",
  beta: "#e06c75",
};

/** jsdom normalises every colour it parses to `rgb(r, g, b)`. */
export function rgb(hex: string): string {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/**
 * Reset the shared store and answer its one GET with `colors`. Call from
 * `beforeEach`; `src/test-setup.ts` restores the stub afterwards.
 */
export function installProjectColors(
  colors: Record<string, string> = TEST_PROJECT_COLORS,
): void {
  __resetProjectColorsForTests();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "/api/projects/colors") {
      return { ok: true, status: 200, json: async () => ({ colors }) } as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  });
}
