# The memo / note / question system

Three small commands shape how knowledge flows in and out of your projects. They're plain markdown under the hood — no database, no lock-in.

## `/memo "quick thought"`

Lowest-friction capture. Drops a timestamped markdown file into an inbox (or the active project's `notes/inbox/`, depending on your setup). Use this when you don't want to decide where something belongs yet — just get it out of your head.

Good for: a link you'll read later, a bug hunch, a one-liner idea for a post.

## `/note [project-or-topic]`

Structured capture tied to a project. Creates a file in `projects/<name>/notes/` with a slug derived from the topic. If you pass a project name that's registered in `AGENTS.md`, the note lands in that project's folder; otherwise it falls back to a generic location.

Good for: meeting notes, decision records, research notes you want to find later.

## `/question "what was I doing in the auth flow last week"`

Semantic search across every `.md` file in `projectsDir`. Uses file content, not just filenames. The underlying tool (`qmd`) builds an embedding index the first time you run it and incrementally updates as files change.

Good for: "where did I write down the X tradeoff?", "what was my plan for Y?".

## How they work together

```
idea
  ↓
/memo         (dumped into the inbox)
  ↓ later, during triage:
/note         (rewritten into the right project's notes/)
  ↓ weeks later, when you've forgotten:
/question     (semantic search surfaces it)
```

No tool here is required — you can edit files directly and the panel picks them up via the file watcher. The commands just remove friction.

## Session tracking

A related pair of commands:

- `resume [project]` — at the start of a session, loads the most recent `progress/YYYY-MM-DD-*.md` so the agent picks up with full context.
- `session end` — at the end, writes a new progress file and (if configured) commits and pushes it.

The progress files are the authoritative record of what you worked on and what's left. They're what `resume` reads back.
