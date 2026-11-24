---
name: pavilio-wiki
description: Query, ingest into, or lint a project's agent-maintained LLM wiki (`projects/<p>/wiki/`). Query is the default — it walks the reading ladder, answers with panel-link citations and leaves a question page; ingest runs only with the explicit `ingest` verb and turns records, files, articles, YouTube transcripts, repos or quoted snippets into source pages and knowledge pages via cheap writer subagents; `ingest knowledge` runs the knowledge harvest into the shared `knowledge` wiki and each group's wiki. Use when the user invokes `/pavilio-wiki`, asks "what does the wiki say about …", says "ingest this into the wiki", or when note / session-start / archive-plan run a checkpoint ingest.
---

# Pavilio Wiki

Orchestrator for one project's wiki. The main session resolves, routes, runs the deterministic
`scripts/wiki` commands and spawns writers; it never writes source or knowledge pages itself.

Layout, slugs, ledger, write regimes, link syntax and the reading ladder:
`skills/pavilio-wiki/CONVENTIONS.md` (read it before the first write of a run). Page shapes:
`skills/pavilio-wiki/PAGES.md`. Writers: `skills/pavilio-wiki/agents/*.md`.

**Reading a `scripts/wiki` failure.** Every command prints one JSON object on stdout; that is how
a wiki result is told apart from a launcher that never started:

- **Non-zero exit with a JSON `error` on stdout → a wiki error.** Every "exit 1 → stop" in this
  skill means this case: report the `error`, release the lock, stop.
