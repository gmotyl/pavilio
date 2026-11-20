---
kind: project
---

# workspace

## Overview

The workspace repo itself: the skills, agent settings and setup scripts that every other project runs on. This is a kept project, not an example. The shipped Home actions ("Process meetings", "Knowledge harvest") run here by default.

## What lives here

- `skills/` — the shared `pavilio-*` skills used by Claude Code, opencode and codex.
- `commands/` — slash-command wrappers for those skills.
- `AGENTS.md` / `CLAUDE.md` — the shared agent instructions for the repo.
- `scripts/` — setup and maintenance scripts (project scaffolding, sync, install).
- `panel/` — the dashboard, with its settings in `panel/panel.config.ts` and a gitignored `panel/panel.config.local.ts`.
- `projects/` — the projects themselves.

## Setup

See the root `README.md` for installing dependencies and starting the panel, and `AGENTS.md.example` for a starting point for your own agent instructions.

## Notes

Keep chores about the workspace itself (skill changes, settings, tooling upkeep) in this project so its notes and progress stay separate from your own projects.
