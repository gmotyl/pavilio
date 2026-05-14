# resume.md (legacy)

The behavior previously described here has been split into two skills under [`../skills/`](../skills/):

- [`resume-session`](../skills/resume-session/SKILL.md) — `resume [project]`, `/resume-session [project] [task]`. Loads progress + PROJECT.md + CURRENT.md, opens the session progress file, and enters the [[grill-with-docs]] → [[writing-plans]] → [[executing-plans]] → [[test-driven-development]] workflow.
- [`end-session`](../skills/end-session/SKILL.md) — `/end-session`, "session end", "end session". Verifies the in-session progress file, commits + pushes, and proposes Todoist follow-ups.

## Codebase exploration

Use the `context-mode` MCP for any codebase exploration or large-output operation: `mcp__plugin_context-mode_context-mode__ctx_search`, `ctx_execute`, `ctx_execute_file`. If it is not installed, prompt the user to install it from <https://github.com/mksglu/context-mode> and run `/context-mode:ctx-doctor` to verify. Avoid `ls`/`find`/glob browsing for structural exploration.

## Standup preparation

The `standup [project]` variant from the old version is not yet ported to a skill. If you need it, ask and one will be extracted.
