import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  legacy: {
    inconsistentCjsInterop: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    include: [
      "src/**/__tests__/**/*.test.{ts,tsx}",
      "server/**/*.test.ts",
      "scripts/**/__tests__/**/*.test.ts",
      "hooks/**/__tests__/**/*.test.ts",
    ],
    // Inert on vitest 4.1.4 (the option was removed and is silently ignored —
    // everything runs in jsdom). Kept as a statement of intent: both suites
    // drive real child processes, so they must never depend on the DOM.
    environmentMatchGlobs: [
      ["server/**/*.test.ts", "node"],
      ["scripts/**/__tests__/**/*.test.ts", "node"],
      ["hooks/**/__tests__/**/*.test.ts", "node"],
    ],
  },
});
