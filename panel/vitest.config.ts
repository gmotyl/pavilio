import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Three test projects, run one after the other (`sequence.groupOrder`).
//
// `browser` (jsdom) and `node` are the in-process suites: `pnpm test` runs those
// two. `node-slow` holds the suites that drive real processes — shell scripts,
// the panel launcher, git sync, the speech hooks — and runs on its own
// (`pnpm test:slow`); pre-push runs it only when a push touches what those
// suites execute (see .husky/pre-push). `pnpm test:all` runs all three.
//
// `environmentMatchGlobs` used to express the jsdom/node split, but vitest 4
// removed the option and ignores it silently: every server test was in fact
// running in jsdom, where Vite resolves browser conditions and Express 5's
// `"/{*splat}"` catch-all stopped matching — so `static-frontend`'s deep-link
// tests answered 404 while the product itself was correct under node.
// `projects` is the replacement, and an unknown key in it is rejected rather
// than ignored.
//
// The projects run in sequence, not interleaved in one worker pool: node tests
// touch servers and the filesystem, and running them alongside browser tests
// made them contend over machine-global state. All `browser` files finish
// before the first `node` file starts, and all `node` files before `node-slow`.

// The slow project is an allowlist: a new process-driving suite has to be placed
// here on purpose. Keep it in step with the `SLOW` subject pattern in
// .husky/pre-push (server/__tests__/test-projects.contract.test.ts checks both).
const SLOW_SUITES = [
  "server/__tests__/{setup-sh,update-sh,pm,panel-ctl,launcher-toolchain,setup-codex,setup-shortcut}.test.ts",
  "server/lib/__tests__/syncRepo.test.ts",
  "scripts/__tests__/install-speech-hook.test.ts",
  "hooks/__tests__/*.test.ts",
];

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
          exclude: [...configDefaults.exclude, ...SLOW_SUITES],
        },
      },
      {
        // Same environment and setup as `node`, but one file at a time: these
        // suites contend over the machine (ports, `pgrep`, the pnpm store). The
        // project-wide timeout replaces the per-test overrides they used to
        // carry. Default pool (forks): they chdir, mutate env and spawn children.
        legacy: {
          inconsistentCjsInterop: true,
        },
        test: {
          name: "node-slow",
          environment: "node",
          sequence: {
            groupOrder: 2,
          },
          fileParallelism: false,
          testTimeout: 120_000,
          globals: true,
          setupFiles: ["./test-setup.node.ts"],
          include: SLOW_SUITES,
        },
      },
    ],
  },
});
