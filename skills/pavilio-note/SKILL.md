---
name: pavilio-note
description: Process a meeting transcript into structured project notes, refresh STATUS.md / DECISIONS.md / _index.json (and PROJECT.md only when a stable fact changed), and propose Todoist follow-ups. Use when the user invokes `/pavilio-note`, says "process the transcript", or references a meeting name to pull from Quill/Fathom. Polish content with English section headers; verbatim transcript is preserved.
---

# Meeting Processing

Analyze a meeting transcript, create structured notes, and maintain project knowledge.

**Language Rule:** All generated notes, summaries, action items, section content, and descriptions MUST be written in Polish. Section headers in markdown files stay in English (for template consistency), but all content underneath them must be in Polish. The transcript file remains verbatim (original language).

The user will provide the transcript. Your process is:

## Core Processing Steps

**Path anchor (read first):** every path below is relative to the **workspace repo root** (`git rev-parse --show-toplevel`). The repo is itself named `projects` and project folders live in its `projects/` subdirectory, so a project's notes dir is `<root>/projects/<projectname>/notes/` and transcripts go in `<root>/projects/<projectname>/notes/log/`. There is **no** `projects/<projectname>/projects/` — that layout is retired; never write there. Resolve `projectname` against `.projects.local.md` and confirm `projects/<projectname>/` exists before writing anything.

1. **Check for `-yolo` flag** in input - if present, enable auto-accept mode (skip confirmations and participant confirmation)
2. First get `projectname` from the user.
3. **Select Transcript Source**:
   - Ask user: "How would you like to provide the transcript?"
   - Read the global registry at `projects/.processed_transcripts.json` (create empty `{ "processed": [] }` if missing) — see **Processed Transcripts Registry Rules**
   - Fetch the last 10 meeting titles from Quill MCP, filter out any whose `meeting_id` (or `source_id`) is already in the registry, and present the first 5 unprocessed ones as a numbered list (include meeting date and time converted to local timezone Europe/Warsaw). Offer manual paste or cancel as additional options.
   - If Quill MCP: Call quill MCP to get the transcript
   - If Manual: Ask user to paste transcript
   - Fall back to Manual if Quill MCP is unavailable or has no unprocessed meetings
   - **Note**: same filtering logic applies to any other transcript-providing MCP (Fathom, etc.) — always check the registry before listing
4. **Check for known participants** (see **Participant Recognition Rules** below):
   - Read `projects/projectname/_index.json`, `projects/projectname/PROJECT.md` and `projects/projectname/STATUS.md` if they exist
   - Check if this project has a `known_participants` list in `_index.json`
   - If known participants exist, use them to map "Speaker 1/2/3" to real names
5. **Confirm participants with user**:
   - Show the user a list of participants you've identified from the transcript
   - Ask: "I identified these participants: [list]. Is this correct? If not, you can paste the meeting invite participant list from Teams/calendar."
   - If user provides a participant list, parse it and update the `known_participants` in `_index.json`
6. Read the transcript to determine its main topic.
7. Generate a `shortname`. This must be a 4-word (or less) string in `snake_case` that summarizes the topic.
8. **Extract entities** from the transcript (see **Entity Extraction Guidelines**), keeping four things apart that transcripts blur together:
   - **Decisions** — only what was actually *decided*. Anything "proposed", "we could", "let's think about", "probably" is a **proposal**, not a decision (see **Modality**).
   - **Proposals / tentative agreements** — with their modality preserved.
   - **Open questions / blockers** — unresolved, with who raised them.
   - **Action items** — with evidence: owner, commitment wording, deadline, transcript anchor (see **Action evidence**).
   - Plus: people (names, roles), technologies as *observations*, and **uncertain ASR terms** (see **ASR flags**).
9. Generate a temporary `json` as described below, by deep analyzing and processing provided transcript.
   - **9a. Topic-coverage check.** List every discussion thread of substance (rule of thumb: ≥ 6 speaker turns, or ≥ 2 minutes when the transcript has timestamps). Each thread MUST land in at least one of: Decisions, Proposals, Open Questions, Action Items, Detailed Summary. A thread with no home goes into Detailed Summary — long threads are never silently dropped because they ended without a decision.
   - **9b. Contradiction check** (summary ↔ actions ↔ transcript). Before writing: every TODO / Action Item traces to a passage in the transcript; nothing is "decided" in Quick Recap while "proposed" in Proposals; the owner of an action is the person who committed in the transcript, not the person who suggested it; Quick Recap claims are not contradicted by Detailed Summary. Fix the note, not the transcript.
