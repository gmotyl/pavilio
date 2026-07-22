---
name: pavilio-execute-plan
description: Orchestrate execution of a written implementation plan by dispatching implementer and reviewer sub-agents task-by-task, keeping the main thread for orchestration only. Use when the user invokes `/pavilio-execute-plan`, or has a plan under projects/<project>/plans/ ready to build. This is the Execute step after [[pavilio-grill]] → [[pavilio-writing-plans]] have produced the plan.
---

# Pavilio Execute Plan

Orchestrate the build. The main thread never writes implementation code — it loads the plan, then for each task dispatches an **implementer** sub-agent to build it and a **reviewer** sub-agent to review it, loops until the review is clean, and only then marks the task done. Stop the moment you're blocked; finish cleanly.

**Announce at start:** "Using pavilio-execute-plan to orchestrate this plan."

## The main thread is orchestration-only

- Keeps todo state, the session progress note, commit gating, and blocker escalation.
- Does **not** read/edit source or write tests itself — that's the implementer sub-agent's job.
- Does **not** judge code quality itself — that's the reviewer sub-agent's job.

This follows [[subagent-driven-development]] — independent tasks fan out to sub-agents so the main thread's context stays clean and each unit of work is done and reviewed in isolation.

## Usage

```
/pavilio-execute-plan [path/to/plan.md]
```

If no path is given, use the in-progress plan referenced by `projects/<project>/plans/CURRENT.md`; if that's empty or ambiguous, ask which plan — one question, then stop.

## The process

### Step 1 — Load and review the plan (main thread)
1. Read the plan file end-to-end.
2. Review it critically — surface any questions, gaps, or concerns.
3. If concerns exist, raise them with the user **before** starting and wait.
4. If none, create a todo per task (checkbox `- [ ]` items in the plan map 1:1 to todos).
5. Ensure an isolated workspace — a dedicated branch or git worktree, never `main`/`master`.

### Step 2 — Per task: implement → review → loop (dispatch sub-agents)
For each task, in order:

1. **Mark it in-progress** (main thread).
2. **Dispatch an implementer sub-agent** (general-purpose). Give it: the task's steps verbatim, the plan context it needs, the repo/project conventions, and TDD discipline (write the failing test → see it fail → minimal implementation → see it pass → commit within the task). Require a structured result: files changed, the diff range / commit SHA(s), the test/verification output pasted, and anything it could not complete.
3. **Dispatch a reviewer sub-agent** on that task's diff. Give it the plan task + acceptance criteria, the standards sources (`qa/REVIEW_RULES.md`, `CONTEXT.md`, ADRs), and the implementer's diff range. It reports: does the diff implement the task correctly and meet documented standards? Separate **blocking** issues from nits.
4. **Read the review (main thread) and decide:**
   - **Clean** → mark the todo complete, update the progress note, keep the task's commit, move on.
   - **Blocking issues** → dispatch a fresh implementer sub-agent with the reviewer's findings to fix, then re-review. **Bound the loop to ~2–3 rounds**; if it doesn't converge, stop and escalate to the user.
5. Never let one task's review-fail bleed into the next task.

**Parallelism:** independent tasks (different files/areas) may run their implement→review cycles concurrently — spawn in one message. Tasks touching the same file/area run sequentially to avoid conflicts. Prefer git worktrees when running implementers in parallel.

Keep the session progress file (opened by [[pavilio-session-start]]) updated as you orchestrate — decisions, sub-agent outcomes, review loops, problems.

### Step 3 — Finish (main thread)
After all tasks are complete and reviewed:
1. Run the full test/build suite and confirm it's green — paste the actual result, don't assert success without evidence.
2. Optionally dispatch [[pavilio-code-review]] for a branch-level two-axis (Standards + Spec) review across the whole diff.
3. Present the completion options and let the user choose: **merge**, **open a PR**, or **leave the branch as-is**. Execute the chosen option; never merge to `main`/`master` without explicit consent.
4. Hand off to [[pavilio-session-end]] to verify the progress note, commit, and propose any follow-ups.

## When to stop and ask

**Stop immediately when:**
- You hit a blocker (missing dependency, failing test the implementer can't resolve, unclear instruction).
- The plan has a critical gap that prevents starting or continuing.
- The implement→review loop for a task does not converge within the bound.

Ask for clarification rather than guessing. Don't force through blockers.

## When to revisit earlier steps

Return to Step 1 (review) when the user updates the plan based on your feedback, or the fundamental approach needs rethinking.

## Rules

- **Main thread orchestrates; sub-agents implement and review. Never implement inline in the main session.**
- Review the plan critically first; follow its steps exactly; never skip verifications.
- **Plans in implementation are FIXED** — new work becomes a new ticket/plan, not an amendment to the running plan.
- Prefer an isolated workspace (a dedicated branch or git worktree) over building on `main`/`master`.
- Stop when blocked; bound the fix loop; never guess your way past a failure.

## Non-goals

- Does not write the plan — that's [[pavilio-writing-plans]] (invoked under the hood by [[pavilio-grill]]).
- Does not design or re-scope — escalate to [[pavilio-grill]] if the plan turns out to need real design work.
- Does not commit the session progress note or propose Todoist tasks — that's [[pavilio-session-end]].
- The main thread does not write code or judge code quality itself — the implementer and reviewer sub-agents do.
