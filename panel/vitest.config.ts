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
    include: ["src/**/__tests__/**/*.test.{ts,tsx}", "server/**/*.test.ts"],
    environmentMatchGlobs: [["server/**/*.test.ts", "node"]],
  },
});
