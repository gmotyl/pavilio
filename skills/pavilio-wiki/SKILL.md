---
name: pavilio-wiki
description: Query, ingest into, or lint a project's agent-maintained LLM wiki (`projects/<p>/wiki/`). Query is the default — it walks the reading ladder, answers with citations and leaves a question page; ingest runs only with the explicit `ingest` verb and turns records, files, articles, repos or quoted snippets into source pages and knowledge pages via cheap writer subagents. Use when the user invokes `/pavilio-wiki`, asks "what does the wiki say about …", says "ingest this into the wiki", or when note / session-start / archive-plan run a checkpoint ingest.
---

# Pavilio Wiki

Orchestrator for one project's wiki. The main session resolves, routes, runs the deterministic
`scripts/wiki` commands and spawns writers; it never writes source or knowledge pages itself.

Layout, slugs, ledger, write regimes, link syntax and the reading ladder:
`skills/pavilio-wiki/CONVENTIONS.md` (read it before the first write of a run). Page shapes:
`skills/pavilio-wiki/PAGES.md`. Writers: `skills/pavilio-wiki/agents/*.md`.

## Usage

```
/pavilio-wiki [project | <project>:] "<question>"        # query (default)
/pavilio-wiki [project] ingest [<input>…]                 # ingest; no inputs = all pending records
/pavilio-wiki [project] lint                              # report only
```

Every `scripts/wiki` command runs from the workspace root and prints one JSON object; exit 0 ok,
1 error, 2 ask the user.

## 1. Resolve the project

1. An explicit project argument or a `<project>:` prefix wins → `scripts/wiki project --name <p>`.
2. Else a project set earlier in this conversation → pass it as `--name`.
3. Else `scripts/wiki project` (cwd, then the panel cell).
4. Exit 2 → ask which project's wiki to use, and do nothing else.

A project is any `projects/<p>/` with a `PROJECT.md`, as the panel lists them — `.projects.local.md`
is optional, and only its `## Archived Projects` rows are refused.

## 2. Pick the mode

- First remaining word is `ingest` → **Ingest**. Only this verb ingests: paths and URLs inside a
  question are question text.
- `lint` → **Lint**.
- Anything else → **Query**.

## 3. Query

1. No `projects/<p>/wiki/` → say the project has no wiki yet, suggest `/pavilio-wiki-migrate <p>`,
   create nothing, stop.
2. Walk `CONVENTIONS.md § Reading ladder`. Enter `wiki/repos/<repo>/` only for a code question.
3. Answer with D14 citations to the pages used. If the wiki does not answer, say so — never fill
   the gap from general knowledge presented as the wiki's.
4. `scripts/wiki lock take <p> --session <id>` (session id as in § Ingest). `held: false` → give
   the answer, say the trace was not written because an ingest is running, stop.
5. Write (see `PAGES.md` for shapes):
   - always `wiki/questions/<YYYY-MM-DD>-<slug>.md`;
   - a `wiki/notes/` page only when the answer cited ≥2 wiki pages or the user asks to save it —
     enrich the existing note on that topic in place rather than adding a second one;
   - each gap, and each knowledge page found wrong or stale, as an item under `## Gaps` in
     `wiki/open-questions.md`;
   - one query entry in `wiki/log.md`.
6. Code question the repo pages do not answer, with the clone present in `wiki/raw/repos/` →
   run `repo_writer` in question mode (a new repo note).
7. Never edit any existing page under `entities/`, `concepts/`, `repos/`, `sources/`, or
   `overview.md` from a query; the only repo write is the new question-mode note.
8. `scripts/wiki index <p>`. Exit 1 → no commit; report `error` and `page`, release, stop.
9. Commit `projects/<p>/wiki` as `<p>: wiki query <slug>`, then `lock release`.

## 4. Ingest

### Route the inputs

