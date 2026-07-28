---
name: pavilio-session-end
description: Verify session progress is captured and finalize the session. Use when the user invokes `/pavilio-session-end`, says "session end" / "end session", or signals they're stopping work for now. Progress notes are written *continuously* during the session via [[pavilio-session-start]] — `/pavilio-session-end` is a verification + commit step, not the moment when context is first dumped.
---

# Pavilio Session End

Verify that the session's important context, decisions, and next steps are persisted, then commit + push and (optionally) create follow-up Todoist tasks.

## Mental model

**Progress is written as you go, not at the end.** (`<root>` below is the workspace repo root — `git rev-parse --show-toplevel`; project folders live in its `projects/` subdir, so notes are at `<root>/projects/<name>/`. Never collapse the `projects/projects` nesting.) When [[pavilio-session-start]] runs (or as soon as a project is established for the conversation), open a `<root>/projects/[project]/progress/[date]-slug.md` file and append to it throughout the session:

- decisions made + their rationale
- problems hit + how they were resolved (or left unresolved)
- next steps and blockers as they emerge
- context that would not be obvious from the diff alone

`/pavilio-session-end` is the **verification + commit** step. The bulk of the writing should already exist by the time it runs.

## Usage

- `/pavilio-session-end [project]` — end session for a project (optional if set via [[pavilio-session-start]] this conversation)
- `/pavilio-session-end` — reuse project from the current session

## Behavior

**Project resolution:**
- If `[project]` is provided, use it
- If omitted, reuse the project set by [[pavilio-session-start]] earlier in this conversation
- If neither applies, ask: "Which project are you ending the session for?" and wait for reply

**Then:**

1. **Locate the in-progress file** for this session: `<root>/projects/[project]/progress/[date]-slug.md`. If it does not exist (no session-start ran, or progress was never opened), create it now with all the context from this conversation.
2. **Verify completeness** — re-read the file and the conversation, and add anything missing:
   - Context of tasks completed this session
   - Results / outcomes achieved
   - Next steps or blockers discovered
   - Anything a future session would need to pick up smoothly
   - Do NOT duplicate info already in `PROJECT.md` or `AGENTS.md` — focus on what's unique to this session
   - **At the end, add or refresh a `## Notatka` section** — a narrative paragraph in Polish, casual blog-like tone for Greg. Summarize what happened as a story: what we set out to do, what problems we hit, how we solved them, where things stand now. 4–8 sentences, natural and readable.
3. **Rename the file if its slug is still `wip`** — a backstop for a session that never renamed it. `wip` means "theme unknown", so a file with content and a `wip` slug is unfinished bookkeeping, not a valid name. Derive the slug from what the file actually says (max 4 words, kebab-case) and rename before committing:
   ```bash
   cd <root> && git mv projects/[project]/progress/[date]-wip.md \
                      projects/[project]/progress/[date]-<real-slug>.md
   ```
   Use `git mv` when the file is tracked (the hourly auto-sync commits progress files, so it usually is), a plain `mv` otherwise. Say which name you chose in one line. Only ever rename **today's** file — earlier days are closed records. If the session genuinely produced nothing worth naming, leave `wip` and say so.
4. **Commit and push** the progress file to the projects repo. Commit message: `session: [project] [date]-[description]`. Only commit progress files, not full project notes (respect `.gitignore`).
5. **Propose Todoist tasks** for remaining work in the format `[project-name] Task description`. Wait for explicit approval before adding any.
6. Clear context and start a new session.

## Rules

- The progress file is **append-only during a session, single-file**. Don't create a fresh file at end if one already exists for today's session — append/refresh it.
- Slug should reflect the main session theme (max 4 words, kebab-case). `wip` is a placeholder only — rename it (step 3) rather than committing a `-wip.md` file that has real content.
- Never auto-add Todoist tasks without explicit user approval.
- Only commit progress files. Other project notes stay local.
- Save only relevant information — context that helps resume the session, not a transcript.
