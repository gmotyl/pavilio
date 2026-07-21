---
name: pavilio-execute-plan
description: Execute a written implementation plan task-by-task with review checkpoints. Use when the user invokes `/pavilio-execute-plan`, or has a plan under projects/<project>/plans/ ready to build. This is the Execute step after [[pavilio-grill]] → [[pavilio-writing-plans]] have produced the plan.
---

# Pavilio Execute Plan

Load the plan, review it critically, execute every task in order, stop the moment you're blocked, and finish cleanly.

**Announce at start:** "Using pavilio-execute-plan to implement this plan."

## Usage

```
/pavilio-execute-plan [path/to/plan.md]
```

If no path is given, use the in-progress plan referenced by `projects/<project>/plans/CURRENT.md`; if that's empty or ambiguous, ask which plan — one question, then stop.

## The process

### Step 1 — Load and review the plan
1. Read the plan file end-to-end.
2. Review it critically — surface any questions, gaps, or concerns.
3. If concerns exist, raise them with the user **before** starting and wait.
4. If none, create a todo per task (checkbox `- [ ]` items in the plan map 1:1 to todos) and proceed.

### Step 2 — Execute tasks
For each task, in order:
1. Mark it in-progress.
2. Follow each step exactly — the plan is written in bite-sized steps (write the failing test → see it fail → minimal implementation → see it pass → commit).
3. Run the verifications the step specifies. Do not skip them.
4. Mark it complete and move on.

Keep the session progress file (opened by [[pavilio-session-start]]) updated as you go — decisions, problems, resolutions.

### Step 3 — Finish
After all tasks are complete and verified:
1. Run the full test/build suite and confirm it's green — paste the actual result, don't assert success without evidence.
2. Present the completion options and let the user choose: **merge**, **open a PR**, or **leave the branch as-is**. Execute the chosen option; never merge to `main`/`master` without explicit consent.
3. Hand off to [[pavilio-session-end]] to verify the progress note, commit, and propose any follow-ups.

## When to stop and ask

**Stop immediately when:**
- You hit a blocker (missing dependency, failing test you can't resolve, unclear instruction).
- The plan has a critical gap that prevents starting or continuing.
- A verification fails repeatedly.

Ask for clarification rather than guessing. Don't force through blockers.

## When to revisit earlier steps

Return to Step 1 (review) when the user updates the plan based on your feedback, or the fundamental approach needs rethinking.

## Rules

- Review the plan critically first; follow its steps exactly; never skip verifications.
- **Plans in implementation are FIXED** — new work becomes a new ticket/plan, not an amendment to the running plan.
- Prefer an isolated workspace (a dedicated branch or git worktree) over building on `main`/`master`.
- Stop when blocked; never guess your way past a failure.

## Non-goals

- Does not write the plan — that's [[pavilio-writing-plans]] (invoked under the hood by [[pavilio-grill]]).
- Does not design or re-scope — escalate to [[pavilio-grill]] if the plan turns out to need real design work.
- Does not commit the session progress note or propose Todoist tasks — that's [[pavilio-session-end]].
