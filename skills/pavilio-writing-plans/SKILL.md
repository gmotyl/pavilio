---
name: pavilio-writing-plans
description: Write a comprehensive, bite-sized implementation plan from an approved spec, saved under projects/<project>/plans/. Use when the user invokes `/pavilio-writing-plans` or has a spec/requirements ready to turn into an executable plan.
---

# pavilio-writing-plans

Turn an approved spec into a bite-sized, test-first implementation plan. The one workspace rule: **plans are saved project-scoped under `projects/<project>/plans/`.**

**Announce at start:** "Using pavilio-writing-plans to create the implementation plan."

**Save plans to:** `projects/<project>/plans/YYYY-MM-DD-<feature-name>.md` (relative to the workspace repo root, i.e. the same location as `plans/CURRENT.md`). Resolve `<project>` from the spec path, the conversation, or `plans/CURRENT.md`; if ambiguous, ask once.

## Overview

Write plans assuming the engineer has zero context for the codebase and questionable taste. Document everything: which files to touch per task, the actual code, how to test it, docs to check. Bite-sized tasks. DRY. YAGNI. TDD. Frequent commits. Assume a skilled developer who knows almost nothing about our toolset or domain and isn't strong on test design.

## Scope check

If the spec spans multiple independent subsystems, suggest splitting into separate plans — one per subsystem, each producing working, testable software on its own.

## File structure

Before defining tasks, map which files are created/modified and each one's single responsibility. Files that change together live together; split by responsibility, not layer. Prefer smaller focused files. In existing code, follow established patterns.

## Bite-sized task granularity

Each step is one action (2-5 min): write the failing test → run it, see it fail → minimal implementation → run it, see it pass → commit.

## Plan document header

Every plan MUST start with:

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** implement this plan with [[pavilio-execute-plan]] — task-by-task, top-down; check off each step (`- [ ]` → `- [x]`) as it lands. Do one task fully (test → implement → verify → commit) before starting the next.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

---
```

## Task structure

````markdown
### Task N: [Component Name]

**Files:**
- Create: `exact/path/to/file.ts`
- Modify: `exact/path/to/existing.ts:123-145`
- Test: `exact/path/to/__tests__/file.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
// actual test code
```
- [ ] **Step 2: Run test to verify it fails** — Run: `<cmd>` — Expected: FAIL with "<msg>"
- [ ] **Step 3: Write minimal implementation**
```ts
// actual code
```
- [ ] **Step 4: Run test to verify it passes** — Run: `<cmd>` — Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add <paths> && git commit -m "feat: ..."
```
````

Note: tests live in a `__tests__` subfolder next to the file under test (shared harness may stay in `src/test/`).

## No placeholders

These are plan failures — never write them: "TBD"/"TODO"/"implement later"; "add appropriate error handling / validation / edge cases"; "write tests for the above" without the test code; "similar to Task N" (repeat the code); steps that say what without showing how; references to types/functions not defined in any task.

## Remember

- Exact file paths always. Complete code in every code step. Exact commands + expected output. DRY, YAGNI, TDD, frequent commits.
- Plans in implementation are FIXED — new work becomes a new ticket, not a plan amendment.
