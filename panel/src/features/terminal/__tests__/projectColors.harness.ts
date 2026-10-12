import { vi } from "vitest";

import { __resetPreferenceStoreForTests } from "../../../preferences/store";
import { __resetProjectColorsForTests } from "../useProjectColors";

/**
 * Colour is a *project* preference now, so every surface test that asserts one
 * seeds the injected workspace document (`window.__PAVILIO_PREFS__`) rather
 * than answering a fetch.
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
 * Reset the stores and seed the workspace document with `colors`. Call from
 * `beforeEach`; the PATCH a write sends is answered with an empty 200.
 */
export function installProjectColors(
  colors: Record<string, string> = TEST_PROJECT_COLORS,
): void {
  __resetPreferenceStoreForTests();
  const doc: Record<string, unknown> = { version: 1 };
  for (const [name, hex] of Object.entries(colors)) doc[`project.color@${name}`] = hex;
  (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> }).__PAVILIO_PREFS__ = doc;
  __resetProjectColorsForTests();
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response,
  );
}
