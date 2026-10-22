---
name: pavilio-wiki
description: Query, ingest into, or lint a project's agent-maintained LLM wiki (`projects/<p>/wiki/`). Query is the default — it walks the reading ladder, answers with panel-link citations and leaves a question page; ingest runs only with the explicit `ingest` verb and turns records, files, articles, YouTube transcripts, repos or quoted snippets into source pages and knowledge pages via cheap writer subagents; `ingest knowledge` runs the knowledge harvest into the shared `knowledge` wiki. Use when the user invokes `/pavilio-wiki`, asks "what does the wiki say about …", says "ingest this into the wiki", or when note / session-start / archive-plan run a checkpoint ingest.
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
/pavilio-wiki ingest knowledge [-yolo]                    # knowledge harvest (§ 5)
/pavilio-wiki knowledge ingest <input>…                   # ordinary ingest into the knowledge project
/pavilio-wiki [project] lint                              # report only
```

`ingest knowledge` (verb first) is the harvest; `knowledge ingest` (project first) is a plain
ingest whose project happens to be `knowledge`. `/pavilio-wiki-ingest-knowledge [-yolo]` is the
shortcut for the harvest.

Every `scripts/wiki` command runs from the workspace root and prints one JSON object; exit 0 ok,
1 error, 2 ask the user.

## 1. Resolve the project

The knowledge harvest (§ 2, first rule) skips this section: its target is always `knowledge`.

1. An explicit project argument or a `<project>:` prefix wins → `scripts/wiki project --name <p>`.
2. Else a project set earlier in this conversation → pass it as `--name`.
3. Else `scripts/wiki project` (cwd, then the panel cell).
4. Exit 2 → ask which project's wiki to use, and do nothing else.

A project is any `projects/<p>/` with a `PROJECT.md`, as the panel lists them — `.projects.local.md`
is optional, and only its `## Archived Projects` rows are refused.

## 2. Pick the mode

- `ingest knowledge [-yolo]` with no project argument before the verb → **Knowledge harvest**.
- `<p> ingest knowledge …` (a project before the verb) → refuse: `knowledge` as the first word
  after `ingest` is never an ordinary input. Point at `/pavilio-wiki ingest knowledge` for the
  harvest, or `/pavilio-wiki knowledge ingest <input>…` to ingest into the knowledge project.
- First remaining word is `ingest` → **Ingest**. Only this verb ingests: paths and URLs inside a
  question are question text.
- `lint` → **Lint**.
- Anything else → **Query**.

## 3. Query

1. No `projects/<p>/wiki/` → say the project has no wiki yet, suggest `/pavilio-wiki-migrate <p>`,
   create nothing, stop.
2. Walk `CONVENTIONS.md § Reading ladder`. Enter `wiki/repos/<repo>/` only for a code question.
   Claims taken from a `kind: research` project are labelled `(research, unverified)` unless this
   project is research too (ladder step 6).
3. Answer citing every page used as a panel link — `[<title>](<link>)`, the link from
   `scripts/wiki panel-link <p>/wiki/<page>.md` (projects-relative path; a record such as
   `<p>/progress/<file>.md` gets a `/view/…` link). Never a bare path or a hand-encoded URL. If the
   wiki does not answer, say so — never fill the gap from general knowledge presented as the
   wiki's. The question page keeps D14 links (`PAGES.md § Question`).
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
| YouTube URL (`youtube.com/watch`, `youtu.be/…`) | `scripts/wiki fetch-youtube <p> <url>` → `wiki/raw/youtube-<id>.md` |
| other URL | `scripts/wiki fetch-article <p> <url>` → `wiki/raw/article-<slug>.md` |
| quoted text | verbatim to `wiki/raw/snippet-<YYYY-MM-DD>-<slug>.md` |

An in-project path that is not a record (`tasks.md`, a delta spec under `specs/`, an active
change's files, today's progress — `CONVENTIONS.md § Identity and the ledger`) is refused with
the reason before any `--only`. A raw snapshot is then a record: `pending <p> --only wiki/raw/<file>`
gives its hash. A `fetch-article` receipt with `warning` → delete that raw file, write no source
page, report the warning. `fetch-youtube` exit 2 means `uv` is missing — pass its `reason` (the
install hint) to the user and skip that URL. No `wiki/` yet → this ingest creates it; mention
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
3. **Route** — apply § Route the inputs (raw snapshots, `fetch-article`, `fetch-youtube`,
   `clone-repo`).
