---
name: pavilio-openspec-migrate
description: Mechanically relocate a project's flat plans/ + specs/ layout into the OpenSpec tree defined by [[pavilio-openspec-storage]] — archive shipped plans, git mv living specs and archived/active plans into place, then retire CURRENT.md. Moves + a fold pass only, never a reformat; skill-owned (git mv), no CLI. Use when the user invokes `/pavilio-openspec-migrate <project>` or explicitly asks to migrate a project's planning artifacts to the OpenSpec layout.
---

# pavilio-openspec-migrate

A per-project **runbook** that mechanically moves the legacy flat layout —
`projects/<project>/plans/*.md`, `projects/<project>/plans/archived/`,
`projects/<project>/plans/CURRENT.md`, and `projects/<project>/specs/*.md` — into the
native OpenSpec tree adopted by [[pavilio-openspec-storage]]:
`plans/openspec/changes/<id>/{proposal,design,tasks}.md`,
`plans/openspec/changes/<id>/specs/<capability>/spec.md`,
`plans/openspec/changes/archive/YYYY-MM-DD-<id>/`, and living specs
`plans/openspec/specs/<area>/spec.md`.

This is an **EXPLICIT** operation. It is **never** triggered as a side effect of
[[pavilio-grill]], [[pavilio-writing-plans]], [[pavilio-execute-plan]], or
[[pavilio-archive-plan]] — those workflows resolve backend and archive in place, but
they never relocate history. Relocation happens only when you invoke this skill for a
named project.

## What this is (and is not)

- **Is:** an ordered sequence of `git mv` moves plus one fold pass (archiving shipped
  work). History follows every file because every relocation uses `git mv`.
- **Is not:** a document reformat. **File content is unchanged** by relocation — bytes
  are **preserved verbatim**; only paths change. **Never reformat** a document while
  moving it. The only content edits in the whole runbook are the delta folds performed
  by [[pavilio-archive-plan]] in step 1.
- **No CLI.** There is no `openspec` binary and no child process anywhere in this
  runbook. Every step is a filesystem move or a skill-owned fold, exactly as
  [[pavilio-openspec-storage]] and [[pavilio-archive-plan]] describe.

## Default target backend

The default target is the **project store** at `projects/<project>/plans/openspec/`,
because existing projects' linked repositories are typically **unadopted** — Pavilio
never writes planning files into an unadopted repo. If a repository **has** adopted
native OpenSpec (per its saved `openspec` config in `repos.json`), that repository's
repo-owned artifacts migrate into its native `<repo>/openspec/` tree instead; only the
storage root differs, the tree shape is identical.

## Runbook (ordered, per project)

Run the steps **in order** for one project at a time. Do not start step *n+1* until
step *n* is complete.

### 1. Close the loop on shipped work first (fold, then it becomes archivable)

For each **active** plan whose PR is **merged/shipped**, run [[pavilio-archive-plan]]
**before any relocation**. That folds its requirement deltas into today's living specs
at `projects/<project>/specs/<area>.md` and marks it Done — so the shipped work lands
in the living specs *before* those specs are moved in step 2.

**Unshipped active plans are NOT archived** — you cannot archive unshipped work. They
stay active and migrate as active changes in step 4.

### 2. Relocate living specs (verbatim)

`git mv projects/<project>/specs/<area>.md` →
`projects/<project>/plans/openspec/specs/<area>/spec.md`, one per area.
**Content is unchanged** — this is a pure move.

### 3. Relocate archived plans (verbatim)

For each archived plan under `projects/<project>/plans/archived/<stem>*`, `git mv` its
files into `projects/<project>/plans/openspec/changes/archive/YYYY-MM-DD-<stem>/`,
mapping filenames onto the OpenSpec change shape:

- `<stem>-design.md` → `design.md`
- `<stem>-implementation.md` / `<stem>-plan.md` → `tasks.md`
- bare `<stem>.md` → `proposal.md` (or `design.md` when the body is a design), as
  appropriate to its content

Preserve any requirement deltas alongside the change under
`.../archive/YYYY-MM-DD-<stem>/specs/<capability>/spec.md`. Content unchanged.

### 4. Relocate unshipped active plans (verbatim)

For each **unshipped active** plan `<stem>`, `git mv` its files into
`projects/<project>/plans/openspec/changes/<stem>/`:

- `<stem>-design.md` → `plans/openspec/changes/<stem>/design.md`
- `<stem>-implementation.md` / bare `<stem>.md` → `plans/openspec/changes/<stem>/tasks.md`

The change lives directly under `plans/openspec/changes/<stem>` (not under `archive/`),
which is exactly what makes it the active/current change in the new layout. Content
unchanged.

### 5. Retire CURRENT.md (final step, after relocation completes)

**Only after** steps 2–4 have relocated everything for the project, `delete`
`projects/<project>/plans/CURRENT.md` and drop any star/pin metadata (already removed
from the panel). Active work is now *derived* from un-archived change dirs, so
`CURRENT.md` no longer has a job. Removing it earlier would strand the mid-migration
project; it must be the last move.

## Legacy stays readable mid-migration

The panel still lists the **legacy flat `plans/`** for a project **until that project's
move completes**, so nothing is stranded partway through. A project can sit half-migrated
between sessions and remain fully readable; you finish the runbook when convenient, and
only then (step 5) does `CURRENT.md` go away.

## Rules

- Explicit invocation only — never triggered by grill / archive / execute.
- Moves + the step-1 fold pass **only**. Never reformat a document; content is preserved
  verbatim on every relocation.
- Use `git mv` for every relocation so history follows.
- Order is load-bearing: archive shipped → move living specs → move archived → move
  active → delete `CURRENT.md` last.
- Default to the project store `projects/<project>/plans/openspec/`; a repo that adopted
  native OpenSpec receives its repo-owned artifacts in `<repo>/openspec/` instead.
- No `openspec` binary, no child process — the runbook is entirely skill-owned.
