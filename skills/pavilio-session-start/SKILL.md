---
name: pavilio-session-start
description: THE skill for the word "resume" — "resume", "resume <project>", "resume work on X", "pick up where we left off" all mean this, never /pavilio-resume (that one needs an explicit handoff file path). Starts/resumes a project session by loading recent progress, PROJECT.md, and the active (un-archived) OpenSpec change dirs, then classifying the session's intent: build work enters planning mode via [[pavilio-grill]], while questions, meeting prep, note-digging, or reviews are answered directly with no grill and no change dir. Also on explicit `/pavilio-session-start`. Fast-entry form `/pavilio-session-start <project> <task>` skips the summary and goes straight at the task.
---

# Pavilio Session Start

Start work on a project by loading context, checking in-progress plans, and entering planning mode.

## Usage

- `/pavilio-session-start [project]` — start/resume a project session (project name optional if previously set this conversation)
- `/pavilio-session-start [project] <task description>` — fast-entry: skip summary, jump straight to designing the described task

## Behavior

**Path anchor (read this first):** every `projects/...` path below is relative to the **workspace repo root** (`git rev-parse --show-toplevel`, e.g. `/Users/.../git/prv/projects`). That repo is itself named `projects`, and the project folders live in its **`projects/` subdirectory** — so a project's notes dir is `<root>/projects/<name>/`. Do **not** collapse the `projects/projects` nesting: `<root>/<name>/` does not exist. The authoritative name→path map is the **Notes Path** column of `.projects.local.md` at the repo root — resolve the project against it and confirm the folder exists before loading anything.

**Project resolution (in order):**
1. `[project]` argument provided → look it up in `.projects.local.md`, use its Notes Path, remember it for this conversation
2. No argument → run `pwd`; if it is inside `<root>/projects/<name>/...`, use that `<name>`
3. Remembered from an earlier `/pavilio-session-start` call this conversation → use it
4. None of the above → ask: "Which project do you want to start?" and wait for reply

If the resolved folder is missing, say so and re-resolve via `.projects.local.md` — never guess a sibling path like `<root>/<name>/`.

**Then follow the full start logic:**

1. Load most recent progress file from `<root>/projects/[project]/progress/`
2. Read the project's default-discovery files:
   - `PROJECT.md` — overview, repos, key context (always)
   - `CONTEXT.md` (if present) — project-specific glossary (always; usually short)
   - `adr/` (if present) — **list filenames/titles only**, do not read bodies. You'll know which ADRs exist for later targeted reads.
3. Derive **active work** from the un-archived change directories under the project's configured OpenSpec sources — a change dir under `openspec/changes/` that is **not** under `changes/archive/` (see [[pavilio-openspec-storage]]). There is no active-plan pointer file to read.
4. **Branch on the active changes found:**

   **None** → Display brief last-session summary, then ask: "What do you want to work on today?" Wait for reply, then **classify the intent** (see below) and take the matching lane — build work enters the workflow at **step 1: Design**; a question, meeting prep, or anything else with no diff at the end does not.

   **One active change** → Skip summary. Show:
   ```
   In-progress change: <change-id>
   Next task: <next unchecked task in its tasks.md>

   Continue this change, or do you have a different task?
   ```
   Wait for reply. If confirmed → enter the workflow at **step 3: Execute** for that change's `tasks.md`. If new task → treat as fast-entry with task description.

   **Multiple active changes** → Skip summary. Show numbered list, wait for selection.

**Fast-entry variant** (`/pavilio-session-start [project] <task description>`):
1. Load PROJECT.md silently (no display)
2. Skip progress summary
3. Classify the argument: a build task → enter the workflow at **step 1: Design** with it in hand. A question or a non-build ask ("what did we decide about X", "prep me for the call with Y") → answer it directly in the non-build lane; fast-entry is a shortcut past the summary, not a commitment to grill.

## Classify the intent before choosing a workflow

Not every session is build work. Once you know what the user wants to do, put it in one of two lanes — say which lane in one short line, then proceed.

**Build lane** — a new feature, a change request, a bugfix, a refactor: anything that will end in a diff. → the four-step workflow below, starting at Design.

