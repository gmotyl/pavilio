# Workspaces

How one workspace tracks upstream pavilio — as a clone of it, or as a private
repository beside a pavilio clone — and how several machines share it.

## Teams: a private workspace tracking upstream

The [Quick Start](install.md) clone is already a workspace that tracks upstream: `pnpm
bootstrap` renames the pavilio remote to `upstream`, leaves `origin` free for
your own private repository, and `pnpm sync` rebases your notes onto whatever
upstream has grown since. For one person on one machine, that is the whole story.

Teams usually want the other shape — **one private workspace repository, with a
pavilio clone beside it** to sync from. New panel features, skills and scripts
flow in; files that only exist in your private repo are never touched.

```bash
# Clone both into the same parent directory
git clone git@github.com:gmotyl/pavilio.git              # the upstream
git clone git@github.com:YOUR_TEAM/my-workspace.git      # your private repo
cd my-workspace

# Your private project registry
cp ../pavilio/AGENTS.md.example .projects.local.md
# Edit .projects.local.md with your actual projects

# Seed the two things sync mode cannot bring you: it rsyncs panel/, skills/,
# scripts/ and commands/, but never the root package.json — and without that
# there is no `pnpm` script to run in the first place.
cp ../pavilio/package.json .
cp -R ../pavilio/scripts .

# The first sync. The explicit path is not optional here: see below.
bash scripts/update.sh ../pavilio
```

**Do not run `pnpm bootstrap` in a workspace of this shape.** `bootstrap` is the
Quick Start's command, and part of its job is to add `upstream =
https://github.com/gmotyl/pavilio.git` to any clone that lacks one. That single
remote is what `scripts/update.sh` reads to decide which mode it is in, so a
workspace that has been bootstrapped stops being mirrored and starts being
*rebased* onto pavilio — the opposite of everything this section promises.

To take a new upstream version, from the workspace:

```bash
pnpm sync ../pavilio                      # or: bash scripts/update.sh /path/to/pavilio
```

