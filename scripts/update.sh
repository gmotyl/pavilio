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
git -C "$UPSTREAM_DIR" pull origin main --quiet

echo ""
echo "Syncing panel/..."
rsync -a \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='.DS_Store' \
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