**Non-build lane** — a question about the project, meeting prep, reading/summarising notes, digging through history, reviewing someone else's work, writing a memo or a ticket, planning-adjacent thinking with no code outcome. → **no grill, no change dir, no `tasks.md`.** Just do the thing, using the loaded context and whatever skill actually fits ([[pavilio-question]], [[pavilio-search]], [[pavilio-memo]], [[pavilio-memo-explain]], [[pavilio-code-review]], …). Don't route a question through a design process.

**Unclear which lane?** Ask once — "Is this something we're going to build, or do you just want to talk it through?" — then stop and wait. Don't default to grilling.

The one thing that holds in **both** lanes: never jump straight into editing source. In the build lane that means Design first; in the non-build lane it means there is nothing to edit in the first place. A non-build session that turns into build work mid-conversation switches lanes at that moment — grill then, not before.

## Workflow after start (build lane)

Build work lands in **planning mode**, never directly in code edits. Follow the four-step workflow:

1. **Design → Plan** — [[pavilio-grill]]: stress-test the task against the project's `CONTEXT.md` and `adr/`. Sharpen terminology, surface hidden constraints, and update docs inline. Once you approve the design, grill invokes [[pavilio-writing-plans]] itself (its §6, mandatory) to write the bite-sized plan — don't invoke the plan writer by hand. Grill is finished only when the change dir holds all four of `proposal.md`, `design.md`, `specs/<capability>/spec.md`, `tasks.md`.
2. **Execute** — [[pavilio-execute-plan]]: run the change's `tasks.md` task-by-task with review checkpoints. Enter here directly when an un-archived change dir already exists; if it is missing `tasks.md`, execute-plan writes the contract first (its step 1.0) rather than stalling. Check off each step as it lands.
3. **Implement** — red-green-refactor for every feature or bugfix: write the failing test → see it fail → minimal implementation → see it pass → commit. (The per-step rhythm inside Execute.)

## Open a progress file for this session

Right after the project is resolved, **open `<root>/projects/[project]/progress/[date]-slug.md`** (create if missing, slug derived from the task or "wip" if undecided). This is the live notebook for the session — append to it as you go:

- decisions and their rationale
- problems hit + how they were solved (or remain open)
- next steps and blockers as they emerge
- context a future session would need

### `wip` is a placeholder, not a filename

A slug of `wip` means *"the theme isn't known yet"*. It is not allowed to survive a session that produced content. **The moment the session's actual theme is clear — the first real decision, the task being confirmed, the first file touched — rename the file** and say so in one line. Don't wait for session end, and don't ask permission: a slug is not a decision that needs approving.

```bash
# already committed (hourly auto-sync commits progress files) — use git mv
cd <root> && git mv projects/<project>/progress/2026-07-28-wip.md \
                   projects/<project>/progress/2026-07-28-unified-file-list-sidebar.md
```

Rules for the rename:
- Slug = the session's theme, max 4 words, kebab-case, no date repetition.
- Use `git mv` when the file is already tracked so history follows; a plain `mv` otherwise.
- Never rename a progress file from a *previous* day — those are closed records, even if their slug is `wip`.
- Renaming once is enough. If the theme shifts later, keep the name unless it is now actively misleading.

[[pavilio-session-end]] then just verifies completeness and commits — it should not be the moment when context is first dumped from memory, nor the moment the file finally gets a real name.

## Rules

- Always remember the project for subsequent [[pavilio-session-end]] calls in this conversation
- Use the `context-mode` MCP (`ctx_search`, `ctx_execute`, `ctx_execute_file`) for codebase exploration and any operation that would otherwise dump a large output into context. Do **not** fall back to `ls`/`find`/glob browsing. If `context-mode` is not installed, prompt the user to install it from https://github.com/mksglu/context-mode and run `/context-mode:ctx-doctor` to verify.
- Classify the intent before picking a workflow — **build work** begins with Design ([[pavilio-grill]]) and never jumps straight to code; **questions, meeting prep, note-digging, reviews, memos** skip grill entirely and are answered directly
- Keep the in-session progress file focused on resume-context, not a transcript
- A `-wip.md` progress file must be renamed to its real theme as soon as that theme exists — same session, without being asked