10. Your final output **MUST** include these files:
    1. `projects/projectname/notes/[datetime]_[shortname].md` - Detailed Summary formatted as described in **Detailed Summary Formatting Rules**
    2. `projects/projectname/notes/log/[datetime]_transcript_shortname.txt` - plain 1:1 transcript
    3. **Replace** `projects/projectname/STATUS.md` (volatile state: focus, open questions, recent decisions, active team) and **append** decided items to `projects/projectname/DECISIONS.md` — see **PROJECT.md / STATUS.md / DECISIONS.md Update Rules**. Touch `PROJECT.md` **only** if a stable fact changed (new repo, new environment gotcha, changed overview).
    4. **Update** `projects/projectname/_index.json` - See **Index Update Rules** (including `known_participants` if updated)
    5. **Update** `projects/.processed_transcripts.json` — record this transcript as processed (skip if source was manual paste with no MCP id). See **Processed Transcripts Registry Rules**

    **Pre-write assertion:** before writing files 1–2, both target paths MUST match `projects/<projectname>/notes/**` (the `.md` directly in `notes/`, the `.txt` in `notes/log/`) and `projects/<projectname>/` MUST already exist. If either check fails, stop and report the offending path — do not create a new directory to make it fit.
    **Post-write check:** after step 10 confirm that the note `.md`, the `log/*.txt`, `STATUS.md`, `_index.json` and (when applicable) the registry entry's `note_ref` all exist on disk and point at `projects/<projectname>/notes/...`, **and** that `STATUS.md` respects the **caps** (see Update Rules — count the rows/bullets, do not eyeball). In `-yolo`/batch mode a failed check is a `status: error` result, not a silent success.
11. Display numbered list of tasks for Greg, ask which numbers user wants to add to Todoist.
12. Wait for user input with task numbers.
13. Add selected tasks to Todoist using MCP. Task should have "[projectname]" prefix followed by short title and a bit longer description and should be for today.
14. Ask if user wants to add any other tasks to Todoist. Add them to Todoist using MCP.
15. commit and push changes

---

### Manual Paste Workflow

**Process:**

1. Ask user: "Please paste the transcript below (you can paste raw text or formatted meeting notes):"
2. Accept multiline input until user signals end (empty line or special marker)
3. Validate that transcript has content (not empty)
4. Return transcript text

**Accepted Formats:**

- Raw transcript: Speaker names followed by colon and speech
- Meeting notes: Any text format is accepted
- Multiple paragraphs: Preserved as-is

**Example:**

```
Greg: Good morning, let's discuss the quarterly roadmap.
Yasir: I think we should focus on infrastructure first.
Greg: Agreed. Let's start with the API redesign.
```

---

### Fallback Logic

If Quill MCP is selected but fails:

```
Error: Quill MCP server is unavailable.
Would you like to paste the transcript manually instead? [Y/n]
→ If yes: Prompt for manual paste
→ If no: Exit with error
```

---

### Temporary JSON Format

```json
{
  "shortname": "api_design_review_discussion",
  "plain_text": "The plain text 1:1 provided transcript",
  "summary": "The summary of the meeting as described below",
  "extracted_entities": {
    "people": [
      {
        "name": "Alex",
        "role": "Frontend Developer",
        "context": "Working on checkout component"
      }
    ],
    "decisions": [
      {
        "decision": "Use custom API methods instead of modifying unified API",
        "date": "2025-12-09",
        "modality": "decided",
        "anchor": "[00:14:20] Greg",
        "context": "API strategy discussion"
      }
    ],
    "proposals": [
      {
        "proposal": "Move the footer into its own package",
        "modality": "tentatively agreed",
        "raised_by": "Alex",
        "anchor": "[00:31:05]",
        "context": "Deferred until the checkout refactor lands"
      }
    ],
    "open_questions": [
      {
        "question": "Who owns the Azure tenant for staging?",
        "raised_by": "Greg",
        "anchor": "[00:40:12]"
      }
    ],
    "technologies": ["React", "Next.js", "Postgres"],
    "blockers": ["Azure authentication issues"],
    "action_items": [
      {
        "assignee": "Alex",
        "task": "Create PR for footer component",
        "deadline": "today",
        "commitment": "\"zrobię tego PR-a jeszcze dziś\"",
        "anchor": "[00:52:40]"
      }
    ],
    "asr_flags": [
      { "heard": "Kafka topics stage / stejdż", "likely": "stage", "anchor": "[00:22:10]" }
    ]
  }
}
```

