# AGENTS.md - Projects Workspace

This file defines your project registry and workflow for AI agents (Claude Code, Kilocode, Copilot, etc.).

## Projects Registry

> **Your projects are private.** Create `.projects.local.md` in the repo root (gitignored) to define your project list. See `AGENTS.md.example` to get started.
>
> When `.projects.local.md` exists, read it alongside this file — it is the authoritative project registry for this workspace.

| Project | Type | Path               |
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
- **Workflow (in order):** local skill copies live under [`skills/`](skills/) — read them directly if the plugin-cached versions aren't available.
  1. **Design** — [`skills/grill-with-docs/SKILL.md`](skills/grill-with-docs/SKILL.md): stress-test the design against the existing domain model (`CONTEXT.md`, `docs/adr/`), sharpen terminology, and update docs inline as decisions crystallise.
  2. **Plan** — [`skills/writing-plans/SKILL.md`](skills/writing-plans/SKILL.md): produce the actual plan document before touching code.
  3. **Execute** — [`skills/executing-plans/SKILL.md`](skills/executing-plans/SKILL.md): run the plan in a separate session with review checkpoints.
  4. **Implement** — [`skills/test-driven-development/SKILL.md`](skills/test-driven-development/SKILL.md): red-green-refactor for every feature or bugfix written during execution.
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

**Format & workflow** are defined by the `grill-with-docs` skill — see [`skills/grill-with-docs/SKILL.md`](skills/grill-with-docs/SKILL.md), [`CONTEXT-FORMAT.md`](skills/grill-with-docs/CONTEXT-FORMAT.md), and [`ADR-FORMAT.md`](skills/grill-with-docs/ADR-FORMAT.md).

**Rule:** when a user asks "should we…?" and the answer depends on terminology, scope, or a past trade-off, read the relevant `CONTEXT.md` / ADRs **before** answering. Don't invent new words for concepts that already have canonical names.

## Session Tracking

Sessions are bracketed by two skills: [`resume-session`](skills/resume-session/SKILL.md) and [`end-session`](skills/end-session/SKILL.md).

**Continuous-write model:** the progress file `projects/[project]/progress/[date]-slug.md` is **opened at resume time and appended to throughout the session**. Decisions, problems, resolutions, and next steps go in as they happen — not dumped from memory at the end. `/end-session` ("session end" / "end session") then verifies completeness, commits, and proposes any Todoist follow-ups. Save only what's relevant to picking up later — not a transcript.

## Skills

All local skills live under [`skills/`](skills/), each as `skills/<name>/SKILL.md` with YAML frontmatter. The right sidebar of the panel lists them; `pnpm setup:claude-code` copies the project-skill `SKILL.md` files into `.claude/commands/` as slash commands.

**Project skills** (slash commands):

- [`memo`](skills/memo/SKILL.md) — quick capture a thought or note (`/memo`)
- [`note`](skills/note/SKILL.md) — process meeting transcripts; Quill-aware (`/note`)
- [`question`](skills/question/SKILL.md) — query project knowledge base (`/question`, `/q`)
- [`bootstrap`](skills/bootstrap/SKILL.md) — initialize `PROJECT.md` + `_index.json` (`/bootstrap`)
- [`resume-session`](skills/resume-session/SKILL.md) — resume a project; opens the session's progress file (`/resume-session`)
- [`end-session`](skills/end-session/SKILL.md) — verify the progress file is complete, commit + push, optionally propose Todoist tasks (`/end-session`)

**Workflow skills** — read these directly when starting non-trivial work:

- [`grill-with-docs`](skills/grill-with-docs/SKILL.md) — design: stress-test against `CONTEXT.md` and ADRs
- [`writing-plans`](skills/writing-plans/SKILL.md) — produce the plan document before coding
- [`executing-plans`](skills/executing-plans/SKILL.md) — run plans with review checkpoints
- [`test-driven-development`](skills/test-driven-development/SKILL.md) — red-green-refactor for every feature or bugfix

---

**Generated by:** pavilio template
**Last updated:** Use `scripts/register-project.sh` to add new projects
