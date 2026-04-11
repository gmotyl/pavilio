# Session Resume & End Command

Handles session continuity: resuming previous work and saving session progress.

## Commands

- `resume [project]` — check for in-progress plans, ask what to do next
- `resume [project] <task description>` — skip summary, jump straight to brainstorming the described task
- `standup [project]` — comprehensive context for standup meetings
- `session end` or `end session` — save progress and close session

---

## Codebase Exploration Rules

When any codebase exploration is needed during resume, brainstorming, or planning:

- **Use GitNexus MCP** (`gitnexus://repo/{name}/context`, `mcp__gitnexus__query`, `mcp__gitnexus__impact`, etc.) for architecture, symbol lookup, relationships, and impact analysis — follow the `gitnexus-exploring` skill
- **Use LSP** for precise symbol definitions, references, and call hierarchies
- **Do NOT use `ls`, `find`, or file glob browsing** to explore project structure — GitNexus and LSP are authoritative and faster

---

## Resume Session

### Syntax variants

**`resume [project]`** — context-aware resume:

1. Load most recent progress file from `projects/[project]/progress/`
2. Read PROJECT.md for repository locations and key context
3. Read `projects/[project]/plans/CURRENT.md`
4. **Branch on CURRENT.md content:**

   **Empty or missing** → Display brief last-session summary, then ask: "What do you want to work on today?" Wait for the user's reply. Treat their reply as the task description and **immediately invoke `superpowers:brainstorming`** — do NOT start exploring code, reading files, or taking any implementation action before brainstorming completes.

   **One plan path listed** → Skip summary display. Show:
   ```
   In-progress plan: <plan filename>
   Next task: <task N title>

   Continue this plan, or do you have a different task?
   ```
   Wait for reply. If confirmed → `superpowers:executing-plans` from next incomplete task. If new task described → treat as `resume [project] <task description>`.

   **Multiple plan paths listed** → Skip summary display. Show numbered list:
   ```
   Multiple in-progress plans:
   1. <plan 1 filename>
   2. <plan 2 filename>
   ...

   Which one to continue, or do you have a different task?
   ```
   Wait for reply. If number chosen → `superpowers:executing-plans` for that plan. If new task described → treat as `resume [project] <task description>`.

---

**`resume [project] <task description>`** — fast entry, no summary:

1. Load PROJECT.md silently for repo context (no display)
2. Skip progress file summary entirely
3. Immediately invoke `superpowers:brainstorming` with the task description as the starting idea

This variant is optimised for cost-conscious agents (Copilot etc.) where skipping the summary saves a round-trip.

For comprehensive standup preparation, use `standup [project]` instead.

---

## Standup Preparation

Usage: `standup [project-name]` or just `standup`

Comprehensive context for standup meetings:

1. Load most recent progress file from `projects/[project]/progress/`
2. Read PROJECT.md to get repository locations and key context
3. Check Todoist for tasks with `[project-name]` in square brackets
4. **Check for pending PRs** to be reviewed (if using Azure DevOps or GitHub)
   - Azure DevOps: `az repos pr list --organization <url> --project <project> --repo <repo> --status active`
   - GitHub: `gh pr list --state open`
5. Display comprehensive formatted overview with:
   - Last session progress
   - Open tasks and blockers
   - PRs requiring review
   - Suggested standup talking points

This is the full context load — use `resume [project]` for quick session continuation.

---

## Session End

When you write "session end" or "end session":

1. **Create new** `projects/[project]/progress/[date]-slug.md` (always create fresh file for this session, not update existing)
2. Progress file content:
   - Context of tasks completed in this session
   - Results/outcomes achieved
   - Next steps or blockers discovered
   - Useful context for resuming work
   - **Do NOT duplicate** information already in PROJECT.md or AGENTS.md (avoid redundancy)
   - Focus on what's unique to this session that will smooth pickup on resume
3. Commit and push to the projects repo
4. After commit, **ask the user** before creating any Todoist tasks. Propose tasks if something is left to do (format: `[project-name] Task description`) but wait for explicit approval before adding them
5. Clear context and start a new session automatically