- **Non-zero exit with no JSON on stdout → the CLI never ran** — typically the sandbox refusing
  tsx's IPC pipe (`listen EPERM … tsx-…pipe` on stderr), or a killed or timed-out process. Nothing
  in the wiki changed. Re-run the *same* command once through another executor (e.g. Bash with
  the sandbox disabled, or context-mode's `ctx_execute` shell) and carry on with its result. Fails
  the same way there too → report the stderr line and stop; never work around the CLI by hand.

## Usage

```
/pavilio-wiki [project | <project>:] "<question>"        # query (default)
/pavilio-wiki [project] ingest [<input>…]                 # ingest; no inputs = all pending records
/pavilio-wiki ingest knowledge [-yolo | --min <n>]        # knowledge harvest (§ 5)
/pavilio-wiki knowledge ingest <input>…                   # ordinary ingest into the knowledge project
/pavilio-wiki [project] lint                              # report only
```

`ingest knowledge` (verb first) is the harvest; `knowledge ingest` (project first) is a plain
ingest whose project happens to be `knowledge`. `/pavilio-wiki-ingest-knowledge` is the
shortcut for the harvest (it runs `--min 3` by default).

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

- `ingest knowledge [-yolo | --min <n>]` with no project argument before the verb → **Knowledge harvest**.
- `<p> ingest knowledge …` (a project before the verb) → refuse: `knowledge` as the first word
  after `ingest` is never an ordinary input. Point at `/pavilio-wiki ingest knowledge` for the
  harvest, or `/pavilio-wiki knowledge ingest <input>…` to ingest into the knowledge project.
- First remaining word is `ingest` → **Ingest**. Only this verb ingests: paths and URLs inside a
  question are question text.
- `lint` → **Lint**.
- Anything else → **Query**.

## 3. Query

1. No `projects/<p>/wiki/` → say the project has no wiki yet, suggest `/pavilio-wiki-migrate <p>`,
   create nothing, stop. Otherwise read `wiki_language` from `projects/<p>/PROJECT.md` (see
   § Writers → Language) before composing the answer and pass it to any writer you spawn.
2. Walk `CONVENTIONS.md § Reading ladder`. Enter `wiki/repos/<repo>/` only for a code question.
   Claims taken from a `kind: research` project are labelled `(research, unverified)` unless this
   project is research too (ladder step 6). A grouped project reads its group wiki (step 6b)
   before the shared `knowledge` wiki (step 7), citing `<group-wiki>:wiki/…`.
3. Answer citing every page used as a panel link — `[<title>](<link>)`, the link from
   `scripts/wiki panel-link <p>/wiki/<page>.md` (projects-relative path; a record such as
   `<p>/progress/<file>.md` gets a `/view/…` link). Never a bare path or a hand-encoded URL. If the
   wiki does not answer, say so — never fill the gap from general knowledge presented as the
   wiki's. The question page keeps D14 links (`PAGES.md § Question`).
   An answer that describes a lifecycle, a decision rule, an ordering between actors or a map
   adds one mermaid diagram (`CONVENTIONS.md § Diagrams`); a single fact or a short list gets
   none. The same diagram goes in the answer shown to the user and in the question page. Sources
   that disagree are drawn as separate paths, each labelled with its source — never reconciled.
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
   run `repo_writer` in question mode (a new repo note), passing the clone's `url` as ingest
   step 5 derives it.
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
| any `*.atlassian.net` URL (Confluence `/wiki/…`, Jira `/browse/…`, `selectedIssue=` links, boards…) | § Atlassian fetch → `wiki/raw/confluence-<id>-<slug>.md` / `jira-<KEY>.md` |
| any other URL | `scripts/wiki fetch-article <p> <url>` → `wiki/raw/article-<slug>.md` |
| quoted text | verbatim to `wiki/raw/snippet-<YYYY-MM-DD>-<slug>.md` |

An in-project path that is not a record (`tasks.md`, a delta spec under `specs/`, an active
change's files, today's progress — `CONVENTIONS.md § Identity and the ledger`) is refused with
the reason before any `--only`. A raw snapshot is then a record: `pending <p> --only wiki/raw/<file>`
gives its hash. A `fetch-article` receipt with `warning` → write no source page, report the
warning, and delete `wiki/<raw>` only when `raw` is non-empty — an empty `raw` (Atlassian host,
also after a redirect) means nothing was written, so there is nothing to delete.
`fetch-youtube` exit 2 means `uv` is missing — pass its `reason` (the install hint) to the user
and skip that URL. An Atlassian URL never goes to `fetch-article` (it refuses the host with a
`warning`). No `wiki/` yet → this ingest creates it; mention
`/pavilio-wiki-migrate <p>` for the backfill. More than 10 pending on a user-invoked catch-up →
show the count and confirm first.

### Atlassian fetch

Confluence and Jira come through the agent's Atlassian MCP; the CLI only saves what it fetched.
Per URL:

1. **Pick the server.** Tool names differ per agent (Claude Code `mcp__atlassian-infopoly__…` /
   `mcp__claude_ai_Atlassian__…`, opencode `atlassian-infopoly_…`, codex: check its tool list
   for the server name) — match on the server part. Order: `atlassian-<project>` → any Atlassian
   server whose `getAccessibleAtlassianResources` lists the URL host → none. A server answering
   with an auth error counts as none.
2. **None** → skip this URL, tell the user which server to connect or authenticate (Claude Code:
   `/mcp`), never fall back to `fetch-article`, continue with the other inputs.
3. **Resolve** the Confluence page id (a space `overview` URL → the space home page; a tiny link →
   its page) or the Jira issue key (a board with `selectedIssue=` → that issue), and build the
   canonical URL: `https://<host>/wiki/spaces/<space>/pages/<id>` / `https://<host>/browse/<KEY>`.
   A URL that names no single page or issue (a board, a filter) → report it and skip it.
4. **Fetch** as markdown — Confluence: body, comments (author, date, text), attachment names and
   types; Jira: summary, description, status, assignee, links, comments.
5. **Save** — the body is piped on stdin (a terminal stdin is refused):

   ```sh
   scripts/wiki save-atlassian <p> <canonical-url> --title "<t>" \
     --meta status=… --meta parent_id=… --meta last_modified=… <<'EOF'
   <markdown body from step 4>
   EOF
   ```

   → `{raw, title, replaced?}`; a `warning` comes with exit 1 and nothing written (step 7). A
   re-fetch overwrites (the id is the identity), `replaced` names a removed old-slug file — the
   existing `sources/confluence-<id>.md` is rewritten with the new `raw:`, never a second page
   (`CONVENTIONS.md § Identity and the ledger`). Exit 2 `{ask, reason}` (no page id / issue key
   in the URL — the step 3 resolution was skipped or failed) → resolve it through the MCP and
   retry once with the canonical URL; still exit 2 → report the URL, skip it.
6. **Children** — Confluence only: direct children, one level; more than 20 → show the count and
   confirm first. Each child goes through steps 3–5. Linked Jira issues are not fetched.
7. A receipt with `warning` (exit 1; stub guard: empty or login-page body; nothing written) → no
   source page, report it. A cross-site collision (`raw/` already holds that id or key from another
   Atlassian site, or a snapshot with no readable `source_url`; nothing written or removed) →
   report the URL and the warning, don't ingest it.

### Sequence

Pick one session id for the whole run (harness session id, else `$PAVILIO_TERMINAL_ID`, else
`<hostname>-<epoch>`). Read `scripts/wiki config` once for `writerModel`.
Resolve the group once: `group:` from `projects/<p>/PROJECT.md` frontmatter (trimmed; missing or
empty → ungrouped). A project that is itself a group wiki (`kind: knowledge` with `group:`) counts
as ungrouped — no `group` / `members` inputs, no `## Group candidates`. Grouped → `members` =
every `projects/*/PROJECT.md` (not `archived/`) whose trimmed `group:` equals it, minus
`kind: knowledge` cards (group wikis).

1. **Gitignore** — ensure `wiki/.gitignore` lists `.ingest.lock*` and `raw/repos/`.
2. **Lock** — `scripts/wiki lock take <p> --session <id>`. `busy: true` → retry once after a few
   seconds. `held: false` → say another session is
   ingesting and stop without writing. `takenOver: true` → note it for the log entry. Nothing
   is written to `raw/` before this step.
3. **Route** — apply § Route the inputs (raw snapshots, `fetch-article`, `fetch-youtube`,
   § Atlassian fetch, `clone-repo`).
4. **Pending** — the routed records with their hashes. A catch-up (no inputs) takes
   `scripts/wiki pending <p>` as is: it already includes unledgered or changed top-level
   `wiki/raw/*.md` snapshots (not migration's `context-snapshot-*.md`), so a snapshot left
   unledgered by an interrupted run is retried. Nothing pending and no repo input → a catch-up
   still checks `scripts/wiki backlog <p>`: anything in `create` or `update` → skip to **Page
   writers** with it; else release, report "nothing to ingest", stop.
5. **Source writers** — one `source_writer` per record (target `wiki/sources/<kind>-<stem>.md`
   per `CONVENTIONS.md § Identity and the ledger`), in parallel, ≤10 at a time; one `repo_writer`
   (architecture mode) per cloned repo, skipped when `action: "refreshed"` left `commit` unchanged.
   Grouped project → pass each `source_writer` `group` and `members`; ungrouped → pass neither.
   For external material, hand the writer its original `url` (`PAGES.md § Common frontmatter`):
   an article/YouTube/Atlassian raw file's `source_url` frontmatter, a clone's `git -C <clonePath>
   remote get-url origin` normalised by its form — a GitHub origin →
   `https://github.com/<owner>/<repo>` (no `.git`); another https origin → as-is minus `.git`;
   scp-like `user@host:<owner>/<repo>` → `https://host/<owner>/<repo>`; any other
   `scheme://host/<owner>/<repo>` (`ssh://`, `http://`, `git://`) → `https://host/<owner>/<repo>`;
   a local path or `file://` origin → no `url`. Strip any userinfo (`user:token@`) from the origin
   — never write credentials onto a page. None → pass no `url`; never guess one (never fabricate a
   GitHub URL for a non-GitHub or local clone).
   `source_writer` rewrites the whole page, so when the target already exists, first capture the
   `[[<target>:…]]` lines under its `## Knowledge` (`knowledge:` or a group wiki's name); once
   that writer has returned, re-append each with `scripts/wiki backlink --keep <p> <source page>
   <target>:wiki/<slug>` — strip the `- `, the brackets and any `|alias`, as harvest step 7 passes
   it (idempotent — a link the writer kept is left alone). `--keep` skips the knowledge-target
   check (the link was validated when the harvest wrote it), so a link to an archived or renamed
   wiki, or one written in an ambiguous workspace, survives the rewrite. A failed writer left the
   old page in place; re-append anyway.
   **Glossary check** — for each record with a `## Glossary` section (an archived `design.md`),
   once its writer has returned: every term there must be among the receipt's `slugs` as
   `concepts/<slug>`, `<slug>` taken from the term's `CONTEXT.md` line (`See [[wiki/concepts/<slug>]]`).
   A missing one → add the bare slug to that source page's `concepts:` and `concepts/<slug>` to the
   receipt's slugs before step 6; the writer missing it would leave the glossary link dead.
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
    `## Knowledge candidates` in `wiki/open-questions.md`; grouped project → every `group:` finding
    under `## Group candidates`. Each item is one plain dated bullet,
    `- YYYY-MM-DD — <finding> (from [[wiki/sources/<slug>]])` (`PAGES.md § Open questions`), with
    no `generic:` / `group:` prefix: the harvest reads the date only from the start of the bullet,
    so a prefix loses it and a group candidate never expires (§ 5 step 4). The section is added after
    `## Knowledge candidates` when missing (ungrouped → never write it, ignore `group:` items);
    every `contradictions` item under `## Gaps`, and every `collisions` item under `## Gaps`
    prefixed `Term collision:` (one word, two meanings — a glossary `_Avoid_` note or a rename
    settles it). Before appending a contradiction, drop it when its own text says it was settled,
    superseded, reconciled or that the page states what holds now (`agents/page_writer.md` reports
    only open ones), and when
    `## Gaps` already has an item on the same question — append the new page's link to that item
    instead of adding a second one. `## Gaps` is read by a person; every item must need one.
12. **Commit** — `git add projects/<p>/wiki` and commit `<p>: wiki ingest <n> records` right away;
    nothing else from the working tree.
13. **Release** — `scripts/wiki lock release <p> --session <id>`, also on every early stop after
    step 2.

Report: source pages written, knowledge pages created/updated, slugs waiting, slugs whose backlog
stayed after the re-run, failures, warnings. It always ends with the harvest age from
`scripts/wiki harvest-status` (`daysAgo` null → `never`; `waiting` → M, both scopes;
`waitingGroup` → G, the ` (G group)` part only when `waitingGroup > 0`):

```
Knowledge harvest: last run N days ago, M candidates waiting (G group) — /pavilio-wiki-ingest-knowledge
Knowledge harvest: last run N days ago, M candidates waiting — /pavilio-wiki-ingest-knowledge
Knowledge harvest: last run never, M candidates waiting — /pavilio-wiki-ingest-knowledge
```

A checkpoint caller (note, session-start, archive-plan) gets the same report in one line, the
harvest line included.

### Writers

Spawn each writer with its agent file as instructions plus its inputs; never hand it more than the
file allows. Claude Code: Agent tool with `model: <writerModel>`; other harnesses: their small-model
tier. Each writer returns exactly one JSON receipt.

**Language.** Read `wiki_language` from the project's `PROJECT.md` frontmatter once per run and pass it as `language:` to every writer; absent → English, no `language:` line. Resolve it for the project you are working on (the target for a harvest). Query answers and `wiki/questions/` pages are written in that language too (links, slugs and keys stay as they are).

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
- language: Polish        # only when the project's PROJECT.md frontmatter has `wiki_language`
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
- Any `scripts/wiki` exit 1 with a JSON `error` → report it, release the lock, stop. No JSON on
  stdout → the launcher failed, not the wiki: retry once through another executor (§ Reading a
  `scripts/wiki` failure).

## 5. Knowledge harvest

Moves findings from every project's candidates into topic knowledge pages, linked both ways:
generic findings (`## Knowledge candidates`) into the shared `knowledge` project, group-scoped
findings (`## Group candidates`) into their group's wiki — the `kind: knowledge` project whose
`group:` is that group. Run only when the user asks
(`/pavilio-wiki ingest knowledge [-yolo | --min <n>]` or `/pavilio-wiki-ingest-knowledge`); nothing
moves on its own. Generic: selection is the promotion, the ≥2-source rule does not apply. Group:
≥2 distinct member projects is the promotion, in every mode. Generic findings never go to a group
wiki, group findings never to `knowledge`.

1. **Targets** — `scripts/wiki targets` → `{global, groups: {<group>: <project>}}`. Exit 1 with
   `{error}` (`ambiguous knowledge target: <a>, <b>` — two knowledge projects for one group, or
   two ungrouped) → report the named projects and stop before anything is written. `global` null
   and no `projects/knowledge/` → `scripts/project new knowledge --kind knowledge` (creates
   `PROJECT.md` with `kind: knowledge` and the `wiki/` skeleton). `global` null but
   `projects/knowledge/` exists (a legacy card without `kind:`) → stop, no writes, and tell the
   user to add `kind: knowledge` to its card frontmatter. `global` set but not `knowledge` → stop,
   no writes, and report it: the harvest locks, logs and commits `knowledge` by name. Read each target's `wiki_language` (§ Writers → Language) when it is
   first written and pass it to every page and overview writer for that target; a source
   project's language does not apply. Then `scripts/wiki lock take knowledge --session <id>` as in
   § Ingest; `held: false` → stop. Group wikis are locked in step 5, when first written.
2. **Candidates** — `scripts/wiki candidates` → `items` (`id`, `project`, `text`, `details`:
   the bullet's indented sub-lines, dedented, `[]` when none, `date`, `source`: the origin
   `wiki/sources/…` page or null, `scope`: `generic` | `group`, `group`: for a group item the
   origin project's **current** `group:`, null when it has none any more) from every non-archived
   wiki except `kind: knowledge` ones, research projects included. `date` is the bullet's leading
   `YYYY-MM-DD` — the day ingest appended it (`PAGES.md § open-questions.md`); null when the bullet
   has none. `text` + `details` together are the finding: pass both to the prefilter and the page
   writers (step 8 clears the sub-lines with the bullet). None → release, report "no
   candidates", stop.
3. **Prefilter + cluster** — this is the harvest's own work, not a question for the user. Split
   `items` by scope, and group items by `group`; a group item with `group: null` is clustered
   nowhere (routed nowhere: it waits, and expires on schedule in step 4 as a cluster of one).
   Split each part into chunks of ≤150 (by project, any number of chunks) and spawn one
   `cluster_writer` per chunk (`agents/cluster_writer.md`, § Writers; ≤10 in parallel), passing
   the chunk inline, its `scope` (and `group`), and the existing page slugs of that chunk's target
   (`knowledge`, or the group wiki; none yet → empty). Generic chunks drop what is not generic;
   group chunks keep group-scoped claims and drop only claims specific to one project. Writers
   merge duplicates into clusters and give each a subject and slug. Clusters never mix scopes or
   groups. With more than one chunk in a part, merge clusters across its receipts only when they
   state the same finding; distinct findings on one slug stay separate clusters (step 6 groups
   them per page). No subagent tool in this harness → do the same work inline, chunk by chunk. A
   receipt that is not JSON, has `status` other than `ok`, or lacks the `clusters` / `dropped`
   arrays → re-run that chunk once → still failing: release the lock and stop.
   The orchestrator checks that every item id ends in exactly one cluster or the dropped list.
   Ids missing from a chunk's receipt → re-run that chunk once; still missing → they stay out of
   every cluster and out of step 8's clear, so they remain candidates for the next harvest.
   Steps 1–4 run without stopping until the generic pick: no progress report, no question, no
   threshold table before it.
4. **Route** — the orchestrator computes per cluster:
   - *Group* (any mode, no question, never shown for picking): count = distinct origin
     **projects** of its items with a `source` (an item without one gives the page writer nothing
     to cite, so it does not count). ≥2 → **promoted** to that group's wiki. Below 2 → **kept**
     (not written, not cleared), unless every item in it has a `date` more than 90 days before
     today → **expired** (cleared in step 8, logged in step 9). An undated item never expires,
     so its cluster is kept. `--min` and `-yolo` thresholds do not apply.
   - *Generic* (into `knowledge` only, never a group wiki — even when every origin is in one
     group): count = distinct origin `source` pages of its items (an item with `source` null
     counts as its own origin), then — no generic cluster at all → no pick and no question in any
     mode, the run goes on with the group routing:
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
     - *`--min <n>`:* no question at all. Every cluster with count ≥ n is picked. Every cluster
       below n is **kept**: not shown, not written, not cleared in step 8, so its items stay as
       candidates and can reach n origins at a later harvest, when a new source repeats the
       finding.
   Generic candidates never expire. `--min` only: nothing to write or clear — no generic cluster
   meets n, no id was dropped, no group cluster is promoted and none expired → release the lock,
   report the cluster counts and stop without a commit. Dropped ids are cleared whenever the run
   goes on, whatever the group routing did. Manual and `-yolo` runs always go on to steps 8–10,
   even with nothing picked: skipped and dropped ids are cleared, the log written and committed.
5. **Group wiki** — per group with a promoted cluster: `groups[<group>]` from step 1 is its
   wiki; none → `scripts/project new <groupWikiName> --kind knowledge --group <group>` first
   (`groupWikiName` = the group slugged — lowercase, non-alphanumeric runs → `-`, trimmed — plus
   `-wiki`: group `Motyl OSS` → `motyl-oss-wiki`; a group that slugs to nothing → `group-wiki`).
   Exit 2 (`exists` / `archived`: the name is taken) → retry with `-2`, `-3`, … appended
   (`motyl-oss-wiki-2`), at most 5 names (an archived namesake stays archived: the panel refuses
   to restore a knowledge wiki while its group has another); exit 1, or every name taken → treat
   that group as a lock not held (below). Then `scripts/wiki lock take <group wiki>
   --session <id>`; `held: false` → that group's clusters stay as candidates (no page, no
   back-link, not cleared — dropped ids of its chunks included), the other targets proceed, and
   the report names the group. A renamed
   group keeps its wiki: the target is found by card (`group:`), never by name.
6. **Page writers** — one `page_writer` per subject per target in knowledge-wiki mode
   (`agents/page_writer.md § Knowledge-wiki mode`), given the target project (`knowledge` or the
   group wiki), its `language`, the slug (`entities/<name>` for a tool, library or platform,
   `concepts/<name>` for a technique or a group's shared process or convention — reuse an existing
   page of that target or alias first), the picked or promoted claims (each `text` with its
   `details`) and their origins as `<project>:wiki/sources/<page>.md` (a promoted group cluster's
   items without a `source` are left out: nothing to cite). ≤10 in parallel, never two
   on one page.
7. **Back-link** — only after that subject's writer returned a valid receipt, for every item of
   it with a `source`: generic → `scripts/wiki backlink <project> <source> wiki/<slug>` (adds
   `- [[knowledge:wiki/<slug>]]`); group → `scripts/wiki backlink <project> <source> <group
   wiki>:wiki/<slug>` (adds `- [[<group wiki>:wiki/<slug>]]`). Idempotent; under the source
   page's `## Knowledge`. A failed writer's items get no back-link.
8. **Index, then clear** — first, per written target: `scripts/wiki index <target>`, an
   `overview_writer` when pages changed, `index` again. Exit 1 → stop here, before anything is
   cleared and before the commit (as in § Ingest): release every lock and report `error` and
   `page`; every candidate is still in place for the next harvest. Then write every id the harvest saw — picked, skipped, dropped, promoted and expired —
   except the items of a failed page writer, of clusters kept (`--min` below n, group below 2 and
   not expired, `group: null` not expired), of a group whose lock was not held or whose wiki could
   not be created (step 5) — its prefilter-dropped ids included — and ids missing from a receipt, to a JSON array file and run `scripts/wiki clear-candidates --ids
   <file.json>` (clears from either section); `removed` must equal the number of ids in that
   file. Kept and failed-writer items stay as candidates for the next harvest. A group chunk's
   `single-project` drop is cleared now, like any drop — no 90-day wait.
9. **Log** — append the harvest entry to `knowledge/wiki/log.md` (`PAGES.md § log.md`) on every
   run that reaches this step — `harvest-status` reads the harvest age there — listing picked,
   skipped and dropped generic items with their origin project (with `--min`, the threshold and
   the number of clusters kept instead of the skipped list), the group counts (promoted / kept per
   group) and the expired items. Each written group wiki's `wiki/log.md` gets its own harvest
   entry listing what it received.
10. **Commit** — one commit for the whole harvest: `git add projects/knowledge`, every written
    group wiki's `projects/<group wiki>` (new ones included), and every origin project's
    `wiki/open-questions.md` and back-linked source pages, message
    `knowledge: wiki harvest <n> picked, <m> to group wikis` (`<n>` = generic clusters picked,
    `<m>` = group clusters promoted).
    Then `lock release` on `knowledge` and on every group wiki locked in step 5.

Report: generic clusters picked / skipped (or kept, with `--min`) / dropped; group clusters
promoted / kept / expired per group, group wikis created; pages created/updated per target,
back-links added, failures — each failed writer's subject, its items left as candidates (steps
7–8), each group whose lock was not held or whose wiki could not be created.

Steps 7–8 edit other projects' `open-questions.md` and source pages while holding only the target
locks, not those projects' ingest locks. An ingest or query running in an origin project at the
same time can race on those files (a lost candidate line or back-link); run the harvest when no
other wiki session is writing.

## 6. Lint

`scripts/wiki lint <p>` and present the eight groups (`broken`, `orphans`, `malformed`, `untyped`,
`stale`, `codeIdentifiers`, `missingUrl`, `diagrams`) with page paths and one remedy each — malformed frontmatter (the YAML
error is given) is fixed by re-running that page's writer or quoting the offending value
(`PAGES.md § Common frontmatter`), stale pages are refreshed by the next ingest, code identifiers
move to `wiki/repos/<repo>/` on the next page write, a page in `missingUrl` gets its `url` and
`Original:` link on the next rewrite of that page (a repo page from a local clone has no remote
URL, so it stays in `missingUrl` — expected, leave it), a diagram that fails to parse is fixed by hand
or by re-running that page's writer (`CONVENTIONS.md § Diagrams`; `diagramCheck: unavailable` →
say nothing was checked). Also run `scripts/wiki backlog <p>`: a
`broken` target listed under `create` gets its page from the next ingest; any other broken target
is fixed by turning the link into plain text (`CONVENTIONS.md § Links`). A long `update` list means
page writers fell behind — the next ingest catches up. Lint writes nothing and this skill does not
fix the findings in the same run.

## Non-goals

- Does not write `CONTEXT.md` — archive-plan and migrate own it.
- Does not backfill a whole project — that is `/pavilio-wiki-migrate`.
- Does not ingest from a query, or create a wiki from a query.
- Does not hand-edit `index.md` files — `scripts/wiki index` regenerates them.
- Does not move knowledge or group candidates on its own — only the user-run harvest (§ 5) does.
- Does not commit `wiki/.ingest.lock` or `wiki/raw/repos/` clones.
