---
name: pavilio-writing-plans
description: Write a bite-sized, contract-style implementation plan from an approved spec, saved under projects/<project>/plans/. Tasks carry files, WHEN/THEN acceptance criteria, and test names — not pre-written code. Use when the user invokes `/pavilio-writing-plans` or has a spec/requirements ready to turn into an executable plan.
---

# pavilio-writing-plans

Turn an approved design into a bite-sized, test-first implementation contract. Backend already resolved for the change's scope — follow [[pavilio-openspec-storage]]. The one workspace rule: **the contract is written as the change's `tasks.md` inside that resolved OpenSpec backend.**

**Announce at start:** "Using pavilio-writing-plans to create the implementation contract."

**Resolve the backend first:** the change's `openspec/changes/<change-id>/` already exists (grill created `proposal.md` / `design.md` / delta specs there). Reuse the backend already resolved for that scope — follow [[pavilio-openspec-storage]] (a configured scope is reused without asking; project-wide changes use the project store). Resolve `<change-id>` from the design's change dir, the conversation, or the sole un-archived change; if ambiguous, ask once.

**Save the contract to:** `openspec/changes/<change-id>/tasks.md` in the resolved backend, alongside the change's `proposal.md` and `design.md`. A coordinated multi-repository change writes a `tasks.md` under each repository's own change dir, sharing the change identifier.

## Overview

The plan is a **contract, not a transcript of the implementation**. It is executed by capable implementer sub-agents ([[pavilio-execute-plan]]) that read the repo themselves — so the plan defines *what must be true when a task is done* (files, acceptance criteria, tests), and delegates *how* to the executor. Pre-written implementation code in a plan gets written twice (plan + diff), reviewed twice, and is stale by execution time. Don't write the software in markdown.

Budget: the plan should not be longer than the design doc it came from. If it is, it's carrying implementation, not intent.

## Scope check

If the spec spans multiple independent subsystems, suggest splitting into separate plans — one per subsystem, each producing working, testable software on its own.

## File structure

Before defining tasks, map which files are created/modified and each one's single responsibility. Files that change together live together; split by responsibility, not layer. Prefer smaller focused files. In existing code, follow established patterns.

## Bite-sized task granularity

One task = one testable component or behavior: write the failing tests → see them fail → minimal implementation → see them pass → commit.

## Plan document header

Every plan MUST start with:

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** implement this plan with [[pavilio-execute-plan]] — task-by-task, top-down; check off each step (`- [ ]` → `- [x]`) as it lands. Do one task fully (test → implement → verify → commit) before starting the next.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

**Design:** [relative link to the sibling `design.md` in this change dir]

---
```

## Task structure

````markdown
### Task N: [Component Name]

**Files:**
- Create: `exact/path/to/file.ts`
- Modify: `exact/path/to/existing.ts` (`functionOrSymbolName`)
- Test: `exact/path/to/__tests__/file.test.ts`

**Acceptance criteria:**
- WHEN [trigger/input] THEN [observable result]
- WHEN [edge case] THEN [behavior]

**Tests (names only — red first):**
- "test name describing the behavior it verifies"

- [ ] **Step 1: Write the failing tests** — Run: `<cmd>` — Expected: FAIL
- [ ] **Step 2: Minimal implementation** — Run: `<cmd>` — Expected: PASS
- [ ] **Step 3: Commit** — `git add <paths> && git commit -m "feat: ..."`
````

Anchor Modify refs to **symbols, not line numbers** — line numbers rot the moment anything else lands.

Note: tests live in a `__tests__` subfolder next to the file under test (shared harness may stay in `src/test/`).

## When inline code IS warranted

Include code only where the code itself is the decision being locked in:

- Public API signatures / exported types the rest of the plan depends on
- Wire formats, schemas, exact config values
- A genuinely tricky algorithm where the approach was the point of the design

Mark these as a **Contract:** block inside the task. Everything else — test bodies, implementations, boilerplate — is the implementer's job.

## No vague criteria

These are plan failures — never write them: "handle errors appropriately"; "add validation / edge cases" without naming them as WHEN/THEN criteria; "test the above" without test names; acceptance criteria that can't be checked against a diff; references to types/functions not defined in any task's Contract or in existing code.

## Plan shelf-life

Plans are written **just-in-time** — write the plan when you're about to execute it. Never park a plan: parked plans rot silently as other work lands on the same files. If work must wait, park the **spec** (behavior-level, rots slower) and write the plan when execution starts. A plan is fresh only in the session that wrote it; dispatched in any later session, it is presumed stale and must pass the staleness check in [[pavilio-execute-plan]] step 1.

## Remember

- Exact file paths, symbol anchors, WHEN/THEN criteria, test names. Exact commands + expected outcome per step. DRY, YAGNI, TDD, frequent commits.
- Plans in implementation are FIXED — new work becomes a new ticket, not a plan amendment.
