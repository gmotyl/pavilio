# AGENTS.md - Projects Workspace

This file defines your project registry and workflow for AI agents (Claude Code, Kilocode, Copilot, etc.).

## Communication rule - important!

- When reporting information to me, be extremely concise and sacrifise grammar fo the sake of concision.

## Projects Registry

> **Your projects are private.** Create `.projects.local.md` in the repo root (gitignored) to define your project list. See `AGENTS.md.example` to get started.
>
> When `.projects.local.md` exists, read it alongside this file — it is the authoritative project registry for this workspace.

| Project | Type | Path                      |
| ------- | ---- | ------------------------- |
| my-app  | work | `<root>/projects/my-app/` |

The table above is an example. Replace it with your own projects in `.projects.local.md`.

`<root>` is this workspace's repo root (`git rev-parse --show-toplevel`). Project folders always live in its `projects/` subdirectory, so a project's path is `<root>/projects/<name>/`. When the repo itself is named `projects`, that resolves to `.../projects/projects/<name>/` — keep both levels, never collapse to `<root>/<name>/`.

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
  1. **Design → Plan** — [`skills/pavilio-grill/SKILL.md`](skills/pavilio-grill/SKILL.md): stress-test the design against the existing domain model (`CONTEXT.md`, `adr/`), sharpen terminology, and update docs inline. Once you approve the design, grill hands off **under the hood** to [`skills/pavilio-writing-plans/SKILL.md`](skills/pavilio-writing-plans/SKILL.md), which writes the bite-sized, test-first plan — you do not invoke the plan writer by hand.
  2. **Execute** — [`skills/pavilio-execute-plan/SKILL.md`](skills/pavilio-execute-plan/SKILL.md): run the plan task-by-task with review checkpoints; check off each step as it lands; stop and ask when blocked.
  3. **Implement** — red-green-refactor for every feature or bugfix: failing test → see it fail → minimal implementation → see it pass → commit. (This is the per-step rhythm inside Execute.)
- **When writing design documents, always invoke the `pavilio-mermaid-chart` skill and include Mermaid diagrams** — at minimum a `flowchart` for components and data flow, plus a `sequenceDiagram` when interaction ordering matters. ASCII box-and-arrow art is harder to skim and does not render in the panel. Follow `/pavilio-mermaid-chart` patterns — the panel auto-colors subgraphs and sequence `rect` sections to visually separate grouped paths.

**To override:** Add project-specific row below the default rules.

## Domain Context & Decisions

Two kinds of documents anchor non-trivial design and scope decisions:

- **`CONTEXT.md`** — the glossary. Defines the words this codebase uses (e.g. _Notes world_, _Project_, _Linked repository_). Small enough to read eagerly on project entry.
- **`docs/adr/NNNN-*.md`** — Architecture Decision Records. One decision per file, sequentially numbered. Read **lazily**: list filenames on resume, only `Read` a body when the current task touches its area.

Both exist at three scopes:

- Repo root — workspace-wide
- `<root>/projects/<name>/` — project-specific (its own `CONTEXT.md` and `adr/`)
- `<linked-repo>/` — each linked code repo's own glossary and decisions; follow that repo's conventions

**Format & workflow** are defined by the `pavilio-grill` skill — see [`skills/pavilio-grill/SKILL.md`](skills/pavilio-grill/SKILL.md), [`CONTEXT-FORMAT.md`](skills/pavilio-grill/CONTEXT-FORMAT.md), and [`ADR-FORMAT.md`](skills/pavilio-grill/ADR-FORMAT.md).

**Rule:** when a user asks "should we…?" and the answer depends on terminology, scope, or a past trade-off, read the relevant `CONTEXT.md` / ADRs **before** answering. Don't invent new words for concepts that already have canonical names.

## Session Tracking

Sessions are bracketed by two skills: [`pavilio-session-start`](skills/pavilio-session-start/SKILL.md) and [`pavilio-session-end`](skills/pavilio-session-end/SKILL.md).

