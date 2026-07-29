---
name: pavilio-search
description: Gather a project's accumulated context — notes, memos, progress, plans, decisions, and code where those name it — into a cited context pack. Use when the user invokes `/pavilio-search`, asks to "gather context" before writing a ticket or plan, or asks what the project knows about a topic across everything written down, not just meeting notes.
---

# Project Context Retrieval

Retrieve across everything a project has accumulated and return a **cited context pack**.
Not a prose answer — a pack the caller can turn into a ticket, a plan, or nothing.

**Announce at start:** "Using pavilio-search to gather context on <topic>."

## Scope

`/pavilio-search [project] "<question>"`. With no project, search every active project and
label results by project. Archived projects are excluded unless the user asks for them.

## Process

### 1. Refresh the index — always

Run: `bash "$(git rev-parse --show-toplevel)"/skills/pavilio-search/qmd-ensure.sh`

The repo-root form works from any directory. The script derives the projects dir from its
own location, not from the working directory, so only *finding* it depends on where you
are — and `bash skills/…` from anywhere but the repo root just fails to find the file.

Never skip this. It registers any project missing a collection, reports collections whose
path has moved, and re-indexes incrementally. Skipping it is how a search silently returns
nothing on a project nobody indexed. First run on a fresh machine downloads the local
models and cold-indexes everything — a one-off couple of minutes; say so rather than
looking hung.

If `qmd` is not installed, stop and say so. Do not fall back to grep and present the
result as a full search.

If it exits with `Refusing to run qmd update`, a collection points at a path that no
longer exists. `qmd update` crashes on those and abandons every collection after it
alphabetically, so the script stops rather than leaving a half-refreshed index. Show the
user the two remedies it printed and let them choose — repointing means indexing archived
material, which is theirs to decide:

- `bash skills/pavilio-search/qmd-ensure.sh --repoint-dead` — point them at
  `projects/archived/<name>`, keeping their indexed documents
- `qmd collection remove <name>` — drop them, deleting those documents

### 2. Retrieve

`qmd query "<question>" -c <project> --md -n 8`

Then widen **only chunks that scored**: `qmd get <file>:<line> -l 60`.

A `qmd get` can fail because the file was deleted or renamed after it was indexed. That is
information, not an error to retry: cite the hit from the query snippet, mark it
`(stale index — file no longer at <path>)`, and carry on with the other hits. Do not abandon
the pack over one dead path, and do not silently drop the hit either — a moved file often
means the answer now lives somewhere else worth finding.

Never read a folder wholesale. metro alone holds ~280 markdown files; reading them is how
a context window dies and it is the failure this skill exists to prevent.

If the top score is weak (below ~40%), say the project has little written on the topic
rather than padding the pack with near-misses.

### 3. Probe the code — only where the notes point

Read `projects/<project>/repos.json` for the repo paths. From the retrieved chunks, pull
concrete identifiers: backticked or quoted symbols, `path/like/this.ts`, PR and issue
refs. `rg` those inside the repo paths and cite `file:line`.

Skip this entirely when the notes name nothing concrete, and when the project has no
`repos.json`. Code corroborates claims the notes make; it is not an independent search,
and source files nobody wrote about do not belong in a ticket.

### 4. Emit the context pack

Sections, in this order, omitting any that is empty:

**Decisions** — hits from `DECISIONS.md` and `PROJECT.md`. First, because a decision
outranks narrative. A decision dated after a memo supersedes it.

**What's established** — one claim per line, each tagged `path · date`.

**Open questions & contradictions** — where sources disagree, show **both** with their
dates. Do not silently pick a winner. For ticket-writing this is the most valuable
section: "these two notes disagree, here are both dates" is actionable, a confident wrong
answer is not.

**Code evidence** — `file:line`, only where notes pointed.

**Sources** — paths and dates, so the caller can go deeper.

## Rules

- Cite every claim with a path. An uncited claim in the pack is a bug.
- Never write a file. The caller decides whether this becomes a ticket or a memo.
- Report gaps as gaps. A project with no `DECISIONS.md` yields no decisions section — that
  is signal, not something to paper over with inference.
- Prefer specific and recent when ranking; surface the conflict when they disagree.

## Not this skill

- **[[pavilio-question]]** answers a question in prose from `_index.json` / `PROJECT.md`
  ("who is Alex", "what's the status of X"). Use it for a quick answer about meeting
  history. Note it cannot see `memo/`, `progress/` or `plans/` at all.
- **pavilio-search** gathers a cited pack across *everything* for downstream work.
