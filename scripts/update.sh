#!/bin/bash
set -e

# Git resolves its repository from the environment before it consults -C or the
# working directory, and it exports these to every hook it runs. In a linked
# worktree GIT_DIR is absolute, so a pull triggered from inside a hook would aim
# every git call below at the hook's repository rather than the clone and the
# workspace we were actually pointed at — mirroring, committing and merging in
# the wrong place. Unset them here, before the first git call, so the explicit
# paths in this script are what decide.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY \
  GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR

# Resolve upstream local clone directory
# Default: sibling directory named pavilio
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
UPSTREAM_DIR="${1:-"$SCRIPT_DIR/../../pavilio"}"

if [ ! -d "$UPSTREAM_DIR/.git" ]; then
  echo "Error: upstream repo not found at $UPSTREAM_DIR"
  echo "Usage: $0 [/path/to/pavilio]"
  echo ""
  echo "Clone it first: git clone git@github.com:gmotyl/pavilio.git"
  exit 1
fi

REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Pulling latest from upstream at $UPSTREAM_DIR..."
# rsync copies the upstream working tree, so main must be the checked-out branch.
# A plain `git pull origin main` on a feature branch merges (or fails as divergent)
# and would sync the wrong content — so put the clone on main before syncing.
UPSTREAM_BRANCH="$(git -C "$UPSTREAM_DIR" rev-parse --abbrev-ref HEAD)"
if [ "$UPSTREAM_BRANCH" != "main" ]; then
  # Switching is done for the user rather than demanded of them — it is the same
  # `git checkout main` they would type, every single time, before every pull.
  UPSTREAM_GIT_DIR="$(git -C "$UPSTREAM_DIR" rev-parse --absolute-git-dir)"
  # A half-finished rebase or merge owns HEAD and the index. Checking out main
  # from there abandons the operation mid-flight and loses the conflict
  # resolution already done, so stop before touching the clone at all — this is
  # the one state where the user really does have to act first.
  UPSTREAM_IN_PROGRESS=""
  if [ -d "$UPSTREAM_GIT_DIR/rebase-merge" ] || [ -d "$UPSTREAM_GIT_DIR/rebase-apply" ]; then
    UPSTREAM_IN_PROGRESS="a rebase"
  elif [ -f "$UPSTREAM_GIT_DIR/MERGE_HEAD" ]; then
    UPSTREAM_IN_PROGRESS="a merge"
  fi
  if [ -n "$UPSTREAM_IN_PROGRESS" ]; then
    echo "Error: upstream clone has $UPSTREAM_IN_PROGRESS in progress (branch '$UPSTREAM_BRANCH')."
    echo "Finish or abort it in $UPSTREAM_DIR, then re-run — refusing to switch to main over it."
    exit 1
  fi
  echo "Upstream clone is on branch '$UPSTREAM_BRANCH' — switching it to main."
  # Deliberately NOT gated on a clean tree: the clone permanently carries a
  # modified package.json (corepack rewrites the packageManager pin on every
  # run), so a "refuse unless clean" guard would refuse every pull and the
  # automatic switch would never once fire. git checkout already knows the
  # difference between an edit it can carry across and one it would destroy —
  # attempt it and let its exit status decide.
  # Captured with `if !` because `set -e` would otherwise abort the script
  # before the guidance below could be printed.
  if ! UPSTREAM_CHECKOUT_OUTPUT="$(git -C "$UPSTREAM_DIR" checkout main 2>&1)"; then
    echo "Error: could not switch the upstream clone to main — it is still on '$UPSTREAM_BRANCH'."
    echo "$UPSTREAM_CHECKOUT_OUTPUT"
    echo "Deal with those changes, then switch it by hand:"
    echo "  git -C \"$UPSTREAM_DIR\" checkout main"
    exit 1
  fi
  echo "  ✓ switched upstream clone from '$UPSTREAM_BRANCH' to main"
fi
git -C "$UPSTREAM_DIR" fetch origin main --quiet
# --ff-only: never create a merge commit in the upstream clone.
if ! git -C "$UPSTREAM_DIR" merge --ff-only FETCH_HEAD --quiet; then
  echo "Error: upstream main cannot fast-forward to origin/main (local commits or dirty tree)."
  echo "Resolve it in $UPSTREAM_DIR, then re-run."
  exit 1
fi

