import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Two test projects, because this package holds two kinds of test.
//
// `environmentMatchGlobs` used to express that split, but vitest 4 removed the
// option and ignores it silently: every server test was in fact running in
// jsdom, where Vite resolves browser conditions and Express 5's `"/{*splat}"`
// catch-all stopped matching — so `static-frontend`'s deep-link tests answered
// 404 while the product itself was correct under node. `projects` is the
// replacement, and an unknown key in it is rejected rather than ignored.
//
// `pnpm test` still runs both; `vitest --project node` runs one.
//
// The projects run in sequence (`sequence.groupOrder` below), not interleaved
// in one worker pool: node-project tests drive real child processes, servers
// and the filesystem, so running them alongside browser-project tests made
// them contend over machine-global state. Serializing removes that
// cross-project interference — all `browser` files finish before the first
// `node` file starts.
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        legacy: {
          inconsistentCjsInterop: true,
        },
        test: {
          name: "browser",
          environment: "jsdom",
          sequence: {
            groupOrder: 0,
          },
          globals: true,
          setupFiles: ["./src/test-setup.ts"],
          include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
        },
      },
      {
        // No react plugin and no DOM setup file: these suites drive real child
        // processes, HTTP servers and the filesystem, and must never depend on
        // a DOM. The one piece of setup they share is the git-environment strip.
        legacy: {
          inconsistentCjsInterop: true,
        },
        test: {
          name: "node",
          environment: "node",
          sequence: {
            groupOrder: 1,
          },
          globals: true,
          setupFiles: ["./test-setup.node.ts"],
          include: [
            "server/**/*.test.ts",
            "scripts/**/__tests__/**/*.test.ts",
            "hooks/**/__tests__/**/*.test.ts",
          ],
        },
      },
    ],
  },
});