**Continuous-write model:** the progress file `<root>/projects/[project]/progress/[date]-slug.md` is **opened at session start and appended to throughout the session**. Decisions, problems, resolutions, and next steps go in as they happen — not dumped from memory at the end. `/pavilio-session-end` ("session end" / "end session") then verifies completeness, commits, and proposes any Todoist follow-ups. Save only what's relevant to picking up later — not a transcript.

## Skills

All local skills live under [`skills/`](skills/), each as `skills/<name>/SKILL.md` with YAML frontmatter. The right sidebar of the panel lists them; `pnpm setup:claude-code` and `pnpm setup:opencode` derive one slash command per skill for each agent (`pnpm pull` re-runs both for configured agents).

**pavilio- family** (self-contained slash commands — each depends only on other `pavilio-*` skills):

- [`pavilio-session-start`](skills/pavilio-session-start/SKILL.md) — start/resume a project; opens the session's progress file (`/pavilio-session-start`)
- [`pavilio-session-end`](skills/pavilio-session-end/SKILL.md) — verify the progress file is complete, commit + push, optionally propose Todoist tasks (`/pavilio-session-end`)
- [`pavilio-grill`](skills/pavilio-grill/SKILL.md) — design: stress-test against `CONTEXT.md` and ADRs (`/pavilio-grill`)
- [`pavilio-writing-plans`](skills/pavilio-writing-plans/SKILL.md) — produce the bite-sized, test-first plan document before coding; usually invoked under the hood by `pavilio-grill` (`/pavilio-writing-plans`)
- [`pavilio-execute-plan`](skills/pavilio-execute-plan/SKILL.md) — execute a written plan task-by-task with review checkpoints; stop and ask when blocked (`/pavilio-execute-plan`)
- [`pavilio-handoff`](skills/pavilio-handoff/SKILL.md) — prebake a handoff file to delegate a task for later execution (`/pavilio-handoff`)
- [`pavilio-compact`](skills/pavilio-compact/SKILL.md) — package remaining session work into a handoff before context runs out (`/pavilio-compact`)
- [`pavilio-resume`](skills/pavilio-resume/SKILL.md) — pick up a prebaked handoff and execute its todo list (`/pavilio-resume`)
- [`pavilio-manager`](skills/pavilio-manager/SKILL.md) — managing-developer advisor; briefs and prioritizes work (`/pavilio-manager`)
- [`pavilio-audit`](skills/pavilio-audit/SKILL.md) — deep repo audit → health grade + improvement plan (`/pavilio-audit`)
- [`pavilio-qa-agent`](skills/pavilio-qa-agent/SKILL.md) — acceptance-criteria-driven QA runner (`/pavilio-qa-agent`)
- [`pavilio-create-skill`](skills/pavilio-create-skill/SKILL.md) — scaffold a new workspace skill (`/pavilio-create-skill`)
- [`pavilio-memo`](skills/pavilio-memo/SKILL.md) — quick capture a thought or note (`/pavilio-memo`)
- [`pavilio-memo-explain`](skills/pavilio-memo-explain/SKILL.md) — explain a concept/flow as a mermaid memo (`/pavilio-memo-explain`)
- [`pavilio-pr-explain`](skills/pavilio-pr-explain/SKILL.md) — explain a PR/branch/commit-range as a diagram-rich memo, built from the diff (`/pavilio-pr-explain`)
- [`pavilio-note`](skills/pavilio-note/SKILL.md) — process meeting transcripts; Quill-aware (`/pavilio-note`)
- [`pavilio-note-batch`](skills/pavilio-note-batch/SKILL.md) — batch-process unprocessed Quill meetings (`/pavilio-note-batch`)
- [`pavilio-question`](skills/pavilio-question/SKILL.md) — query project knowledge base (`/pavilio-question`)
- [`pavilio-bootstrap`](skills/pavilio-bootstrap/SKILL.md) — initialize `PROJECT.md` + `_index.json` (`/pavilio-bootstrap`)

**Other project skills:**

- [`mermaid-chart`](skills/mermaid-chart/SKILL.md) — patterns for diagrams that render well in the panel (`/mermaid-chart`)

---

**Generated by:** pavilio template
**Last updated:** Use `scripts/register-project.sh` to add new projects