**Modality** — one of `decided`, `tentatively agreed`, `proposed`. Only `decided` items go to Decisions, `DECISIONS.md` and `_index.json.decisions`. "We decided", "agreed, do it", "final" → decided. "Let's go with X for now", "probably X" → tentatively agreed. "We could", "what if", "I'd suggest" → proposed. When in doubt, downgrade — a proposal recorded as a decision is the costlier mistake.

**Action evidence** — an action item is only an action item if someone committed to it. Record: owner (the person who committed, or `unassigned`), the commitment wording (a short quote, ≤ 12 words, original language), deadline (`none stated` when none), and an **anchor**.

**Anchor** — `[hh:mm:ss]` from the transcript when it carries timestamps; otherwise the speaker name plus a ≤ 8-word quote (`Greg: "to zróbmy jeszcze dziś"`). Anchors are required on decisions, action items, and any claim two people disputed; optional elsewhere.

**ASR flags** — speech-to-text garbles names, product names, acronyms and code-switched words. Never silently "fix" them in the summary. Where the intended term is obvious, use it and list the garble under `asr_flags`; where it is not, keep the heard form in quotes with `(ASR?)`. The transcript file stays verbatim either way.

---

### **Detailed Summary Formatting Rules**

The value of the `"summary"` key in the JSON must be a string that strictly follows this markdown format:

## TODOs for You

[Action items specifically assigned to or mentioned for the current user, same evidence format as Action Items. If none, write "None identified"]

## Action Items

- **[Owner]** — [task] — termin: [deadline | none stated] · powiedział: "[commitment quote]" · [anchor]

[One line per item. Owner = who committed. `unassigned` when nobody did — that is a finding, not a gap to fill by guessing.]

## Decisions

- [anchor] **[decision]** — [who / why, one clause]

[Only `decided` modality. Empty → write "Brak decyzji na tym spotkaniu" — do not promote a proposal to fill the section.]

## Proposals & tentative agreements

- (proposed | tentatively agreed) **[proposal]** — [raised by, what would make it a decision] · [anchor]

## Open Questions

- **[question]** — [raised by, blocked on whom/what] · [anchor]

## Quick Recap

- [3-5 bullet points capturing key outcomes and highlights]
- [Each point one clear sentence; use the same modality word as the section it summarizes]

## Missing parts

- [0-5 bullets: important related topics that were NOT discussed]

## Follow-up questions

- [1-3 bullets: questions to ask at the next meeting]

## Technology tradeoffs

- [0-3 bullets: technology options and tradeoffs that were *discussed*. These are observations — tag `(decided)` only if the same item appears under Decisions, otherwise `(open)`]

## Uncertain terms (ASR)

- "[heard]" → prawdopodobnie [likely] · [anchor]

[Only if any; omit the section when the transcript is clean.]

## Detailed Summary

[2-4 paragraphs of context and elaboration. Every thread from the topic-coverage check that has no home above lands here. Anchor disputed claims: `[anchor]`.]

## Transcript

[`[datetime]_transcript_shortname.txt`](./log/[datetime]_transcript_shortname.txt)

Sections `Proposals`, `Open Questions`, `Missing parts`, `Follow-up questions`, `Technology tradeoffs`, `Uncertain terms` may be omitted when empty. `TODOs`, `Action Items`, `Decisions`, `Quick Recap`, `Detailed Summary`, `Transcript` are always present.

---

### **PROJECT.md / STATUS.md / DECISIONS.md Update Rules**

Project knowledge is split by **volatility**, because `PROJECT.md` is read in full on every session resume and must stay cheap:

| File | Holds | Changes | Written by |
|---|---|---|---|
| `PROJECT.md` | the **resume card** — what the project *is* and how to *work* on it: overview, repos + working rules, environment gotchas, stack, links | rarely | bootstrap; pavilio-note only when a stable fact changed; humans |
| `STATUS.md` | the **volatile state** — current focus, open questions, recent decisions, active team | every meeting | pavilio-note (**replace**, never append) |
| `DECISIONS.md` | full decision history, append-only | when something is decided | pavilio-note (append) |

**PROJECT.md** — touch only when the meeting changed a stable fact (new repository, new environment blocker that will outlive the week, changed project scope). Bump `Last updated` when you do. Never put Team, Focus or Open Questions in it. Hard cap **60 lines**; if the card outgrows that, the surplus belongs in `CONTEXT.md`, an ADR, or a memo.

**STATUS.md** — rewrite from scratch every meeting: read the previous `STATUS.md`, carry forward only what is still true, then apply the **caps**:

- **Current Focus:** ≤ 5 bullets, ≤ 150 chars each. Items from THIS meeting first; a carried-over item survives only if the transcript touched it or it has a future date.
- **Open Questions:** ≤ 8 bullets, ≤ 200 chars each, every one with **owner** (or `nikt`) and **date raised** (`dd.mm`). Drop anything resolved, anything older than 30 days with no owner (an ownerless question nobody repeated in a month is dead), anything about absences/holidays.
- **Recent Decisions:** last 5 `decided` items, newest first, one line each with date + note ref. Older ones live in `DECISIONS.md`.
- **Team (active):** ≤ 12 people — those seen in the last 60 days per `_index.json.team[*].last_seen` (two months covers a holiday gap in a recurring series). Role + ≤ 80 chars of *current* focus. **No dates, no diary lines, no absences.** Everyone else stays in `_index.json` only.
- No task-specific sections (ticket IDs and their details belong in notes), no notes index (that is `_index.json`).

**Caps are checked in the post-write step by counting, not by reading** — e.g. `awk '/^## Open Questions/{p=1;next}/^## /{p=0}p&&/^- /' STATUS.md | wc -l` per section, `grep -c '^|' ` minus 2 for the Team table. Over cap in `-yolo`/batch mode = `status: error`.

**DECISIONS.md** — append every `decided` item: `- YYYY-MM-DD — decision — context · [note](notes/<file>.md)`. Create the file with a `# Decisions` header if missing. Never rewrite past entries; a reversed decision gets a new line saying so.

**PROJECT.md Template (resume card):**

```markdown
# [Project Name]

> Last updated: [YYYY-MM-DD] · [bootstrap | pavilio-note | manual]

## Overview

[2-3 sentences: what the project is, for whom, where Greg fits.]

## Repositories & working rules

| Repo | Path | Remote | Notes |
| ---- | ---- | ------ | ----- |
| [name] | `~/git/...` | [org/repo] | [branch/PR convention, worktree rule, "mirror — do not edit"] |

- [Rule that bites: PR target, branch naming, who merges, what never to push]

## Environment & gotchas

- [Stable operational facts: blocked MCP + workaround, tool that lies, env var that must be set, where secrets live (by name, never the value)]

## Technology Stack

- **[Tech]** — [how it's used, one line]

## See also

- [CONTEXT.md](./CONTEXT.md) — glossary · [adr/](./adr/) — decisions with rationale · [DECISIONS.md](./DECISIONS.md) — decision log
- [STATUS.md](./STATUS.md) — current focus, open questions, active team (volatile, rewritten per meeting)
- [\_index.json](./_index.json) — notes index · active changes: un-archived dirs under `plans/openspec/changes/`
```

Omit `Environment & gotchas` when empty. Omit any `See also` link whose target does not exist.

**STATUS.md Template (volatile):**

```markdown
# [Project Name] — Status

> Last updated: [YYYY-MM-DD] · source: [notes/<latest note>.md]

## Current Focus

- **[workstream]** — [state, next step, who] (≤ 150 chars)

## Open Questions / Blockers

- [ ] **[question]** — [owner, or `nikt` when nobody owns it] · [dd.mm] · [what unblocks it]

## Recent Decisions

- YYYY-MM-DD — [decision] — [context] · [note](notes/<file>.md)

See [DECISIONS.md](./DECISIONS.md) for the full log.

## Team (active)

| Name | Role | Current focus |
| ---- | ---- | ------------- |
| [Name] | [Role] | [≤ 80 chars, no dates] |
```

