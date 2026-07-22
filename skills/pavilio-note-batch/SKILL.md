---
name: pavilio-note-batch
description: Batch-process unprocessed Quill meetings — guess the owning project from transcript keywords, let the user pick which to process (with project override), fan out subagents running the pavilio-note skill in batch -yolo mode, then one combined Todoist selection and a single commit. Use when the user invokes `/pavilio-note-batch`, or asks to "process all unprocessed meetings".
---

# Batch Meeting Processing

Process up to 5 unprocessed Quill meetings in one run. Each selected meeting is handled by a subagent following `skills/pavilio-note/SKILL.md` in Batch Mode; this skill orchestrates discovery, project guessing, selection, fan-out, and aggregation.

## Steps

### 1. Read the registry

Read `projects/.processed_transcripts.json` (missing → treat as `{ "processed": [] }`). Build the exclusion set of `(source, source_id)` pairs.

### 2. Scout (single subagent — keeps transcripts out of the main context)

Spawn ONE general-purpose subagent with these instructions (include the exclusion set inline):

1. Call Quill MCP `list_meetings` for the last 10 meetings. Drop any whose id is in the exclusion set.
2. **Disk verification (the registry can be stale — notes are also created outside batch mode and sessions sometimes skip the registry write).** For each remaining meeting, convert its start time to Europe/Warsaw and search all projects' note dirs for an existing note with a matching date+time filename prefix:
   ```bash
   # meeting at 2026-07-01T13:53 → try both filename conventions
   ls projects/*/notes/2026-07-01_1353* projects/*/notes/2026-07-01_13-53* \
      projects/*/projects/2026-07-01_1353* projects/*/projects/2026-07-01_13-53* 2>/dev/null
   ```
   Also allow ±2 min in the HHMM part (recording start vs meeting start can drift). A match → the meeting is **already processed**: do NOT fetch its transcript; instead record `{"meeting_id", "title", "meeting_date", "already_processed": true, "project": "<from matched path>", "note_ref": "<matched .md path>"}` for the registry backfill.
3. Keep the first 5 meetings that survived BOTH filters (registry + disk). For each: call `get_transcript`, write the verbatim transcript to `projects/.tmp_transcripts/<meeting_id>.txt` (create the dir if missing) using the Write tool.
4. Build a keyword map: for every `projects/*/_index.json`, collect the project's `search_keywords` keys and `team` member names; also include each project folder name itself. (Skip non-project dirs without `_index.json`.)
5. Score each transcript: case-insensitive count of keyword occurrences per project (e.g. `grep -ci`). Highest score wins. Confidence: `high` if best score ≥ 2× runner-up and ≥ 5 hits; `low` if best score < 3 hits; `?` if zero hits for all projects; otherwise `med`.
6. Return ONLY a JSON object — no transcript content, no prose:
   ```json
   {
     "unprocessed": [{"meeting_id": "...", "title": "...", "meeting_date": "<ISO, Europe/Warsaw>", "guessed_project": "<name or ?>", "confidence": "high|med|low|?"}],
     "backfill": [{"meeting_id": "...", "title": "...", "meeting_date": "<ISO, Europe/Warsaw>", "project": "...", "note_ref": "projects/<project>/.../<file>.md"}]
   }
   ```

If the scout fails or Quill MCP is unavailable → tell the user "Quill unavailable — run /pavilio-note manually" and stop.

### 3. Self-heal the registry

If the scout's `backfill` array is non-empty: append each entry to `projects/.processed_transcripts.json` `processed` (schema: `source: "quill"`, `source_id: meeting_id`, plus `title`, `meeting_date`, `processed_date: today`, `project`, `note_ref`), update `last_updated`, and tell the user which meetings were found already processed on disk and backfilled. Do this BEFORE asking anything — even if the user later cancels, the registry fix should stick (it gets committed in step 8, or in its own commit if nothing is selected).

If `unprocessed` is empty → say so (mention any backfills) and stop, committing the registry fix if one happened.

### 4. Display the list

```
Unprocessed meetings:
1. [2026-06-03 09:00] Daily Standup → ch (high)
2. [2026-06-02 14:00] Architecture sync → metro (med)
3. [2026-06-02 10:00] 1:1 → ? (?)
```

### 5. Ask which to process

Prompt: "Which numbers? `N` accepts the guess, `N:project` overrides (e.g. `1 2:metro`). Meetings guessed `?` need an explicit `N:project`. Empty/cancel aborts."

- Bare `N` with guess `?` → skip that meeting and tell the user why.
- Empty reply or `cancel` → delete all files in `projects/.tmp_transcripts/` and stop.

### 6. Fan out processing subagents

Group selected meetings by resolved project:

- **Different projects → parallel** (spawn in one message).
- **Same project → sequential** (they both update that project's `PROJECT.md`/`_index.json` — running them in parallel would conflict).

Each subagent prompt:

> Read and follow the instructions in the `pavilio-note` skill (`skills/pavilio-note/SKILL.md`) exactly, with this input: projectname=`<project>` `-yolo` `--meeting-id <meeting_id>` `--transcript-file projects/.tmp_transcripts/<meeting_id>.txt`. Your final message must be ONLY the Batch Mode JSON output defined in that skill.

Parse each subagent's JSON result. A subagent that errors or returns `status: error` does not stop the others.

### 7. Aggregate

1. For every `status: ok` result: append its `registry_entry` to `projects/.processed_transcripts.json` `processed` array; update `last_updated` to today.
2. Delete tmp files of meetings that were listed but NOT selected. (Selected+ok ones were moved into `log/` by the subagent; selected+failed ones stay for retry.)
3. Report failures explicitly: meeting title + reason + "tmp transcript kept, retry with /pavilio-note-batch or /pavilio-note".

### 8. Combined Todoist selection

Show one numbered list of all `todos` from all ok results, grouped by project:

```
TODOs:
[ch]
1. Fix checkout footer — PR needed for footer component
[metro]
2. Review API draft — comment on the unified API proposal
```

Ask which numbers to add to Todoist. Add selected via Todoist MCP: content `"[project] Short title"`, description = longer description, due today. Then ask if the user wants any other tasks added.

### 9. Single commit

```bash
git add projects/
git commit -m "notes: batch-process <N> meetings (<project list>)"
git push
```

## Rules

- The registry is a cache, not the source of truth — note files on disk are. Never offer a meeting for processing when a matching note already exists; backfill the registry instead.
- Never fetch a transcript twice — the scout's tmp file is the only fetch; the note subagent moves it into `log/`.
- Never let transcript content into the main conversation — only the scout's compact JSON table and the subagents' JSON results.
- Registry and git are touched ONLY by this skill (parent), never by the fan-out subagents.
- Quill only for now; the registry schema already supports other sources.
