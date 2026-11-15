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

// Git identity comes from the environment, not from `git config user.*`. A
// fixture that writes user.name/user.email writes them into whichever repository
// git resolves — and when an inherited GIT_DIR misdirected one, that was the real
// repository, which kept `seed` / `seed@test` in its config long after the run.
//
// Env wins on all three counts: nothing persistent is written anywhere; it
// reaches every git child the code under test spawns (syncRepo commits by
// itself), so fixtures need no identity of their own; and it beats every config
// file, so even a misdirected fixture commit lands without adding a user.* key.
// Set unconditionally, so a developer's own identity never leaks into fixtures.
process.env.GIT_AUTHOR_NAME = "fixture";
process.env.GIT_AUTHOR_EMAIL = "fixture@test";
process.env.GIT_COMMITTER_NAME = "fixture";
process.env.GIT_COMMITTER_EMAIL = "fixture@test";