| Input | Becomes |
|---|---|
| none | every pending record, unledgered top-level `wiki/raw/*.md` snapshots included (not `context-snapshot-*.md`) (`scripts/wiki pending <p>`) |
| path inside `projects/<p>/` | cited in place — `pending <p> --only <path>`, path project-relative (`notes/<file>.md`, `plans/openspec/changes/archive/<id>/proposal.md`) |
| path outside the workspace, or a workspace path outside every `projects/<p>/` (e.g. `skills/…`) | outside path — verbatim copy to `wiki/raw/<slug>.md` |
| path in another project | stop; suggest ingesting into that project's wiki |
| repo URL (`<forge>/<owner>/<repo>`, `.git`) | `scripts/wiki clone-repo <p> <url>` → `repo_writer` (architecture mode) |
| other URL | `scripts/wiki fetch-article <p> <url>` → `wiki/raw/article-<slug>.md` |
| quoted text | verbatim to `wiki/raw/snippet-<YYYY-MM-DD>-<slug>.md` |

An in-project path that is not a record (`tasks.md`, a delta spec under `specs/`, an active
change's files, today's progress — `CONVENTIONS.md § Identity and the ledger`) is refused with
the reason before any `--only`. A raw snapshot is then a record: `pending <p> --only wiki/raw/<file>`
gives its hash. A `fetch-article` receipt with `warning` → delete that raw file, write no source
page, report the warning. No `wiki/` yet → this ingest creates it; mention
`/pavilio-wiki-migrate <p>` for the backfill. More than 10 pending on a user-invoked catch-up →
show the count and confirm first.

### Sequence

Pick one session id for the whole run (harness session id, else `$PAVILIO_TERMINAL_ID`, else
`<hostname>-<epoch>`). Read `scripts/wiki config` once for `writerModel`.

1. **Gitignore** — ensure `wiki/.gitignore` lists `.ingest.lock*` and `raw/repos/`.
2. **Lock** — `scripts/wiki lock take <p> --session <id>`. `busy: true` → retry once after a few
   seconds. `held: false` → say another session is
   ingesting and stop without writing. `takenOver: true` → note it for the log entry. Nothing
   is written to `raw/` before this step.