---

### **Index Update Rules**

Maintain a machine-readable `projects/projectname/_index.json` file for LLM search optimization:

1. **Read existing \_index.json** if it exists
2. **Merge new meeting data** into the index
3. **Structure** must follow this schema:

```json
{
  "project": "projectname",
  "last_updated": "YYYY-MM-DD",
  "known_participants": {
    "meeting_series_name": {
      "participants": [
        {
          "name": "FirstName LastName",
          "email": "email@domain.com",
          "aliases": ["FirstName", "LastName"]
        }
      ],
      "last_updated": "YYYY-MM-DD"
    }
  },
  "team": {
    "person_name": {
      "roles": ["role1", "role2"],
      "first_seen": "YYYY-MM-DD",
      "last_seen": "YYYY-MM-DD",
      "context": ["context note 1", "context note 2"]
    }
  },
  "decisions": [
    {
      "date": "YYYY-MM-DD",
      "decision": "What was decided",
      "context": "Why it was decided",
      "note_ref": "YYYY-MM-DD_shortname.md"
    }
  ],
  "technologies": {
    "tech_name": {
      "first_mentioned": "YYYY-MM-DD",
      "context": ["how it's used"]
    }
  },
  "notes": [
    {
      "date": "YYYY-MM-DD",
      "filename": "YYYY-MM-DD_shortname.md",
      "title": "Human readable title",
      "topics": ["topic1", "topic2"],
      "people_mentioned": ["person1", "person2"],
      "action_items_count": 5,
      "decisions_made": ["decision1"]
    }
  ],
  "search_keywords": {
    "keyword": ["YYYY-MM-DD_note1.md", "YYYY-MM-DD_note2.md"]
  }
}
```

**Index Update Process:**

1. Add new people to `team` object (merge roles and context; always bump `last_seen` — `STATUS.md` Team is derived from it)
2. Prepend new decisions to `decisions` array (most recent first) — `decided` modality only; proposals stay in the note
3. Update `technologies` with new mentions
4. Add new note entry to `notes` array
5. Update `search_keywords` with important terms from the meeting
6. Update `last_updated` timestamp
7. Update `known_participants` if user provided a new participant list

---

### Participant Recognition Rules

For recurring meetings, use the `known_participants` field in `_index.json` to map speaker identifiers to real people.

**Schema for known_participants in \_index.json:**

```json
{
  "known_participants": {
    "meeting_series_name": {
      "description": "e.g., 'daily_standup', 'sprint_planning', 'team_sync'",
      "participants": [
        {
          "name": "Ada Lovelace",
          "email": "ada@example.com",
          "aliases": ["Ada", "Lovelace"]
        },
        {
          "name": "Alan Turing",
          "email": "alan@example.com",
          "aliases": ["Alan", "Turing"]
        }
      ],
      "last_updated": "YYYY-MM-DD"
    }
  }
}
```

**Participant Recognition Process:**

1. **Before processing transcript**: Check if `known_participants` exists for this meeting series
2. **If known participants exist**:
   - Use this list as the primary source for name recognition
   - Match "Speaker 1/2/3" patterns using voice context and conversation patterns
   - Cross-reference names mentioned in conversation with known participants
3. **Show confirmation to user**: Display identified participants and ask for confirmation
4. **If user provides new participant list** (e.g., pasted from Teams):
   - Parse the format: `"LastName, FirstName <email>; ..."`
   - Extract name and email for each participant
   - Update `known_participants` in `_index.json`

**Parsing Teams/Calendar Participant Lists:**

When user pastes a list like:

```
Lovelace, Ada <ada@example.com>; Turing, Alan <alan@example.com>
```

Parse it into:

```json
{
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "aliases": ["Ada", "Lovelace"]
}
```

**Name Format Conversion:**

- Input: `"LastName, FirstName <email>"` or `"LastName, FirstName MiddleName <email>"`
- Output name: `"FirstName [MiddleName] LastName"` (natural order)
- Aliases: Include first name, last name, and any distinctive parts

