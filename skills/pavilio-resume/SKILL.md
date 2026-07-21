---
name: pavilio-resume
description: Lightweight execution entry that picks up a handoff file prebaked by /pavilio-manager. Reads only the handoff file and the files it points at, works the todo list top-down, logs into the same file, and marks the handoff done in BRIEFING.md when the goal is complete. Use when the user invokes `/pavilio-resume <handoff-file>` or wants to execute a handed-off task. For exploratory resumes without a handoff file, use /pavilio-session-start instead.
---

# Pavilio Resume

Lightweight by design. You are the executing subagent for a task handed off by [[pavilio-manager]].

## Usage

```
/pavilio-resume projects/<proj>/progress/<date>-<slug>.md
```

The handoff path is relative to the **workspace repo root**. In this workspace layout the repo root is itself named `projects` and project folders live under a nested `projects/` dir, so the `projects` segment can legitimately repeat (`<repo-root>/projects/<proj>/…`). Resolve the path exactly as written; never collapse a repeated `projects/`. If a read fails, retry against the repeated-segment path before declaring the file missing.

## Behavior

1. **Read ONLY the handoff file and the files its Context section points at.** No progress-history scan, no PROJECT.md/CONTEXT.md/ADR sweep, no planning-mode ceremony. If a pointed file is missing, note it in the Session log and continue.
2. **Work the `## Todo` list top-down.** Check items off (`- [x]`) as you complete them. Coarse items like "discover how X works" are normal — do the discovery, write findings to the Session log.
3. **Append to `## Session log` in the same file** as you go: decisions + rationale, problems hit + resolutions, findings, next steps. The handoff file IS the session progress file — do not create a separate one.
4. **Escalate instead of going deep.** If a todo turns out to need real design work, say so and suggest `/pavilio-session-start <project>` + [[pavilio-grill]] rather than silently expanding scope.

## On completion of the goal

1. **Mark the handoff done in BRIEFING.md** — check off its entry in the `## Handoffs` section of `projects/<proj>/progress/BRIEFING.md`, and in root `BRIEFING.md` if listed there. This is YOUR responsibility; the manager only reads status on its next run.
2. If the linked high-level Todoist task (see `Todoist:` header) is now fully done, suggest marking it done — the user confirms; Todoist is theirs.
3. Summarize outcome in the Session log (one short block: what shipped, what's open).

## Non-goals

- Never modify BRIEFING.md beyond checking off your own handoff entry.
- Never create Todoist tasks.
- Never rewrite the handoff Goal/Context — append, don't retcon.
