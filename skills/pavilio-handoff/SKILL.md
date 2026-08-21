---
name: pavilio-handoff
description: Delegate a described task by prebaking a handoff file executable via /pavilio-resume, skipping pavilio-manager's briefing/prioritization pipeline. Use when the user invokes `/pavilio-handoff <project> <task>`, or asks to "hand off" / "delegate" a task for later execution in a fresh session.
---

# Pavilio Handoff

Turn a task description into a prebaked handoff for [[pavilio-resume]]. Delegate — do not execute or research deeply.

## Usage

```
/pavilio-handoff <project> <task description>
```

## Paths

All `projects/<proj>/…` paths are relative to the **workspace repo root**. In this workspace layout the repo root is itself named `projects` and project folders live under a nested `projects/` dir, so the `projects` segment can legitimately repeat (`<repo-root>/projects/<proj>/…`). Write and resolve the path exactly as such; never collapse a repeated `projects/`.

## Behavior

1. **Resolve inputs**: project + task from arguments; ask only for what's missing.
2. **Fixed read budget** to fill Context (do not exceed): latest 1 file from `projects/<proj>/progress/` + the active (un-archived) change dir under `openspec/changes/`, referenced by its `<change-id>` (see [[pavilio-openspec-storage]]). Unknowns become `- [ ] discover …` todo items, not reading.
3. Draft the handoff in the standard format:

```markdown
# Handoff: <title>
Todoist: <related high-level task id/url if mentioned, else "none">
Goal: <one paragraph, from the task description>
## Context
- <file pointers: latest progress file, plan, repo paths>
## Todo
- [ ] <coarse steps; "discover how X works" is a valid step>
## Session log
```

4. **Show the draft in chat and confirm** before writing.
5. Write to `projects/<proj>/progress/<date>-<slug>.md`.
6. Register in `projects/<proj>/progress/BRIEFING.md` under `## Handoffs`: `- [ ] <title> → projects/<proj>/progress/<file>.md (Todoist: <id or —>)`. If BRIEFING.md is missing, create a minimal stub with `# BRIEFING` and `## Handoffs`. Never touch root `BRIEFING.md`.
7. Print: `run /pavilio-resume projects/<proj>/progress/<file>.md`

## Non-goals

- No prioritization or briefing (that's [[pavilio-manager]]).
- No execution of the task and no deep discovery — coarse todos instead.
- Never creates Todoist tasks (link an existing high-level task only if the user mentions one).
