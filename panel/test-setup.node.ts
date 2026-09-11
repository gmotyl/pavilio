import { GIT_LOCATION_VARS } from "./server/lib/gitEnv.js";

// Git picks its repository from the environment before it looks at cwd, and it
// exports these to every hook — absolute, in a linked worktree. Inherited, they
// make each fixture's `git init` / `git commit` operate on the real repository
// instead of the mkdtemp sandbox it just built, however carefully the fixture
// passes cwd. A suite run from a pre-push hook did exactly that: it reinitialised
// the shared clone as bare and pushed fixture history over main.
//
// Stripping them here rather than in the individual suites keeps every present
// and future test hermetic about which repository it touches, without each one
// having to remember. Done at import time, before any fixture can spawn git.
//
// This file is the node-safe half of the setup: it touches nothing but
// `process.env`, so the node project (server/, scripts/, hooks/) can load it
// while the jsdom project layers the DOM setup on top via ./src/test-setup.ts.
for (const name of GIT_LOCATION_VARS) delete process.env[name];
