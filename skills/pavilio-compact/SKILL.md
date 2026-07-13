---
name: pavilio-compact
description: Package the current session's remaining work into a prebaked handoff file executable via /pavilio-resume — distills goal, context pointers, and todos from the live conversation plus today's progress file, and registers the handoff in BRIEFING.md. Use when the user invokes `/pavilio-compact` or wants to hand the rest of this session off to a fresh session.
---

# Pavilio Compact

Package THIS session's remaining work into a handoff for [[pavilio-resume]]. Distill from what's already in context — do not research.

## Usage

```
/pavilio-compact [project]
```

## Behavior

1. **Resolve project**: argument → project remembered earlier this conversation → ask.
2. **Distill from the current conversation + today's progress file ONLY.** No repo sweep, no PROJECT.md/CONTEXT.md/ADR reads.
3. Draft the handoff in the standard format:

```markdown
# Handoff: <title>
Todoist: <related high-level task id/url if known, else "none">
Goal: <the remaining objective, one paragraph>
## Context
- <file pointers: files touched or load-bearing this session, plan, repo paths>
## Todo
- [ ] <concrete next steps not yet done; "discover how X works" is a valid step>
## Session log
```

   Done work stays in the progress file — the handoff carries only what's left.
4. **Show the draft in chat and confirm** before writing.
5. Write to `projects/<proj>/progress/<date>-<slug>.md`.
6. Register in `projects/<proj>/progress/BRIEFING.md` under `## Handoffs`: `- [ ] <title> → projects/<proj>/progress/<file>.md (Todoist: <id or —>)`. If BRIEFING.md is missing, create a minimal stub with `# BRIEFING` and `## Handoffs`. Never touch root `BRIEFING.md`.
7. Print: `run /pavilio-resume projects/<proj>/progress/<file>.md`

## Non-goals

- Does not close the session — `/end-session` remains a separate step.
- Does not commit; does not rewrite or verify the progress file.
- Never creates Todoist tasks (link an existing high-level task only if already known).
- No prioritization or briefing (that's [[pavilio-manager]]); no execution (that's [[pavilio-resume]]).
