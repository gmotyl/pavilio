#!/bin/bash

# Export codebase to text files for AI tools (Google AI Studio, NotebookLM, etc.)
# Auto-splits into <500KB chunks if needed
#
# Usage: ./export-codebase.sh [output-name] [directory]
#
# Examples:
#   ./export-codebase.sh                    # exports current dir
#   ./export-codebase.sh myproject          # custom output name
#   ./export-codebase.sh myproject /path    # specific directory

OUTPUT_NAME="${1:-codebase}"
TARGET_DIR="${2:-.}"
DATE=$(date +%Y%m%d)
MAX_SIZE_KB=380  # Conservative limit to stay under 500KB after headers

cd "$TARGET_DIR" || exit 1

# Create temp directory for processing
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Find all relevant files, excluding common noise
find_files() {
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
    2>/dev/null
}

# Get list of files sorted by directory for logical grouping
FILES=$(find_files | sort)
TOTAL_FILES=$(echo "$FILES" | grep -c .)

if [ "$TOTAL_FILES" -eq 0 ]; then
    echo "No source files found in $TARGET_DIR"
    exit 1
fi

echo "Found $TOTAL_FILES source files"

# Calculate total size
TOTAL_SIZE=0
while IFS= read -r file; do
    SIZE=$(wc -c < "$file" 2>/dev/null || echo 0)
    TOTAL_SIZE=$((TOTAL_SIZE + SIZE))
done <<< "$FILES"

TOTAL_SIZE_KB=$((TOTAL_SIZE / 1024))
echo "Total size: ${TOTAL_SIZE_KB}KB"

# Function to write files to output
write_chunk() {
    local chunk_file="$1"
    local files_list="$2"

    while IFS= read -r file; do
        [ -z "$file" ] && continue
        echo "=== $file ==="
        cat "$file" 2>/dev/null
        echo ""
    done <<< "$files_list" > "$chunk_file"
}

# If small enough, output single file
if [ "$TOTAL_SIZE_KB" -le "$MAX_SIZE_KB" ]; then
    OUTPUT="${OUTPUT_NAME}-${DATE}.txt"
    write_chunk "$OUTPUT" "$FILES"
    SIZE=$(du -h "$OUTPUT" | cut -f1)
    LINES=$(wc -l < "$OUTPUT")
    echo "Created $OUTPUT ($LINES lines, $SIZE)"
    exit 0
fi

# Otherwise, split by top-level directories first
echo "Splitting into chunks (max ${MAX_SIZE_KB}KB each)..."

# Get unique top-level directories
TOP_DIRS=$(echo "$FILES" | sed 's|^\./||' | cut -d'/' -f1 | sort -u)

CHUNK_NUM=1
CURRENT_CHUNK=""
CURRENT_SIZE=0

write_current_chunk() {
    if [ -n "$CURRENT_CHUNK" ]; then
        OUTPUT="${OUTPUT_NAME}-part${CHUNK_NUM}-${DATE}.txt"
        write_chunk "$OUTPUT" "$CURRENT_CHUNK"
        SIZE=$(du -h "$OUTPUT" | cut -f1)
        LINES=$(wc -l < "$OUTPUT")
        echo "  Created $OUTPUT ($LINES lines, $SIZE)"
        CHUNK_NUM=$((CHUNK_NUM + 1))
        CURRENT_CHUNK=""
        CURRENT_SIZE=0
    fi
}

# Process files, grouping by directory when possible
while IFS= read -r file; do
    [ -z "$file" ] && continue

    FILE_SIZE=$(wc -c < "$file" 2>/dev/null || echo 0)
    # Add ~100 bytes overhead for "=== filename ===" header per file
    FILE_SIZE=$((FILE_SIZE + 100))
    FILE_SIZE_KB=$(( (FILE_SIZE + 1023) / 1024 ))  # Round up

    # If single file is too large, skip it with warning
    if [ "$FILE_SIZE_KB" -gt "$MAX_SIZE_KB" ]; then
        echo "  Warning: Skipping large file ($FILE_SIZE_KB KB): $file"
        continue
    fi

    # If adding this file would exceed limit, write current chunk first
    if [ $((CURRENT_SIZE + FILE_SIZE_KB)) -gt "$MAX_SIZE_KB" ] && [ -n "$CURRENT_CHUNK" ]; then
        write_current_chunk
    fi

    # Add file to current chunk
    if [ -n "$CURRENT_CHUNK" ]; then
        CURRENT_CHUNK="$CURRENT_CHUNK"$'\n'"$file"
    else
        CURRENT_CHUNK="$file"
    fi
    CURRENT_SIZE=$((CURRENT_SIZE + FILE_SIZE_KB))

done <<< "$FILES"

# Write final chunk
write_current_chunk

echo ""
echo "Done! Created $((CHUNK_NUM - 1)) files for upload."
