#!/usr/bin/env bash
# Reconcile QMD collections against the workspace's projects, then refresh the index.
#
# Idempotent and cheap enough to run on every search: indexing is hash-incremental
# (~0.7s for 35 files) and embedding is local (~5s for 67 chunks, no API). That is
# deliberate — a stale semantic index fails by silently returning nothing.
#
# Usage: qmd-ensure.sh [--projects-dir DIR] [--config FILE] [--dry-run] [--include-archived]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECTS_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)/projects"
CONFIG="${QMD_INDEX_YML:-$HOME/.config/qmd/index.yml}"
DRY_RUN=0
INCLUDE_ARCHIVED=0
REPOINT_DEAD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --projects-dir) PROJECTS_DIR="$2"; shift 2 ;;
    --config) CONFIG="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --include-archived) INCLUDE_ARCHIVED=1; shift ;;
    --repoint-dead) REPOINT_DEAD=1; shift ;;
    -h|--help) sed -n '2,8p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -d "$PROJECTS_DIR" ]] || { echo "projects dir not found: $PROJECTS_DIR" >&2; exit 1; }

# index.yml is machine-written with a fixed two-space shape, so grep/awk is enough
# and avoids a YAML dependency. A collection name is a 2-space-indented key.
collection_names() {
  [[ -f "$CONFIG" ]] || return 0
  awk '/^  [A-Za-z0-9_-]+:$/ { gsub(/[ :]/, ""); print }' "$CONFIG"
}

collection_path() { # name
  [[ -f "$CONFIG" ]] || return 0
  awk -v want="  $1:" '
    $0 == want { found = 1; next }
    found && /^    path: / { sub(/^    path: /, ""); print; exit }
    found && /^  [A-Za-z0-9_-]+:$/ { exit }
  ' "$CONFIG"
}

has_collection() { # name
  collection_names | grep -qx "$1"
}

# Every directory holding a PROJECT.md is a project. Deliberately not read from
# .projects.local.md, which is gitignored and so may not exist at all.
discover() { # parent dir
  local parent="$1" dir name
  for dir in "$parent"/*/; do
    [[ -d "$dir" ]] || continue
    name="$(basename "$dir")"
    [[ "$name" == "archived" ]] && continue
    [[ -f "${dir}PROJECT.md" ]] || continue
    echo "$name ${dir%/}"
  done
}

TO_ADD=()

collect() { # parent dir
  local name dir
  while read -r name dir; do
    [[ -n "$name" ]] || continue
    if has_collection "$name"; then
      echo "ok: $name"
    else
      echo "add: $name $dir"
      TO_ADD+=("$name|$dir")
    fi
  done < <(discover "$1")
}

collect "$PROJECTS_DIR"

if [[ $INCLUDE_ARCHIVED -eq 1 && -d "$PROJECTS_DIR/archived" ]]; then
  collect "$PROJECTS_DIR/archived"
fi

# A collection whose path no longer exists is not harmless: `qmd update` crashes on it
# (ENOENT) and aborts the whole run, so every collection after it alphabetically is left
# stale. Verified against the real workspace — `ch` killed the run at [2/14] and the other
# 12 never updated. So dead collections must be resolved before update, not just reported.
DEAD=()
for name in $(collection_names); do
  path="$(collection_path "$name")"
  if [[ -n "$path" && ! -d "$path" ]]; then
    echo "dead: $name $path (path missing — qmd update will crash on this)"
    DEAD+=("$name|$path")
  fi
done

if [[ $DRY_RUN -eq 1 ]]; then
  echo "plan-only (dry run): nothing changed, no qmd invoked"
  exit 0
fi

# Repointing is opt-in because it means indexing archived material, which CLAUDE.md says
# to ask about first. It is non-destructive and reversible — the alternative,
# `qmd collection remove`, deletes that collection's indexed documents.
if [[ ${#DEAD[@]} -gt 0 && $REPOINT_DEAD -eq 1 ]]; then
  for entry in "${DEAD[@]}"; do
    name="${entry%%|*}"
    if [[ -d "$PROJECTS_DIR/archived/$name" ]]; then
      # Rewrite only the path line belonging to this collection.
      awk -v want="  $name:" -v new="    path: $PROJECTS_DIR/archived/$name" '
        $0 == want { print; found = 1; next }
        found && /^    path: / { print new; found = 0; next }
        { print }
      ' "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"
      echo "repointed: $name -> $PROJECTS_DIR/archived/$name"
    else
      echo "unfixable: $name (no archived/$name to repoint at) — remove it with: qmd collection remove $name" >&2
      exit 3
    fi
  done
elif [[ ${#DEAD[@]} -gt 0 ]]; then
  echo "" >&2
  echo "Refusing to run qmd update: the dead collections above would crash it and leave" >&2
  echo "every later collection stale. Pick one:" >&2
  echo "  --repoint-dead                 point them at projects/archived/<name> (keeps their documents)" >&2
  echo "  qmd collection remove <name>   drop them (deletes those indexed documents)" >&2
  exit 3
fi

# macOS ships bash 3.2, where `set -u` plus a bare "${arr[@]}" errors on an empty
# array. The ${arr[@]+...} guard is required, not decoration.
for entry in ${TO_ADD[@]+"${TO_ADD[@]}"}; do
  name="${entry%%|*}"
  dir="${entry#*|}"
  qmd collection add "$dir" --name "$name" --mask '**/*.md'
done

qmd update
qmd embed