echo ""
echo "Syncing panel/..."
# --delete: panel/ is a pure mirror, so a file retired upstream must disappear
# downstream too. Without it deletions never propagate, and retired modules
# (routes/skills.ts, routes/commands.ts, features/skills/, features/commands/,
# usePlanDrag.ts, TerminalNavList.tsx, sessionColors.ts) linger downstream as
# tracked dead code that nothing imports.
#
# Deliberately NOT applied to skills/, scripts/ or commands/ below: those hold
# legitimate downstream-only content (private skills, local helper scripts)
# that --delete would destroy.
#
# --delete is destructive, so it gets guards rather than trust:
#   * refuse a missing or empty source. UPSTREAM_DIR is only validated for
#     .git/, so a repo without panel/ would otherwise mirror "nothing" over the
#     downstream tree and --delete would erase it.
#   * --max-delete caps the blast radius. A real sync retires a handful of
#     files; a larger prune means the source is wrong, and rsync exits non-zero
#     (set -e aborts) instead of completing the damage.
#   * excluded paths are protected from --delete by default — we never pass
#     --delete-excluded — so node_modules/ and dist/ survive.
#   * .husky/_ is husky's generated, untracked hook directory. It normally
#     exists on both sides and so would not be pruned anyway, but an upstream
#     clone that has not run install yet does not have it, and without this
#     exclude the prune would take the downstream git hooks with it.
# Structural check rather than an emptiness check: a panel/ holding only a
# hidden placeholder (.gitkeep) counts as non-empty, so an emptiness test would
# pass and --delete would then wipe the downstream tree — the exact failure this
# guard exists to stop. package.json is what makes the directory the panel app.
if [ ! -f "$UPSTREAM_DIR/panel/package.json" ]; then
  echo "Error: $UPSTREAM_DIR/panel does not look like the panel app (no package.json)."
  echo "Refusing to mirror it with --delete — check that $UPSTREAM_DIR is really the pavilio repo."
  exit 1
fi
# rsync --delete from a directory onto itself empties it. Refuse when both sides
# resolve to the same path (e.g. update.sh run from inside the upstream clone).
if [ "$(readlink -f "$UPSTREAM_DIR/panel")" = "$(readlink -f "$REPO_ROOT/panel")" ]; then
  echo "Error: source and destination panel/ resolve to the same directory — refusing to sync."
  exit 1
fi
rsync -a --delete --max-delete=100 \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='.DS_Store' \
  --exclude='.husky/_' \
  "$UPSTREAM_DIR/panel/" "$REPO_ROOT/panel/"

echo "Syncing skills/..."
mkdir -p "$REPO_ROOT/skills"
rsync -a \
  --exclude='.DS_Store' \
  "$UPSTREAM_DIR/skills/" "$REPO_ROOT/skills/"

if [ -d "$UPSTREAM_DIR/commands" ]; then
  echo "Syncing commands/..."
  rsync -a \
    --exclude='.DS_Store' \
    "$UPSTREAM_DIR/commands/" "$REPO_ROOT/commands/"
fi

echo "Syncing scripts/..."
rsync -a \
  --exclude='.DS_Store' \
  "$UPSTREAM_DIR/scripts/" "$REPO_ROOT/scripts/"

echo ""
echo "Regenerating agent commands from the freshly-synced skills/ ..."
# Re-run command setup for whichever agents are already configured, so new/renamed
# skills become slash-commands without a manual step. Guarded (never abort the pull)
# and fed </dev/null so a setup script's prompt can't hang an unattended update.
if [ -d "$REPO_ROOT/.claude" ]; then
  if bash "$REPO_ROOT/scripts/setup:claude-code" </dev/null >/dev/null 2>&1; then
    echo "  ✓ Claude Code commands refreshed (.claude/commands/)"
  else
    echo "  ⚠️  Claude Code refresh failed — run: bash scripts/setup:claude-code"
  fi
fi
if [ -d "$REPO_ROOT/.opencode" ] || [ -d "$HOME/.config/opencode" ]; then
  if bash "$REPO_ROOT/scripts/setup:opencode" </dev/null >/dev/null 2>&1; then
    echo "  ✓ OpenCode commands refreshed (opencode.json + .opencode/commands/)"
  else
    echo "  ⚠️  OpenCode refresh failed — run: bash scripts/setup:opencode"
  fi
fi

echo ""
echo "Building the panel bundle..."
# The panel serves a pre-built bundle, so dist/ is only as fresh as the last build:
# without this step a pull would land new source and keep serving the old bundle,
# silently. Built in the destination workspace, from the source just synced into
# it — the upstream clone's own dist/ is never copied (rsync excludes it).
#
# Deliberately the last step of the run. It is the only fatal step left after the
# rsyncs, and everything above it has to have happened first: failing earlier would
# leave skills/ synced while the slash-commands generated from it stayed stale — a
# half-updated workspace. Being last also puts the failure at the end of the
# output, where the summary would otherwise be, instead of buried mid-scroll.
PANEL_BUILD_CMD="pnpm -C \"$REPO_ROOT/panel\" build"
# `if !` rather than a bare call: under `set -e` a failed build would abort before
# the explanation below, leaving the user with vite's output and nothing else.
if ! pnpm -C "$REPO_ROOT/panel" build; then
  echo ""
  echo "Error: the panel build failed — sources are synced but the served bundle is stale."
  echo "Fix the build, then re-run it on its own:"
  echo "  $PANEL_BUILD_CMD"
  exit 1
fi
echo "  ✓ panel bundle built"