Always name the pavilio clone. An explicit path means sync mode unconditionally,
whatever the workspace's own remotes have grown since — bare `pnpm sync` is the
Quick Start's spelling, and here it is a bet on a remote you did not check. The
team's other machines do not sync at all: they run `pnpm pull` (see
[Two machines](#two-machines-one-mirror-the-rest-consumers) below).

`scripts/update.sh` has two modes and chooses between them itself, by asking
whether the workspace it is running in is a pavilio clone — read from its
remotes, not from what the directory is called, so the Quick Start's
`my-workspace` is recognised as readily as a folder named `pavilio`:

- **Clone mode** — the workspace *is* a pavilio clone (the Quick Start shape):
  `upstream` (or, before `pnpm bootstrap` has run, `origin`) points at pavilio
  itself. It rebases your commits onto `upstream/main` and commits nothing on
  your behalf: the tracked files there are your own work.
- **Sync mode** — the workspace is a separate repository with a pavilio clone as
  its sibling (the shape above). It fast-forwards that clone to `origin/main`,
  then **rsyncs** `panel/`, `skills/`, `scripts/` and — when the upstream has one
  — `commands/` into the workspace, and commits the result for you as
  `chore(sync): pavilio upstream @ <sha>`. Only `panel/` is mirrored with
  `--delete`, so modules retired upstream disappear here too; `skills/`,
  `scripts/` and `commands/` keep whatever you added downstream — with one
  exception: a skill folder whose name is listed in upstream's `skills/RETIRED`
  (and no longer exists upstream) is removed (skipped when the workspace's `skills/` is a symlink), so do not give a
  private skill a retired skill's name. Pass the clone's
  path as an argument when it is not the sibling directory named `pavilio` — an
  explicit path always means sync mode, whatever the workspace's own remotes say.

Both modes then reinstall the panel's dependencies, regenerate the agent
slash-commands and rebuild the served bundle. Neither one restarts a running
panel — do that yourself with `pnpm reboot`.

### Private config

| File | Purpose |
|------|---------|
| `.projects.local.md` | Your private project registry (gitignored) |
| `panel/panel.config.local.ts` | Local panel path overrides (gitignored) — see [Panel config](configuration.md#panel-config) |
| `scripts/start-panel-windows.local.env` | Per-host launcher settings and the node pin (gitignored) |

### Rules

- Improve the panel, skills, commands and scripts in `pavilio` directly — never
  push changes from your private workspace back here.
- `AGENTS.md` and `CLAUDE.md` are manually maintained on both sides — cherry-pick
  upstream improvements as needed.
- `pnpm sync` and `pnpm pull` regenerate the Claude Code and opencode
  slash-commands, but not the Codex ones: run `pnpm setup:codex` yourself after
  `skills/` changes.

## Two machines: one mirror, the rest consumers

One workspace can serve several machines — a desktop and a laptop, say — all
pushing to the same `origin`. Upstream pavilio must then enter the workspace
through exactly one of them; two machines each copying (or rebasing onto) their
own upstream version fight over the result.

- The **mirror machine** runs `pnpm sync`: it takes upstream and commits the
  result. `pnpm sync` does not push that commit — the next auto-sync tick does,
  or `git push` it yourself (always, when auto-sync is off) before the other
  machines pull.
- Every other machine is a **consumer machine**: it gets that result with
  `pnpm pull` — `git pull --no-rebase` from `origin`, then install, command
  refresh and build. `pnpm pull` never rsyncs, never rebases and never commits
  anything but git's own merge commit.

Every machine has a **machine id**: its sanitized hostname, unless its own
`panel/panel.config.local.ts` sets one (`machineId: "desk"`). The mirror is
recorded by id in the committed `.pavilio/sync-mirror.json`
(`{ "mirror": "desk" }`), and a machine's **sync role** is read from that file
on `origin/main` — never from the working tree — so a promotion pushed from
another machine counts as soon as it is fetched.

`pnpm sync` checks the role before it touches anything, and refuses when:

- `origin` cannot be fetched — offline, it cannot prove it is still the mirror;
- this machine is a consumer — another machine is the mirror;
- the role is unassigned — there is no mirror file yet, but the last 30 days of
  history show another machine (its `auto-sync <id>` commits or
  `time/<id>.jsonl` files). A workspace only one machine has used needs no
  mirror file and syncs as before.

Each refusal, and every `pnpm pull`, ends with the same reminder:

> With several instances, run `pnpm sync` only on the mirror machine; every
> other machine runs `pnpm pull`.

**Promotion.** `pnpm sync --promote` records this machine as the mirror,
commits it, pushes it to `origin/main` and then syncs. It counts only once the
push lands: a rejected push pulls, re-checks and retries once, and a promotion
that cannot be pushed is withdrawn.

A few edges worth knowing:

- A workspace without an `origin` remote shares no history with another machine,
  so the role check is skipped.
- The role is resolved by the panel's own code (`scripts/sync-role`), so it
  needs node and the panel's dependencies installed — `pnpm sync` refuses
  without them.
- In a Quick Start clone, `pnpm sync` still rebases onto `upstream/main` (clone
  mode); the role only decides which machine may run it.

**Consumer pre-push guard.** `scripts/install-git-hooks` (run on every panel
install) installs a pre-push hook. On a consumer it refuses a push that changes
`panel/`, `scripts/`, `skills/` or `commands/` against the branch's upstream:
those are the mirror's copy of pavilio, and the next `pnpm sync` would overwrite
or conflict with the edit. Fix it upstream with a PR to pavilio, `pnpm sync` on
the mirror, then `pnpm pull` here. `git push --no-verify` is the deliberate
escape; when the role cannot be resolved at all, the hook lets the push through
with a warning.

**Preferences** are one file per machine — see
[Workspace preferences](configuration.md#workspace-preferences).
A new machine starts from the mirror's file, and Settings can copy any other
machine's file over its own.

> **Rolling out per-machine preferences.** After `pnpm pull` on a consumer,
> check that `.pavilio/preferences/<mirror>.json` exists before restarting the
> panel. If it does not (the mirror has not booted or auto-synced since the
> upgrade), the consumer seeds its own file from its local legacy
> `.pavilio/preferences.json` instead. To fix that, delete this machine's own
> `.pavilio/preferences/<machineId>.json` and restart once the mirror's file is
> there, or use Settings → **Copy preferences from <mirror>**.

**Changing a machine id later.** Setting `machineId` in
`panel/panel.config.local.ts` on a machine that already has history starts new
per-machine files under the new id: preferences, `time/<id>.jsonl` and the TTS
usage file (`.panel/tts-usage/<id>.json`). Totals still sum the old files, but manual time entries recorded under
the old id can no longer be edited from that machine.

**Auto-sync merges.** Each tick commits the data paths (`projects/` by default),
this machine's own preferences file and `.pavilio/voices/` — never another
machine's preferences — then runs `git pull --no-rebase` and pushes. There is no
autostash: when an uncommitted file outside those paths would be overwritten by
incoming changes, git refuses and auto-sync shows **blocked**, naming the files
to commit or discard. A conflicting merge is aborted and reported, and a repo
already mid-merge or mid-rebase is reported, never touched. The default interval
is 60 minutes (`autoSync.intervalMinutes` in `panel.config.local.ts` overrides
it). The same install step turns on `rerere.enabled`, so a conflict you resolve
once is resolved the same way the next time.
