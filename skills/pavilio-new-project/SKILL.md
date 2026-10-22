---
name: pavilio-new-project
description: Create a project or build its resume card from what is on disk — no folder → scaffold an empty project with `scripts/project new`; a folder with meeting notes but no `PROJECT.md` → scaffold the missing skeleton, then generate `PROJECT.md` (stable resume card), `STATUS.md` (volatile state), `DECISIONS.md` and `_index.json` from the notes; a project that already has a card → ask before rebuilding it (including the legacy all-in-one split). Use when the user invokes `/pavilio-new-project <name> [--research]`, asks to "create a new project", or when a project has notes but no index.
---

# Pavilio New Project

Follows what is on disk. The skeleton always comes from the project scaffold
(`scripts/project new`, the same for every entry point); the card comes from the notes. The split
and the caps of the generated files are defined once, in [[pavilio-note]] → **PROJECT.md /
STATUS.md / DECISIONS.md Update Rules**; this skill produces the same files from history instead of
from one meeting.

## Usage

```
/pavilio-new-project <name> [--research]
```

`<name>` must be a slug (`[a-z0-9][a-z0-9._-]*`) — propose one when the user gives a title.
`--research` creates a `kind: research` project and needs a topic: take it from the user's words or
ask for it (one question).

`scripts/project new <name> [--kind research --topic "<topic>"]` runs from the workspace root and
prints one JSON object; exit 0 ok (`created` lists the paths written), 1 error, 2 ask the user
(`reason`: `exists` or `archived`). It never rewrites an existing file and also adds the local
`.projects.local.md` registry row.

## Process

1. **Look at `projects/<name>/`.**
   - **No folder** → `scripts/project new <name>` (with `--kind research --topic "…"` for
     `--research`). Report what it created; done — there are no notes to read.
   - **Folder with notes, no `PROJECT.md`** → `scripts/project new <name>` scaffolds only the
     missing parts. Then continue with step 2 to generate the card from the notes.
   - **`PROJECT.md` exists** → the script exits 2 `exists`. Ask: **A) rebuild from notes**
     (including the legacy all-in-one split, see **Output: STATUS.md**) or **B) stop**. Write
     nothing until answered. A) → step 2 without rerunning the script; B) → done.
   - **Exit 2 `archived`** → the name is taken under `projects/archived/`. Ask whether to pick
     another name or restore the archived project by hand; write nothing until answered.
2. **Orient on the glossary.** Read `projects/<p>/CONTEXT.md` (the glossary) so names and terms match it; with `projects/<p>/wiki/`, walk the reading ladder (`skills/pavilio-wiki/CONVENTIONS.md § Reading ladder` — `overview.md` and the repository/person entity pages are the usual stops) for stable facts the notes leave implicit. No `wiki/` → `CONTEXT.md` whole. This skill never writes `CONTEXT.md` or wiki pages (the scaffold's empty `wiki/` skeleton aside).
3. **Scan the projects/project folder** for all `*.md` notes (excluding PROJECT.md, STATUS.md, DECISIONS.md)
4. **Read and analyze each note** to extract:
   - People mentioned (names, roles, responsibilities)
   - Decisions made
   - Technologies discussed
   - Action items
   - Key topics
5. **Aggregate data** across all notes
6. **Generate PROJECT.md** (resume card — stable facts only), **STATUS.md** (volatile state — from the most recent notes, within caps) and **DECISIONS.md**; they replace the scaffold's empty templates
7. **Generate _index.json** with structured search data
8. **Commit** `projects/<p>/` — never `.projects.local.md` (local, gitignored)

---

## Scanning Process

For projects/projectname folder:

```
1. List all *.md files in projects/projectname/ (exclude PROJECT.md, STATUS.md, DECISIONS.md)
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

Use the **PROJECT.md Template (resume card)** from [[pavilio-note]] verbatim. Only stable facts go in: overview, repositories + working rules, environment gotchas, stack, links. Header line: `> Last updated: [today] · pavilio-new-project (from [N] notes)`.

- **No Team, no Focus, no Open Questions, no Key Decisions table** — those are `STATUS.md` / `DECISIONS.md`
- Hard cap **60 lines**; anything longer belongs in the wiki (via [[pavilio-wiki]] ingest), an ADR, or a memo — `CONTEXT.md` is a one-line glossary
- Working rules and gotchas come from notes *and* from `progress/` files — that is where "never push panel changes to X" and "MCP Y is blocked" get written down

## Output: STATUS.md (volatile)

Use the **STATUS.md Template** from [[pavilio-note]] and apply its caps mechanically:

- **Current Focus:** from the most recent 1–2 notes only — ≤ 5 bullets × ≤ 150 chars, nothing historical
- **Open Questions:** only unresolved — ≤ 8 bullets × ≤ 200 chars, each with owner + date raised
- **Recent Decisions:** last 5 `decided` items, newest first; the full list goes to `DECISIONS.md` (create/append)
- **Team (active):** people seen in the last 60 days — ≤ 12 rows, role + ≤ 80 chars current focus, no dates, no absences. Everyone else only in `_index.json.team`
- No notes index (`_index.json`), no ticket-specific sections

When rebuilding a project that already has a legacy all-in-one `PROJECT.md`, **move** its Team / Focus / Open Questions / Key Decisions into `STATUS.md` (pruned to caps) rather than regenerating them from scratch, then rewrite `PROJECT.md` as the card. Nothing gets lost: the pruned rows still exist in `_index.json` and the notes.

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

## User Interaction

After generating, report:

```
Project card built for [project]!

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
