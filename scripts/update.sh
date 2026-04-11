#!/bin/bash
set -e

UPSTREAM_REMOTE="${1:-upstream}"

echo "Pulling updates from motyl-ai-workflow upstream ($UPSTREAM_REMOTE)..."
echo ""

git subtree pull --prefix panel "$UPSTREAM_REMOTE" main --squash
git subtree pull --prefix commands "$UPSTREAM_REMOTE" main --squash
git subtree pull --prefix scripts "$UPSTREAM_REMOTE" main --squash

echo ""
echo "Done. panel/, commands/, scripts/ updated from upstream."
echo ""
echo "Note: AGENTS.md and CLAUDE.md are manually maintained."
echo "Check https://github.com/gmotyl/motyl-ai-workflow for changes and cherry-pick as needed."
