# AGENTS.md - Projects Workspace

This file defines your project registry and workflow for AI agents (Claude Code, Kilocode, Copilot, etc.).

## Projects Registry

> **Your projects are private.** Create `.projects.local.md` in the repo root (gitignored) to define your project list. See `AGENTS.md.example` to get started.
>
> When `.projects.local.md` exists, read it alongside this file — it is the authoritative project registry for this workspace.

| Project | Type | Notes Path         |
| ------- | ---- | ------------------ |
| my-app  | work | `projects/my-app/` |

The table above is an example. Replace it with your own projects in `.projects.local.md`.

## Provider Configuration

Provider-specific config file locations and session-tracking notes have moved to [`docs/PROVIDERS.md`](docs/PROVIDERS.md). See [`docs/PROVIDER-SETUP.md`](docs/PROVIDER-SETUP.md) for the full setup guide.

## Project-Specific Rules

### Default Behavior (All Projects)

**Commits:**

- ✅ **AUTO-COMMIT on session end** - Save progress automatically
- Commit to current branch (user should use private branches for personal work)
- Always push to remote for backup
- ⚠️ **Never commit project notes to PUBLIC repositories** - Use .gitignore or private repos
- Session progress files are safe to commit (notes/[project]/progress/)

**Planning Mode:**

- Agent enters planning mode after every session resume
- Provide architecture clarity before implementation
- **Workflow (in order):** local skill copies live under [`commands/skills/`](commands/skills/) — read them directly if the plugin-cached versions aren't available.
  1. **Design** — [`commands/skills/grill-with-docs/SKILL.md`](commands/skills/grill-with-docs/SKILL.md): stress-test the design against the existing domain model (`CONTEXT.md`, `docs/adr/`), sharpen terminology, and update docs inline as decisions crystallise.
  2. **Plan** — [`commands/skills/writing-plans/SKILL.md`](commands/skills/writing-plans/SKILL.md): produce the actual plan document before touching code.
  3. **Execute** — [`commands/skills/executing-plans/SKILL.md`](commands/skills/executing-plans/SKILL.md): run the plan in a separate session with review checkpoints.
  4. **Implement** — [`commands/skills/test-driven-development/SKILL.md`](commands/skills/test-driven-development/SKILL.md): red-green-refactor for every feature or bugfix written during execution.
- **When writing design documents, always invoke the `mermaid-diagrams` skill and include Mermaid diagrams** — at minimum a `flowchart` for components and data flow, plus a `sequenceDiagram` when interaction ordering matters. ASCII box-and-arrow art is harder to skim and does not render in the panel. Follow `/mermaid-chart` patterns — the panel auto-colors subgraphs and sequence `rect` sections to visually separate grouped paths.

**To override:** Add project-specific row below the default rules.

## Domain Context & Decisions

Two kinds of documents anchor non-trivial design and scope decisions:

- **`CONTEXT.md`** — the glossary. Defines the words this codebase uses (e.g. _Notes world_, _Project_, _Linked repository_). Small enough to read eagerly on project entry.
- **`docs/adr/NNNN-*.md`** — Architecture Decision Records. One decision per file, sequentially numbered. Read **lazily**: list filenames on resume, only `Read` a body when the current task touches its area.

Both exist at three scopes:

- Repo root — workspace-wide
- `projects/<name>/` — project-specific (its own `CONTEXT.md` and `adr/`)
- `<linked-repo>/` — each linked code repo's own glossary and decisions; follow that repo's conventions

**Format & workflow** are defined by the `grill-with-docs` skill — see [`commands/skills/grill-with-docs/SKILL.md`](commands/skills/grill-with-docs/SKILL.md), [`CONTEXT-FORMAT.md`](commands/skills/grill-with-docs/CONTEXT-FORMAT.md), and [`ADR-FORMAT.md`](commands/skills/grill-with-docs/ADR-FORMAT.md).

**Rule:** when a user asks "should we…?" and the answer depends on terminology, scope, or a past trade-off, read the relevant `CONTEXT.md` / ADRs **before** answering. Don't invent new words for concepts that already have canonical names.

## Session Tracking

Session tracking is active. All messages are part of a single session until you write "session end" or "end session".

### Session End

When you write "session end" or "end session":

