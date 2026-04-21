# Tempo Timesheet Helper

Generate timesheet descriptions by searching project notes. Produces an expanded standup-style overview first, then a condensed table for quick Jira entry.

## Arguments: `$ARGUMENTS`

**Format:**
- Single day: `14.01` = January 14th of current year
- Range: `10-13.02` = February 10th, 11th, 12th, 13th
- Cross-month: `28.01-02.02` = January 28th through February 2nd
- Project filter: append project name, e.g. `16-20.02 my-work`
- Extra instructions: append after dates/project, e.g. `16-20.02 my-work - only standups`

## Instructions

### Step 1: Parse the Date Argument

Parse `$ARGUMENTS` to extract dates and optional project filter:

1. **Single day format**: `DD.MM` (e.g., `14.01`)
2. **Range format**: `DD-DD.MM` (e.g., `10-13.02`)
3. **Cross-month range**: `DD.MM-DD.MM` (e.g., `28.01-02.02`)

If a project name follows the date (e.g., the name of one of your folders under `projectsDir`), only search that project.

Convert to ISO format: `YYYY-MM-DD` for file searching.

### Step 2: Update QMD Index

```bash
qmd update
```

### Step 3: Find Progress Files

**Primary source: progress files** — these contain the richest session-level detail.

```bash
# Find progress files matching date range
find projects/{project}/progress -name "YYYY-MM-DD*.md" -type f | sort
```

If filtering by project, only search that project's `projects/{project}/progress/` directory.
If no project filter, search all subdirectories of `projectsDir` that contain a `progress/` folder.

### Step 4: Supplement with QMD Search

For dates with no progress files, fall back to QMD indexed search:

```bash
qmd search "YYYY-MM-DD" --collection {project}
```

This catches meeting notes, memos, and transcripts that may not have progress files.

### Step 5: Read and Analyze Notes

Read each found progress file. Extract:
- **Main accomplishments** — what was built, fixed, or completed
- **Issues investigated** — bugs found, root causes, solutions applied
- **Key decisions** — architectural choices, design clarifications
- **Status** — what's ready, in progress, or blocked
- **Context** — ticket numbers (e.g., `PROJ-71`), branch names, team interactions

### Step 6: Output — Expanded Overview

For each date, write a **standup-style summary** (2-5 bullet points per day):

```markdown
## Day, Mon DD — High-Level Theme
- **[Feature/Ticket]:** What was done, what issue was found, how it was fixed, current status.
- **[Second item]:** If multiple features worked on same day, separate with bullets.
```

**Style rules:**
- Header: day name + date + brief theme (e.g., "Middleware Fix + Phase 1")
- Each bullet: bold feature name, then narrative with problem/solution/status
- Include ticket numbers (e.g. `PROJ-XX`) when available
- Include key technical details (root cause, fix approach) — not just "fixed a bug"
- Past tense, standup tone
- Skip trivial items (typo fixes, minor reformatting)

### Step 7: Output — Condensed Table

After the expanded overview, output a condensed table for quick Jira tempo entry:

```
| Date | Project | Activity |
|------|---------|----------|
| DD (Day) | project | 1-2 sentence description |
```

**Example:**
```
| Date | Project | Activity |
|------|---------|----------|
| 16 (Mon) | my-work | Fixed carousel CSS specificity issue. Planned new component with 4 style variants. |
| 17 (Tue) | my-work | Debugged middleware integration. Completed Phase 1 (types + server/client components). |
| 18 (Wed) | my-work | Reviewed design spec with team (style-based rendering decision). Cleaned up feature branch history. |
| 19 (Thu) | my-work | Fixed carousel CSS leaking into adjacent component. Resolved icon rendering from nested CMS field. |
| 20 (Fri) | my-work | Implemented modal variant (carousel + tabbed modal, mobile vertical list). Visual polish ongoing. |
```

**Condensed description rules:**
- **1-2 sentences** per day (aim for 30-60 words)
- First sentence = main accomplishment
- Second sentence = secondary work, status, or key detail
- Include enough context to be meaningful (not just "bug fix" — say what was fixed)
- If multiple projects on same day, add separate rows per project
- If no notes found: "No notes found"
- Weekend dates with no notes: skip or mark "Weekend"

## Important Notes

- Use current year unless explicitly specified
- Project column uses the folder name (e.g., "my-work", "my-pet-project", "my-blog")
- Always read the actual progress files — don't guess from filenames alone
- When multiple sessions exist for the same day, combine into one day entry
