#!/bin/bash
set -e

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
# and would sync the wrong content — refuse instead.
UPSTREAM_BRANCH="$(git -C "$UPSTREAM_DIR" rev-parse --abbrev-ref HEAD)"
if [ "$UPSTREAM_BRANCH" != "main" ]; then
  echo "Error: upstream clone is on branch '$UPSTREAM_BRANCH', not main."
  echo "The sync copies its working tree, so switch it first:"
  echo "  git -C \"$UPSTREAM_DIR\" checkout main"
  exit 1
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
if [ ! -d "$UPSTREAM_DIR/panel" ] || [ -z "$(ls -A "$UPSTREAM_DIR/panel")" ]; then
  echo "Error: $UPSTREAM_DIR/panel is missing or empty — refusing to mirror it with --delete."
  echo "Check that $UPSTREAM_DIR is really the pavilio repo."
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
echo "Done. panel/, skills/, scripts/ (and commands/ if present) synced from upstream;"
echo "agent commands regenerated for configured agents."
echo ""
echo "Note: AGENTS.md and CLAUDE.md are manually maintained."
echo "Check https://github.com/gmotyl/pavilio for changes and cherry-pick as needed."