1. Create new `notes/[project]/progress/[date]-slug.md` (always create fresh file)
2. Progress file content:
   - Context of tasks completed in this session
   - Results/outcomes achieved
   - Next steps or blockers discovered
   - Useful context for resuming work
3. **AUTO-COMMIT and PUSH** for backup
   - Commit progress file with message: "session: [project] [date]-[description]"
   - Push to remote (if configured)
   - ⚠️ Only commit progress files, not full project notes (use .gitignore)
4. **PROPOSE Todoist tasks** if something is left to do
   - Show proposed tasks in format: `[project-name] Task description`
   - Ask user approval: "Should I add these Todoist tasks?"
5. Clear context and start a new session automatically

### Resume Session

Usage: `resume [project-name]` or just `resume`

Load recent context:

1. Load most recent progress file from `notes/[project]/progress/`
2. Read the project's default-discovery files:
   - `PROJECT.md` — overview, repos, key context (always)
   - `CONTEXT.md` (if present) — project-specific glossary (always; usually short)
   - `adr/` (if present) — **list filenames/titles only**, do not read bodies. You'll know which ADRs exist for later targeted reads.
3. Display brief formatted resume with last session context

## Commands

Commands in `commands/` folder (if created). Use `/command` syntax:

- `/memo` - Quick capture a thought or note
- `/note` - Process meeting transcripts or session notes
- `/question` or `/q` - Query project knowledge base
- `/bootstrap` - Initialize PROJECT.md and \_index.json
- `/resume` - Quick session resume (progress + PROJECT.md only)

## Commands & Skills

### Claude Code Built-in Skills

Claude Code provides these as native slash commands:

- `/memo` - Quick capture a thought or note
- `/note` - Process meeting transcripts or session notes
  - **Quill Integration:** `/note meeting-name` searches Quill for meetings, creates notes from minutes
- `/question` or `/q` - Query project knowledge base
- `/bootstrap` - Initialize PROJECT.md and project structure

### Smart Project Initialization

The `/note` command auto-initializes projects:

- `/note my-project` → Found in AGENTS.md → Creates note in `notes/my-project/notes/`
- `/note new-project` → NOT in AGENTS.md → **Asks: "Initialize project?"**
  - If yes: Creates full structure + configs + adds to AGENTS.md
  - If no: Creates generic note in `notes/notes/`

### Quill Integration

The `/note` command integrates with Quill meeting notes:

- Search for meetings by name: `/note my-project` finds "my-project" meetings in Quill
- Extract meeting minutes and create project notes in `notes/my-project/notes/`
- Preserve meeting context and action items
- Link notes back to original Quill meetings
- Works with both registered projects and newly initialized ones

### Fallback Command Scripts

If built-in skills aren't available, use executable scripts in `commands/` folder:

```bash
./commands/memo.sh "Your quick thought"
./commands/note.sh session-topic
./commands/question.sh "What is X?"
./commands/bootstrap.sh
```

See `commands/README.md` for detailed usage and examples.

---

## Code Style Guidelines

### TypeScript/JavaScript

- Use TypeScript when possible
- Explicit types for function parameters and return values
- Use `const` by default, `let` only when reassignment needed
- Prefer `async/await` over raw promises
- Use optional chaining: `obj?.prop` and nullish coalescing: `??`

### Error Handling

- Always handle promise rejections
- Use `try/catch` with meaningful error messages
- Propagate errors up with context: `throw new Error(\`Failed to X: ${err.message}\`)`

### Naming Conventions

| Type                | Convention           | Example                  |
| ------------------- | -------------------- | ------------------------ |
| Variables/Functions | camelCase            | `getUserData`, `isValid` |
| Constants           | SCREAMING_SNAKE_CASE | `MAX_RETRIES`            |
| Classes/Types       | PascalCase           | `UserService`, `User`    |
| Files               | kebab-case           | `user-service.ts`        |
| Booleans            | `is`/`has` prefix    | `isValid`, `hasError`    |

### Imports & File Organization

- Import order: built-ins → external packages → relative imports
- Use named imports over default imports for better tree-shaking
- Relative imports: use `./` or `../` (not bare module names)

---

**Generated by:** pavilio template
**Last updated:** Use `scripts/register-project.sh` to add new projects
