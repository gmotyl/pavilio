---
name: pavilio-session-start
description: Start/resume a project session by loading recent progress, PROJECT.md, and plans/CURRENT.md, then entering planning mode. Use when the user invokes `/pavilio-session-start`, says "resume <project>", or wants to pick up in-progress work. Fast-entry form `/pavilio-session-start <project> <task>` skips the summary and jumps straight to designing the task.
---

# Pavilio Session Start

Start work on a project by loading context, checking in-progress plans, and entering planning mode.

## Usage

- `/pavilio-session-start [project]` — start/resume a project session (project name optional if previously set this conversation)
- `/pavilio-session-start [project] <task description>` — fast-entry: skip summary, jump straight to designing the described task

## Behavior

**Project resolution (in order):**
1. If `[project]` argument is provided → use it, remember it for this conversation
2. No argument → run `pwd` and check if the current directory is a known project folder:
   - If path ends with `.../projects/[name]` and `[name]` matches a folder in `projectsDir` → use that name automatically
3. If project was remembered from an earlier `/pavilio-session-start` call this conversation → use it
4. None of the above → ask: "Which project do you want to start?" and wait for reply

**Then follow the full start logic:**

1. Load most recent progress file from `projects/[project]/progress/`
2. Read the project's default-discovery files:
   - `PROJECT.md` — overview, repos, key context (always)
   - `CONTEXT.md` (if present) — project-specific glossary (always; usually short)
   - `adr/` (if present) — **list filenames/titles only**, do not read bodies. You'll know which ADRs exist for later targeted reads.
3. Read `projects/[project]/plans/CURRENT.md`
4. **Branch on CURRENT.md content:**

   **Empty or missing** → Display brief last-session summary, then ask: "What do you want to work on today?" Wait for reply, then enter the workflow at **step 1: Design** (see below).

   **One plan path listed** → Skip summary. Show:
   ```
   In-progress plan: <plan filename>
   Next task: <task N title>

   Continue this plan, or do you have a different task?
   ```
   Wait for reply. If confirmed → enter the workflow at **step 3: Execute** for that plan. If new task → treat as fast-entry with task description.

   **Multiple plans listed** → Skip summary. Show numbered list, wait for selection.

**Fast-entry variant** (`/pavilio-session-start [project] <task description>`):
1. Load PROJECT.md silently (no display)
2. Skip progress summary
3. Enter the workflow at **step 1: Design** with the task description in hand

## Workflow after start

Session start always lands in **planning mode**, never directly in code edits. Follow the four-step workflow:

1. **Design** — [[pavilio-grill]]: stress-test the task against the project's `CONTEXT.md` and `adr/` (and any project-scoped `CONTEXT.md`/`adr/`). Sharpen terminology, surface hidden constraints, and update docs inline when decisions crystallise.
2. **Plan** — [[pavilio-writing-plans]]: produce a written plan document before touching code.
3. **Execute** — run the plan task-by-task with review checkpoints. Enter here directly when CURRENT.md already points at an in-progress plan; check off each step as it lands.
4. **Implement** — red-green-refactor for every feature or bugfix: write the failing test → see it fail → minimal implementation → see it pass → commit.

## Open a progress file for this session

Right after the project is resolved, **open `projects/[project]/progress/[date]-slug.md`** (create if missing, slug derived from the task or "wip" if undecided). This is the live notebook for the session — append to it as you go:

- decisions and their rationale
- problems hit + how they were solved (or remain open)
- next steps and blockers as they emerge
- context a future session would need

[[pavilio-session-end]] then just verifies completeness and commits — it should not be the moment when context is first dumped from memory.

## Rules

- Always remember the project for subsequent [[pavilio-session-end]] calls in this conversation
- Use the `context-mode` MCP (`ctx_search`, `ctx_execute`, `ctx_execute_file`) for codebase exploration and any operation that would otherwise dump a large output into context. Do **not** fall back to `ls`/`find`/glob browsing. If `context-mode` is not installed, prompt the user to install it from https://github.com/mksglu/context-mode and run `/context-mode:ctx-doctor` to verify.
- Enter planning mode after start — begin with Design ([[pavilio-grill]]), never jump straight to code
- Keep the in-session progress file focused on resume-context, not a transcript