4. **Pending** — the routed records with their hashes. A catch-up (no inputs) takes
   `scripts/wiki pending <p>` as is: it already includes unledgered or changed top-level
   `wiki/raw/*.md` snapshots (not migration's `context-snapshot-*.md`), so a snapshot left
   unledgered by an interrupted run is retried. Nothing pending and no repo input → a catch-up
   still checks `scripts/wiki backlog <p>`: anything in `create` or `update` → skip to **Page
   writers** with it; else release, report "nothing to ingest", stop.
5. **Source writers** — one `source_writer` per record (target `wiki/sources/<kind>-<stem>.md`
   per `CONVENTIONS.md § Identity and the ledger`), in parallel, ≤10 at a time; one `repo_writer`
   (architecture mode) per cloned repo, skipped when `action: "refreshed"` left `commit` unchanged.
   `source_writer` rewrites the whole page, so when the target already exists, first capture the
   `[[knowledge:…]]` lines under its `## Knowledge`; once that writer has returned, re-append each
   with `scripts/wiki backlink <p> <source page> <target>`, where `<target>` is the link's bare
   target `wiki/<slug>` — strip the `- `, the brackets, the `knowledge:` prefix and any `|alias`,
   as harvest step 6 passes it (idempotent — a link the writer kept is left alone). A failed
   writer left the old page in place; re-append anyway.
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
stayed after the re-run, failures, warnings. It always ends with the harvest age from
`scripts/wiki harvest-status` (`daysAgo` null → `never`; `waiting` → M):

```
Knowledge harvest: last run N days ago, M candidates waiting — /pavilio-wiki-ingest-knowledge
Knowledge harvest: last run never, M candidates waiting — /pavilio-wiki-ingest-knowledge
```

A checkpoint caller (note, session-start, archive-plan) gets the same report in one line, the
harvest line included.

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

## 5. Knowledge harvest

Moves generic findings from every project's `## Knowledge candidates` into topic knowledge pages
of the shared `knowledge` project, linked both ways. Run only when the user asks
(`/pavilio-wiki ingest knowledge [-yolo]` or `/pavilio-wiki-ingest-knowledge [-yolo]`); nothing
moves on its own. Selection is the promotion: the ≥2-source rule does not apply here.

1. **Target** — no `projects/knowledge/` → `scripts/project new knowledge --kind knowledge`
   (creates `PROJECT.md` with `kind: knowledge` and the `wiki/` skeleton). Then
   `scripts/wiki lock take knowledge --session <id>` as in § Ingest; `held: false` → stop.
2. **Candidates** — `scripts/wiki candidates` → `items` (`id`, `project`, `text`, `date`,
   `source`: the origin `wiki/sources/…` page or null) from every non-archived wiki except
   `knowledge`, research projects included. None → release, report "no candidates", stop.
3. **Prefilter + cluster** — cheap writers (`writerModel`, inputs inline, ≤150 items per chunk)
   drop what is not generic (business or client claims, project-specific facts), merge duplicates
   across projects into clusters, and give each cluster a subject (tool / library / platform /
   technique) and a count: distinct origin source pages. Every item id ends in exactly one cluster
   or the dropped list — check that before going on.
4. **Pick** —
   - *Manual (default):* numbered clusters grouped by subject, pages of ~30 (`text`, count,
     origin projects). The user replies with numbers or ranges (`3, 7, 12-15`), `next` for the
     next page, or `done`. Clusters shown and not picked are skipped.
   - *`-yolo`:* before anything is written, show how many clusters meet each threshold:

     | Threshold | Clusters |
     |---|---|
     | ≥2 | 41 |
     | ≥3 | 17 |
     | ≥4 | 9 |
     | ≥5 | 4 |

     (counts illustrative). The user picks one; that batch is taken without per-item picking.
     For the rest the user chooses: drop it, or continue into manual mode with what is left.
5. **Page writers** — one `page_writer` per subject in knowledge-wiki mode
   (`agents/page_writer.md § Knowledge-wiki mode`), given the slug (`entities/<name>` for a tool,
   library or platform, `concepts/<name>` for a technique — reuse an existing `knowledge` page or
   alias first), the picked claims and their origins as `<project>:wiki/sources/<page>.md`.
   ≤10 in parallel, never two on one page.
6. **Back-link** — only after that subject's writer returned a valid receipt, for every picked
   item of it with a `source`: `scripts/wiki backlink <project> <source> wiki/<slug>`
   (idempotent; adds `- [[knowledge:wiki/<slug>]]` under the source page's `## Knowledge`). A
   failed writer's items get no back-link.
7. **Clear** — write every id the harvest saw (picked, skipped and dropped) except the items of a
   failed page writer to a JSON array file and run `scripts/wiki clear-candidates --ids
   <file.json>`; `removed` must equal the number of ids in that file. A failed writer's items
   stay as candidates for the next harvest.
8. **Index + overview** — `scripts/wiki index knowledge`, an `overview_writer` when pages changed,
   `index` again (exit 1 → stop before the commit, as in § Ingest).
9. **Log** — append the harvest entry to `knowledge/wiki/log.md` (`PAGES.md § log.md`) listing
   picked, skipped and dropped items with their origin project.
10. **Commit** — one commit for the whole harvest: `git add projects/knowledge` plus every
    origin project's `wiki/open-questions.md` and back-linked source pages, message
    `knowledge: wiki harvest <n> picked`. Then `lock release`.

Report: clusters picked / skipped / dropped, knowledge pages created/updated, back-links added,
failures — each failed writer's subject, its items left as candidates (steps 6–7).

Steps 6–7 edit other projects' `open-questions.md` and source pages while holding only the
`knowledge` lock, not those projects' ingest locks. An ingest or query running in an origin project
at the same time can race on those files (a lost candidate line or back-link); run the harvest
when no other wiki session is writing.

## 6. Lint

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
- Does not move knowledge candidates on its own — only the user-run harvest (§ 5) does.
- Does not commit `wiki/.ingest.lock` or `wiki/raw/repos/` clones.
