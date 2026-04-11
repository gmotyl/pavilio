#!/bin/bash

# Concatenate all .md files from current folder and subfolders
# Usage: ./concatenate-markdown.sh [output-filename]
#
# Examples:
#   ./concatenate-markdown.sh                    # Creates output-YYYYMMDD.txt
#   ./concatenate-markdown.sh project-notes.txt  # Creates project-notes.txt

DATE=$(date +%Y%m%d)
OUTPUT_FILENAME="${1:-output-${DATE}.txt}"

# Validate we're in a directory with markdown files
if ! find . -name "*.md" -type f | grep -q .; then
    echo "Error: No .md files found in current directory or subdirectories"
    exit 1
fi

echo "Concatenating markdown files..."
echo ""

# Create/clear output file
> "$OUTPUT_FILENAME"

# Count files and total size
file_count=0
total_size=0

# Find and process all markdown files, sorted by path
find . -name "*.md" -type f | sort | while read -r file; do
    file_count=$((file_count + 1))

    # Get file size
    file_size=$(wc -c < "$file" 2>/dev/null || echo 0)
    total_size=$((total_size + file_size))

    # Remove leading ./ from path for cleaner output
    relative_path="${file#./}"

    # Write separator and file content
    echo "" >> "$OUTPUT_FILENAME"
    echo "═══════════════════════════════════════════════════════════════" >> "$OUTPUT_FILENAME"
    echo "FILE: $relative_path" >> "$OUTPUT_FILENAME"
    echo "═══════════════════════════════════════════════════════════════" >> "$OUTPUT_FILENAME"
    echo "" >> "$OUTPUT_FILENAME"
    cat "$file" >> "$OUTPUT_FILENAME"
done

# Get final stats
file_count=$(find . -name "*.md" -type f | wc -l)
line_count=$(wc -l < "$OUTPUT_FILENAME")
file_size_h=$(du -h "$OUTPUT_FILENAME" | cut -f1)

echo "✓ Concatenated $file_count markdown files"
echo "✓ Output file: $OUTPUT_FILENAME"
echo "✓ Size: $file_size_h ($line_count lines)"
echo ""
echo "Done!"
