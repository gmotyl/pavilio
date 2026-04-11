#!/bin/bash
set -e

# Resolve upstream local clone directory
# Default: sibling directory named motyl-ai-workflow
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
UPSTREAM_DIR="${1:-"$SCRIPT_DIR/../../motyl-ai-workflow"}"

if [ ! -d "$UPSTREAM_DIR/.git" ]; then
  echo "Error: upstream repo not found at $UPSTREAM_DIR"
  echo "Usage: $0 [/path/to/motyl-ai-workflow]"
  echo ""
  echo "Clone it first: git clone git@github.com:gmotyl/motyl-ai-workflow.git"
  exit 1
fi

REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Pulling latest from upstream at $UPSTREAM_DIR..."
git -C "$UPSTREAM_DIR" pull origin main --quiet

echo ""
echo "Syncing panel/..."
rsync -a --delete \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='.DS_Store' \
  "$UPSTREAM_DIR/panel/" "$REPO_ROOT/panel/"

echo "Syncing commands/..."
rsync -a --delete \
  --exclude='.DS_Store' \
  "$UPSTREAM_DIR/commands/" "$REPO_ROOT/commands/"

echo "Syncing scripts/..."
rsync -a --delete \
  --exclude='.DS_Store' \
  "$UPSTREAM_DIR/scripts/" "$REPO_ROOT/scripts/"

echo ""
echo "Done. panel/, commands/, scripts/ synced from upstream."
echo ""
echo "Note: AGENTS.md and CLAUDE.md are manually maintained."
echo "Check https://github.com/gmotyl/motyl-ai-workflow for changes and cherry-pick as needed."