echo ""
echo "Committing the synced files..."
# Every path this script writes is tracked downstream, so a run that stops at the
# build leaves the workspace dirty after every single pull — dozens of
# machine-generated modifications the user has to read past in `git status` and
# hand-commit with a message they have to invent each time.
#
# Scoped pathspecs, never `git add -A`: the destination is a live notes workspace
# whose working tree normally carries the user's own unrelated edits (briefings,
# time logs, half-written notes). `git add -A -- <paths>` stages upstream
# deletions too (panel/ is mirrored with --delete, so retired files must be
# committed as deletions), while `git commit -- <paths>` commits only those paths
# and leaves anything staged elsewhere staged and uncommitted.
#
# Deliberately last and deliberately non-fatal: the sync and the bundle are the
# run's actual product and have both already succeeded by the time we get here. A
# workspace that cannot be committed — not a repo, mid-merge, a hook that refuses
# — is worth a warning, not discarding a good pull. Set PAVILIO_PULL_COMMIT=0 to
# skip this step and inspect the sync by hand instead.
COMMIT_PATHS=(panel skills scripts commands .claude/commands .opencode/commands opencode.json)

if [ "${PAVILIO_PULL_COMMIT:-1}" = "0" ]; then
  echo "  ⏭️  skipped (PAVILIO_PULL_COMMIT=0) — synced files left uncommitted."
elif ! git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  # A workspace does not have to be version-controlled to be a valid destination.
  echo "  ⏭️  workspace is not a git repo — nothing to commit."
else
  DEST_GIT_DIR="$(git -C "$REPO_ROOT" rev-parse --absolute-git-dir)"
  # Committing into a half-finished merge or rebase would fold the sync into
  # whatever the user is resolving. Their operation owns HEAD until they finish it.
  if [ -d "$DEST_GIT_DIR/rebase-merge" ] || [ -d "$DEST_GIT_DIR/rebase-apply" ] ||
    [ -f "$DEST_GIT_DIR/MERGE_HEAD" ]; then
    echo "  ⚠️  workspace has a merge or rebase in progress — synced files left uncommitted."
    echo "      Finish it, then commit them yourself."
  else
    # commands/ is optional upstream, and the agent command dirs only exist once
    # the matching agent has been set up. Staging a path that is not there aborts
    # the add, taking the real paths with it.
    PRESENT_PATHS=()
    for COMMIT_PATH in "${COMMIT_PATHS[@]}"; do
      if [ -e "$REPO_ROOT/$COMMIT_PATH" ]; then
        PRESENT_PATHS+=("$COMMIT_PATH")
      fi
    done
    # An empty pathspec list is the one input that turns this block into its own
    # opposite: `git add -A --` with nothing after it means "everything", so it
    # would stage exactly the unrelated work the scoping exists to protect, and do
    # it silently. Unreachable as the script stands — scripts/ holds the running
    # script, so it is always present — but guarded rather than argued about,
    # because nothing would report the day a refactor makes it reachable.
    if [ ${#PRESENT_PATHS[@]} -eq 0 ]; then
      echo "  ⏭️  none of the synced paths exist here — nothing to commit."
    else
      git -C "$REPO_ROOT" add -A -- "${PRESENT_PATHS[@]}"
      if git -C "$REPO_ROOT" diff --cached --quiet -- "${PRESENT_PATHS[@]}"; then
        echo "  ✓ already up to date — nothing to commit"
      else
        # Name the upstream commit actually synced, so the downstream history says
        # which pavilio revision the workspace is mirroring rather than just "sync".
        UPSTREAM_SHA="$(git -C "$UPSTREAM_DIR" rev-parse --short HEAD)"
        UPSTREAM_SUBJECT="$(git -C "$UPSTREAM_DIR" log -1 --pretty=%s)"
        # --shortstat already begins with a space, so no separator is added here.
        SYNC_SUMMARY="$(git -C "$REPO_ROOT" diff --cached --shortstat -- "${PRESENT_PATHS[@]}")"
        if git -C "$REPO_ROOT" commit --quiet \
          -m "chore(sync): pavilio upstream @ $UPSTREAM_SHA" \
          -m "$UPSTREAM_SUBJECT" \
          -m "Synced by scripts/update.sh." \
          -- "${PRESENT_PATHS[@]}"; then
          echo "  ✓ committed sync of upstream $UPSTREAM_SHA —${SYNC_SUMMARY}"
        else
          # Most likely a pre-commit hook. The staged files are still there for the
          # user to deal with, so say so rather than leaving them guessing.
          echo "  ⚠️  commit failed — the synced files are staged, commit them yourself."
        fi
      fi
    fi
  fi
fi

echo ""
echo "Done. panel/, skills/, scripts/ (and commands/ if present) synced from upstream;"
echo "agent commands regenerated for configured agents, and the sync committed."
echo ""
echo "The panel bundle is built and ready to start: pnpm start"
echo ""
echo "Note: AGENTS.md and CLAUDE.md are manually maintained."
echo "Check https://github.com/gmotyl/pavilio for changes and cherry-pick as needed."
