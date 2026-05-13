#!/bin/bash

# Export project notes + linked-repo source as a single .txt for NotebookLM upload.
# Invoked by the panel's Overview button as:
#   bash export-project-to-notebooklm.sh <project>
# with cwd set to the workspace's projects directory.

set -e

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------

if [ -z "$1" ]; then
    read -p "Project name (or use --project flag): " PROJECT_NAME
else
    PROJECT_NAME="$1"
fi

if [ "$PROJECT_NAME" = "--project" ]; then
    PROJECT_NAME="$2"
fi

if [ -z "$PROJECT_NAME" ] || [ ! -d "$PROJECT_NAME" ]; then
    echo "❌ Project directory not found: $PROJECT_NAME" >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# Output path
# ---------------------------------------------------------------------------

EXPORT_DIR="$PROJECT_NAME/exports"
mkdir -p "$EXPORT_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ISO_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
EXPORT_FILE="$EXPORT_DIR/export-${TIMESTAMP}.txt"

# Truncate / create
: > "$EXPORT_FILE"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Expand a leading ~ in a path using $HOME. Leaves other paths untouched.
expand_tilde() {
    local p="$1"
    case "$p" in
        "~") printf '%s\n' "$HOME" ;;
        "~/"*) printf '%s\n' "$HOME/${p#~/}" ;;
        *) printf '%s\n' "$p" ;;
    esac
}

# Walk a repo with the same filters as scripts/export-codebase.sh and emit
# `=== <rel-path> ===\n<content>\n` blocks for every matching file.
emit_repo_source() {
    local repo_abs="$1"
    (
        cd "$repo_abs" || return 1
        find . -type f \( \
            -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \
            -o -name "*.vue" -o -name "*.svelte" \
            -o -name "*.py" -o -name "*.rb" -o -name "*.go" -o -name "*.rs" \
            -o -name "*.java" -o -name "*.kt" -o -name "*.scala" \
            -o -name "*.css" -o -name "*.scss" -o -name "*.less" \
            -o -name "*.html" -o -name "*.erb" \
            -o -name "*.php" -o -name "*.c" -o -name "*.cpp" -o -name "*.h" \
            -o -name "*.swift" -o -name "*.m" \
            -o -name "*.sh" -o -name "*.yaml" -o -name "*.yml" \
        \) \
            ! -path "*/node_modules/*" \
            ! -path "*/.git/*" \
            ! -path "*/dist/*" \
            ! -path "*/build/*" \
            ! -path "*/.nuxt/*" \
            ! -path "*/.next/*" \
            ! -path "*/.output/*" \
            ! -path "*/coverage/*" \
            ! -path "*/.turbo/*" \
            ! -path "*/__pycache__/*" \
            ! -path "*/venv/*" \
            ! -path "*/.venv/*" \
            ! -path "*/vendor/*" \
            ! -path "*/target/*" \
            ! -path "*/*api-client/*" \
            ! -path "*/__tests__/*" \
            ! -path "*/__mocks__/*" \
            ! -path "*/test/*" \
            ! -path "*/tests/*" \
            ! -path "*/*.test.*" \
            ! -path "*/*.spec.*" \
            ! -name "*.d.ts" \
            ! -name "*.min.js" \
            ! -name "*.min.css" \
            ! -name "*.map" \
            ! -name "*.lock" \
            ! -name "package-lock.json" \
            ! -name "yarn.lock" \
            ! -name "pnpm-lock.yaml" \
            2>/dev/null | sort | while IFS= read -r file; do
                rel="${file#./}"
                printf '=== %s ===\n' "$rel"
                cat "$file" 2>/dev/null || true
                printf '\n'
            done
    )
}

# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------

{
    printf '# Project Export for NotebookLM: %s\n' "$PROJECT_NAME"
    printf '\n'
    printf 'This file is a single-source dump intended for upload to a NotebookLM notebook.\n'
    printf 'It contains the project'\''s notes summary followed by the source code of every\n'
    printf 'linked repository (with common build/vendor/test paths excluded).\n'
    printf '\n'
    printf 'Generated: %s\n' "$ISO_TIMESTAMP"
    printf '\n'
    printf -- '----------------------------------------\n'
    printf '\n'
} >> "$EXPORT_FILE"

# ---------------------------------------------------------------------------
# Section 1 — Notes summary
# ---------------------------------------------------------------------------

{
    printf '## Notes Summary\n'
    printf '\n'
} >> "$EXPORT_FILE"

if [ -f "$PROJECT_NAME/PROJECT.md" ]; then
    {
        printf '### PROJECT.md\n'
        printf '\n'
        cat "$PROJECT_NAME/PROJECT.md"
        printf '\n\n'
    } >> "$EXPORT_FILE"
fi

if [ -f "$PROJECT_NAME/DECISIONS.md" ]; then
    {
        printf '### DECISIONS.md\n'
        printf '\n'
        cat "$PROJECT_NAME/DECISIONS.md"
        printf '\n\n'
    } >> "$EXPORT_FILE"
fi

if [ -f "$PROJECT_NAME/.agent/config.json" ]; then
    {
        printf '### Agent Configuration\n'
        printf '\n'
        printf '```json\n'
        cat "$PROJECT_NAME/.agent/config.json"
        printf '\n```\n\n'
    } >> "$EXPORT_FILE"
fi

if [ -d "$PROJECT_NAME/progress" ]; then
    shopt -s nullglob
    progress_files=("$PROJECT_NAME/progress"/*.md)
    shopt -u nullglob
    if [ "${#progress_files[@]}" -gt 0 ]; then
        for file in "${progress_files[@]}"; do
            [ -f "$file" ] || continue
            {
                printf '### progress/%s\n' "$(basename "$file")"
                printf '\n'
                cat "$file"
                printf '\n\n'
            } >> "$EXPORT_FILE"
        done
    fi
fi

# ---------------------------------------------------------------------------
# Section 2 — Source code from linked repos
# ---------------------------------------------------------------------------

REPOS_JSON="$PROJECT_NAME/repos.json"

if [ -f "$REPOS_JSON" ]; then
    REPO_COUNT="$(jq 'length' "$REPOS_JSON")"
    if [ "$REPO_COUNT" -gt 0 ]; then
        {
            printf '## Source Code\n'
            printf '\n'
        } >> "$EXPORT_FILE"

        # Iterate entries. Each line: <name>\t<path>
        jq -r '.[] | [(.name // ""), (.path // "")] | @tsv' "$REPOS_JSON" \
        | while IFS=$'\t' read -r repo_name repo_path; do
            [ -n "$repo_path" ] || continue

            resolved="$(expand_tilde "$repo_path")"
            display_name="${repo_name:-$(basename "$resolved")}"

            {
                printf '### Repo: %s\n' "$display_name"
                printf '\n'
            } >> "$EXPORT_FILE"

            if [ ! -d "$resolved" ]; then
                {
                    printf '_(repo path not found: %s)_\n\n' "$resolved"
                } >> "$EXPORT_FILE"
                continue
            fi

            emit_repo_source "$resolved" >> "$EXPORT_FILE"
            printf '\n' >> "$EXPORT_FILE"
        done
    fi
fi

# ---------------------------------------------------------------------------
# Footer — keep this exact format; panel matches `✅ Export created: (.+)`
# ---------------------------------------------------------------------------

echo "✅ Export created: $EXPORT_FILE"
