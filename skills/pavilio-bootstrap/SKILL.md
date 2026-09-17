---
name: pavilio-bootstrap
description: Generate `PROJECT.md` (stable resume card), `STATUS.md` (volatile state) and `_index.json` for a project from its existing meeting notes. Use when the user invokes `/pavilio-bootstrap`, when a project has notes but no index, or when rebuilding/migrating after manual edits. Accepts a single project name or "all".
---

# Project Knowledge Bootstrap

Analyze existing meeting notes in a project folder and generate the `PROJECT.md`, `STATUS.md` and `_index.json` files from scratch. The split and the caps are defined once, in [[pavilio-note]] → **PROJECT.md / STATUS.md / DECISIONS.md Update Rules**; this skill produces the same files from history instead of from one meeting.

## When to Use

- When a project has notes but no PROJECT.md or _index.json
- When rebuilding the index after manual edits
- When migrating from old note format to new structured format
- When splitting a legacy all-in-one `PROJECT.md` into card + `STATUS.md`

## Process

1. **Get project name** from user (or process all projects if user says "all")
2. **Scan the projects/project folder** for all `*.md` files (excluding PROJECT.md)
3. **Read and analyze each note** to extract:
   - People mentioned (names, roles, responsibilities)
   - Decisions made
   - Technologies discussed
   - Action items
   - Key topics
4. **Aggregate data** across all notes
5. **Generate PROJECT.md** (resume card — stable facts only) and **STATUS.md** (volatile state — from the most recent notes, within caps)
6. **Generate _index.json** with structured search data
7. **Commit changes**

---

## Scanning Process

For projects/projectname folder:

```
1. List all *.md files in projects/projectname/ (exclude PROJECT.md)
2. Sort by date (from filename YYYY-MM-DD prefix)
3. For each note:
   a. Read the file content
   b. Extract structured sections (TODOs, Action Items, Quick Recap, etc.)
   c. Parse for people names, technologies, decisions
   d. Build entry for index
4. Aggregate all findings
```

---

## Entity Extraction from Existing Notes

When reading existing notes, look for:

### People
- Names in Action Items (e.g., "**Alex:** Continue working on...")
- Names in text (e.g., "Alex reported...", "David raised concerns...")
- Pattern: Names followed by roles or actions
- Greg is always present as Lead/PM

### Decisions
- Notes written with the current template have a `## Decisions` section — take those as-is (they are already `decided` modality)
- In older notes: statements in Quick Recap about what was "decided", "agreed", "chosen"; phrases like "will use", "agreed to", "the team decided"
- **Technology Tradeoffs are observations, not decisions** — promote one only if the note also states it was decided
- Proposals ("we could", "for now", "probably") are not decisions; skip them here

### Technologies
- Mentioned in Technology Tradeoffs section
- Named tools, frameworks, libraries, APIs
- Infrastructure components (Azure, AWS, etc.)

### Topics/Keywords
- Main themes from note title (derived from filename shortname)
- Key terms from Quick Recap bullets
- Section-specific terminology

---

## Output: PROJECT.md (resume card)

Use the **PROJECT.md Template (resume card)** from [[pavilio-note]] verbatim. Only stable facts go in: overview, repositories + working rules, environment gotchas, stack, links. Header line: `> Last updated: [today] · bootstrap (from [N] notes)`.

- **No Team, no Focus, no Open Questions, no Key Decisions table** — those are `STATUS.md` / `DECISIONS.md`
- Hard cap **60 lines**; anything longer belongs in `CONTEXT.md`, an ADR, or a memo
- Working rules and gotchas come from notes *and* from `progress/` files — that is where "never push panel changes to X" and "MCP Y is blocked" get written down

## Output: STATUS.md (volatile)

Use the **STATUS.md Template** from [[pavilio-note]] and apply its caps mechanically:

- **Current Focus:** from the most recent 1–2 notes only — ≤ 5 bullets × ≤ 150 chars, nothing historical
- **Open Questions:** only unresolved — ≤ 8 bullets × ≤ 200 chars, each with owner + date raised
- **Recent Decisions:** last 5 `decided` items, newest first; the full list goes to `DECISIONS.md` (create/append)
- **Team (active):** people seen in the last 60 days — ≤ 12 rows, role + ≤ 80 chars current focus, no dates, no absences. Everyone else only in `_index.json.team`
- No notes index (`_index.json`), no ticket-specific sections

When bootstrapping a project that already has a legacy all-in-one `PROJECT.md`, **move** its Team / Focus / Open Questions / Key Decisions into `STATUS.md` (pruned to caps) rather than regenerating them from scratch, then rewrite `PROJECT.md` as the card. Nothing gets lost: the pruned rows still exist in `_index.json` and the notes.

---

## Output: _index.json

Generate a comprehensive search index:

```json
{
  "project": "[projectname]",
  "last_updated": "[today]",
  "bootstrapped_from_notes": [N],
  "team": {
    "[person_name]": {
      "roles": ["[role1]", "[role2]"],
      "first_seen": "[earliest date]",
      "last_seen": "[most recent date]",
      "context": ["[context 1]", "[context 2]"]
    }
  },
  "decisions": [
    {
      "date": "[date]",
      "decision": "[what]",
      "context": "[why]",
      "note_ref": "[filename]"
    }
  ],
  "technologies": {
    "[tech_name]": {
      "first_mentioned": "[date]",
      "context": ["[usage context]"]
    }
  },
  "notes": [
    {
      "date": "[date]",
      "filename": "[filename]",
      "title": "[human readable title from shortname]",
      "topics": ["[topic1]", "[topic2]"],
      "people_mentioned": ["[person1]", "[person2]"],
      "action_items_count": [N],
      "decisions_made": ["[decision1]"]
    }
  ],
  "search_keywords": {
    "[keyword]": ["[note1.md]", "[note2.md]"]
  }
}
```

---

## Bootstrap All Projects

If user requests "bootstrap all":

```
For each project folder in `projectsDir`:
  1. Check for existing *.md notes
  2. Generate PROJECT.md and _index.json
  3. Report progress
```

---

## User Interaction

After bootstrapping, report:

```
Bootstrap complete for [project]!

Created:
- PROJECT.md (resume card, [N] lines)
- STATUS.md with [N] focus items, [N] open questions, [N] active team members
- DECISIONS.md with [N] decisions
- _index.json with [N] notes indexed

Team members found: [list]
Technologies identified: [list]
Date range: [earliest] to [latest]

Would you like me to commit these changes?
```

---
