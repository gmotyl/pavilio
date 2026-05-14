# Commands directory (legacy)

Project commands have moved to [`../skills/`](../skills/). Each skill is its own folder with a `SKILL.md` (YAML frontmatter + body).

This directory still holds a few standalone slash-command markdowns (`czytaj.md`, `end-session.md`, `qmd-setup.md`, `resume.md`, `tempo.md`) and integration folders (`slack/`, `tts-with-edge/`).

## Skills index

See [`../skills/`](../skills/):

**Project skills** — installed into `.claude/commands/` by `pnpm setup:claude-code`:

- [`memo`](../skills/memo/SKILL.md) — quick capture
- [`note`](../skills/note/SKILL.md) — meeting/transcript processing
- [`question`](../skills/question/SKILL.md) — project knowledge search
- [`bootstrap`](../skills/bootstrap/SKILL.md) — initialize `PROJECT.md` + `_index.json`
- [`resume-session`](../skills/resume-session/SKILL.md) — resume a project; opens the in-session progress file
- [`end-session`](../skills/end-session/SKILL.md) — verify progress, commit + push, propose Todoist tasks

**Workflow skills** — read directly when starting non-trivial work:

- [`grill-with-docs`](../skills/grill-with-docs/SKILL.md) — design review against domain docs
- [`writing-plans`](../skills/writing-plans/SKILL.md) — produce a plan document
- [`executing-plans`](../skills/executing-plans/SKILL.md) — execute plans with review checkpoints
- [`test-driven-development`](../skills/test-driven-development/SKILL.md) — red-green-refactor
