# Resume Session Command

Resumes work on a project by loading context, checking in-progress plans, and entering planning/brainstorming mode.

## Usage

- `/resume-session [project]` — resume a project session (projectname optional if previously set this conversation)
- `/resume-session [project] <task description>` — fast-entry: skip summary, jump straight to brainstorming the described task

## Behavior

**Project resolution (in order):**
1. If `[project]` argument is provided → use it, remember it for this conversation
2. No argument → run `pwd` and check if the current directory is a known project folder:
   - If path ends with `.../projects/[name]` → use that name automatically
3. If project was remembered from an earlier `/resume-session` call this conversation → use it
4. None of the above → ask: "Which project do you want to resume?" and wait for reply

**Then follow the full resume logic from `commands/resume.md`:**

1. Load most recent progress file from `projects/[project]/progress/`
2. Read `projects/[project]/PROJECT.md` for repo locations and key context
3. Read `projects/[project]/plans/CURRENT.md`
4. **Branch on CURRENT.md content:**

   **Empty or missing** → Display brief last-session summary, then ask: "What do you want to work on today?" Wait for reply, then invoke `superpowers:brainstorming`.

   **One plan path listed** → Skip summary. Show:
   ```
   In-progress plan: <plan filename>
   Next task: <task N title>

   Continue this plan, or do you have a different task?
   ```
   Wait for reply. If confirmed → `superpowers:executing-plans` from next incomplete task. If new task → treat as fast-entry with task description.

   **Multiple plans listed** → Skip summary. Show numbered list, wait for selection.

**Fast-entry variant** (`/resume-session [project] <task description>`):
1. Load PROJECT.md silently (no display)
2. Skip progress summary
3. Immediately invoke `superpowers:brainstorming` with the task description

## Rules

- Always remember the project for subsequent `/end-session` calls in this conversation
- Use GitNexus MCP for codebase exploration, not `ls`/`find`/glob browsing
- Enter planning mode after resume — invoke `superpowers:brainstorming` before any implementation