3. **Route** — apply § Route the inputs (raw snapshots, `fetch-article`, `clone-repo`).
4. **Pending** — the routed records with their hashes. A catch-up (no inputs) takes
   `scripts/wiki pending <p>` as is: it already includes unledgered or changed top-level
   `wiki/raw/*.md` snapshots (not migration's `context-snapshot-*.md`), so a snapshot left
   unledgered by an interrupted run is retried. Nothing pending and no repo input → a catch-up
   still checks `scripts/wiki backlog <p>`: anything in `create` or `update` → skip to **Page
   writers** with it; else release, report "nothing to ingest", stop.
5. **Source writers** — one `source_writer` per record (target `wiki/sources/<kind>-<stem>.md`
   per `CONVENTIONS.md § Identity and the ledger`), in parallel, ≤10 at a time; one `repo_writer`
   (architecture mode) per cloned repo, skipped when `action: "refreshed"` left `commit` unchanged.
6. **Backlog** — `scripts/wiki backlog <p> --touched <slug>,<slug>,…` — every namespaced slug
   from the receipts, comma-separated. Run it only after every source writer has returned. A
   catch-up (no inputs) drops `--touched`, so it also pays what earlier runs left owed.
7. **Page writers** — one `page_writer` per slug in `create` and `update`, given the slug, the
   source pages the backlog lists for it (already project-root `wiki/sources/…` paths) and the
   slug's `CONTEXT.md` glossary line when it has one. More than 12 sources for one slug → split
   them into chunks of ≤12 and run that slug's writers one after another, never two on the same
   page at once. Slugs in `waiting` are reported as "waiting for a second mention".
   Then re-run the same `backlog` command once every writer has returned: a slug still listed
   means its writer failed or edited nothing — re-run that writer once, then report it. Never
   commit while a writer is still running; its edit would land in the next commit unrecorded.
8. **Index** — `scripts/wiki index <p>`, so the overview sees this run's pages. Exit 1 → stop
   here: no ledger, no commit; report `error` and `page`, release the lock.
9. **Overview** — one `overview_writer` when any knowledge page was created or updated, then
   `scripts/wiki index <p>` again (same exit-1 rule).
10. **Record** — `scripts/wiki record <p> <path> <hash>` for each record whose source page landed
    (repo pages carry `commit` instead).
11. **Log** — append the ingest entry (`PAGES.md § log.md`); append every `generic:` finding under
    `## Knowledge candidates` in `wiki/open-questions.md`, every `contradictions` item under
    `## Gaps`, and every `collisions` item under `## Gaps` prefixed `Term collision:` (one word,
    two meanings — a glossary `_Avoid_` note or a rename settles it).
12. **Commit** — `git add projects/<p>/wiki` and commit `<p>: wiki ingest <n> records` right away;
    nothing else from the working tree.
13. **Release** — `scripts/wiki lock release <p> --session <id>`, also on every early stop after
    step 2.

Report: source pages written, knowledge pages created/updated, slugs waiting, slugs whose backlog
stayed after the re-run, failures, warnings.
A checkpoint caller (note, session-start, archive-plan) gets the same report in one line.

### Writers

Spawn each writer with its agent file as instructions plus its inputs; never hand it more than the
file allows. Claude Code: Agent tool with `model: <writerModel>`; other harnesses: their small-model
tier. Each writer returns exactly one JSON receipt.

Inputs go **inline in the prompt** as a short `key: value` list (a glossary line quoted) — never
written to a file the writer is told to read first. "Read this file, it holds your instructions"
is the shape of a prompt injection, and Claude Code's auto-mode classifier blocks such launches.
The prompt names the agent file to follow and the inputs; nothing else:

```
You are the `page_writer` wiki writer. Workspace root: <root>; project paths are relative to
projects/<p>/. Read skills/pavilio-wiki/agents/page_writer.md and follow it exactly. Today is
<YYYY-MM-DD>. Do not run git. Reply with exactly one JSON receipt and nothing else.

Inputs:
- project: <p>
- slug: concepts/relay
- sources: wiki/sources/progress-2026-10-19-tts-relay-node20.md
- glossary: "Relay — the panel server's synthesis endpoint … See wiki/concepts/relay."
```

### Errors

- Receipt missing or not JSON → re-run that writer once → still not JSON: log `failed: <path>`,
  no ledger entry for that record, continue with the rest.
- `index` exit 1 → stop before record and commit (steps 8–9).
- Stale lock taken over → `lock: taken over from <session>` in the log entry.
- Fetch warning → no source page, reported.
- Any `scripts/wiki` exit 1 → report its `error`, release the lock, stop.

## 5. Lint

`scripts/wiki lint <p>` and present the six groups (`broken`, `orphans`, `malformed`, `untyped`,
`stale`, `codeIdentifiers`) with page paths and one remedy each — malformed frontmatter (the YAML
error is given) is fixed by re-running that page's writer or quoting the offending value
(`PAGES.md § Common frontmatter`), stale pages are refreshed by the next ingest, code identifiers
move to `wiki/repos/<repo>/` on the next page write. Also run `scripts/wiki backlog <p>`: a
`broken` target listed under `create` gets its page from the next ingest; any other broken target
is fixed by turning the link into plain text (`CONVENTIONS.md § Links`). A long `update` list means
page writers fell behind — the next ingest catches up. Lint writes nothing and this skill does not
fix the findings in the same run.

## Non-goals

- Does not write `CONTEXT.md` — archive-plan and migrate own it.
- Does not backfill a whole project — that is `/pavilio-wiki-migrate`.
- Does not ingest from a query, or create a wiki from a query.
- Does not hand-edit `index.md` files — `scripts/wiki index` regenerates them.
- Does not commit `wiki/.ingest.lock` or `wiki/raw/repos/` clones.