**CRITICAL: Never invent names.** Only use:

1. Names from `known_participants`
2. Names explicitly mentioned in the transcript
3. Names confirmed by the user

If you cannot identify a speaker, keep them as "Speaker X" and ask the user to clarify.

---

### Entity Extraction Guidelines

When analyzing the transcript, actively look for:

**People:**

- Explicit names mentioned
- Roles or titles (developer, PM, designer)
- Responsibilities discussed
- "Speaker 1/2/3" patterns - use `known_participants` from `_index.json` to map to real names (see **Participant Recognition Rules**)
- **NEVER invent or guess names** - if unsure, keep as "Speaker X" and ask user

**Decisions** (modality `decided` only):

- Statements like "we decided", "agreed, do it", "final answer", "zamykamy temat"
- Process changes, technical choices, priority calls — **when closed**, not when floated
- Attach an anchor; if two people disagreed before the close, anchor the close

**Proposals / tentative agreements:**

- "we could", "what if", "I'd suggest", "let's go with X for now", "probably"
- Record who raised it and what would turn it into a decision
- A proposal that nobody objected to is still a proposal

**Open questions / blockers:**

- Questions asked and not answered in the meeting; dependencies on people not present
- Record who raised it and who it is blocked on

**Technologies** (observations, not decisions):

- Frameworks, libraries, tools mentioned; APIs, services; infrastructure components
- A tradeoff discussed is an observation until it appears under Decisions

**Action Items** (need evidence):

- Owner = the person who **committed**, not the person who asked
- Commitment wording quoted (≤ 12 words), deadline or `none stated`, anchor
- "Someone should…" with no taker → `unassigned`, and usually also an Open Question

**ASR flags:**

- Names, product names, acronyms, mixed-language words that look garbled
- Flag them; never silently normalize in the summary

---

### Processed Transcripts Registry Rules

A global registry at `projects/.processed_transcripts.json` tracks every transcript that has been turned into a note, regardless of which project it landed in. Its purpose is to prevent re-processing the same Quill/Fathom/etc. meeting and to keep the "last N transcripts" picker showing only fresh ones.

**Location:** `projects/.processed_transcripts.json` (single file, shared across all projects)

**Schema:**

```json
{
  "last_updated": "YYYY-MM-DD",
  "processed": [
    {
      "source": "quill",
      "source_id": "meeting-id-from-mcp",
      "title": "Daily Standup",
      "meeting_date": "2026-05-07T09:00:00+02:00",
      "processed_date": "2026-05-07",
      "project": "ch",
      "note_ref": "projects/ch/notes/2026-05-07_09-00-00_daily_standup.md"
    }
  ]
}
```

**Field meanings:**

- `source` — MCP/tool that provided the transcript: `quill`, `fathom`, `manual`, etc.
- `source_id` — stable identifier returned by the MCP (e.g. Quill meeting id, Fathom recording id). Use this for deduplication.
- `title` — meeting title at the time of processing
- `meeting_date` — original meeting timestamp in ISO 8601 with timezone
- `processed_date` — date the note was generated (YYYY-MM-DD)
- `project` — projectname under `projects/` where the note was written
- `note_ref` — relative path to the generated `.md` summary

**Read flow (step 3):**

1. Open `projects/.processed_transcripts.json`. If missing, treat as `{ "processed": [] }`.
2. Build a set of `(source, source_id)` pairs from the `processed` array.
3. After fetching N meetings from the MCP, drop any whose `(source, source_id)` is in that set.
4. Display the first 5 remaining meetings to the user.

**Write flow (step 10.5):**

1. After files are written successfully, append a new entry to `processed`.
2. Update `last_updated` to today's date.
3. If `source_id` is unknown (manual paste with no MCP linkage), skip the registry update — there's nothing to deduplicate.
4. Do NOT remove old entries; the registry is append-only. Pruning, if ever needed, is a manual maintenance task.

**Edge cases:**

- If the same MCP meeting is intentionally re-processed (e.g. transcript was updated upstream), the user must remove its entry manually first.
- If two projects could legitimately want the same meeting noted, that's still a single processed entry — pick the project that owns the primary outcome.
- Do not commit secrets or attendee emails beyond what already lives in `_index.json`.

---
