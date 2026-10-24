# Wiki page contracts

The shape of every page kind. Rules (slugs, links, write regimes) are in
`skills/pavilio-wiki/CONVENTIONS.md`. Dates are local `YYYY-MM-DD`. `description` is one line —
the indexes and the panel show it — so make it say what the page answers.

## Common frontmatter

```yaml
type: source | entity | concept | repo | overview | question | note | open-questions
title: "Human title"          # optional; else the first "# " heading
description: "One line the indexes show"
created: 2026-10-20           # set once, never changed
updated: 2026-10-20           # bumped on every rewrite
url: "https://…"              # external material only — see below
```

**Quote every string scalar** — `title`, `description`, `record`, `raw`, `url` and every list
item — as a double-quoted JSON string (`description: "Tailscale HTTPS: needs MagicDNS"`, `\"` and
`\\` escaped). An unquoted `: ` or a leading `[`, `{`, `#`, `*` or `&` breaks the YAML; the page then
reads as having no frontmatter, `scripts/wiki index` stops, and lint lists it as `malformed`.

A page without `type` stops `scripts/wiki index` and the ingest with it. Path fields hold real
paths with `.md`: `record` and `raw` relative to the project, `sources` and `cited` as project-root
paths (`wiki/sources/….md`). Links in bodies use the D14 form without `.md`.

**`url` — the original of external material.** Required on every repo page and on a source page
whose `raw` is an article (`raw/article-*.md`), a YouTube transcript (`raw/youtube-*.md`) or a
clone (`raw/repos/…`); absent on record-backed sources and other raw snapshots (outside files,
snippets, `context-snapshot-*`). Never guessed — taken from the raw file's `source_url`
frontmatter, or for a clone from `git -C wiki/raw/repos/<owner>-<repo> remote get-url origin`,
normalised by the origin's form: a GitHub origin → `https://github.com/<owner>/<repo>` (no
`.git`); another https origin → as-is minus `.git`; scp-like `user@host:<owner>/<repo>` →
`https://host/<owner>/<repo>`; any other `scheme://host/<owner>/<repo>` (`ssh://`, `http://`,
`git://`) → `https://host/<owner>/<repo>`; a local path or `file://` origin (`clone-repo` accepts
those too) → no `url` — there is no original to link. Strip any userinfo (`user:token@`) from the
origin first — never write credentials onto a page. Lint lists a page that needs one and lacks it as
`missingUrl`; a repo page from a local clone stays there, which is expected.

## Source page — `wiki/sources/<kind>-<stem>.md`

```yaml
type: source
description: "What this record adds to the project's knowledge"
record: "progress/2026-10-19-tts-relay-node20.md"  # workspace record
# or
raw: "wiki/raw/article-edge-tts-limits.md"       # raw-layer file
url: "https://example.com/edge-tts-limits"       # with an article/YouTube/clone raw: its source_url
entities: ["jane-doe", "edge-tts"]               # bare names
concepts: ["utterance", "speech-relay"]
```

Body: `# <title>`, a one-line provenance line linking the record (`From [[progress/…]]`; with a
`url`, `From [[wiki/raw/…]] · Original: <url>`), then
short sections of durable knowledge — mechanisms, decisions with their reasons, gotchas, people
and their roles. No status lines: PR numbers, test counts, branch names, "pending restart",
checklists. Code detail is allowed here; it is cited from `repos/` pages, not concept pages.

Once a harvest took one of its findings, the page ends with the back-links `scripts/wiki
backlink` appends (never written by hand or by `source_writer`). `source_writer` rewrites the
whole page and drops the section; ingest keeps it by capturing these lines before the rewrite and
re-appending each with `scripts/wiki backlink` after it (`SKILL.md § 4. Ingest`, step 5):

```markdown
## Knowledge
- [[knowledge:wiki/entities/edge-tts]]
```

## Entity page — `wiki/entities/<name>.md`

```yaml
type: entity
kind: person | repository | service | organization
description: "Who or what it is, in one line"
aliases: ["Jane", "J. Doe"]                      # human-added aliases are kept forever
sources: ["wiki/sources/note-2026-10-01-kickoff.md", "wiki/sources/progress-2026-10-19-tts-relay-node20.md"]
```

Body: `# <name>`, what it is, its role in this project, relationships (`[[wiki/entities/…]]`),
decisions it is part of, each claim cited `([[wiki/sources/…]])`. In the `knowledge` project
claims cite `([[<project>:wiki/sources/…]])` and `sources:` holds
`"<project>:wiki/sources/….md"`. A `repository` entity is a short node that links down:
`Code: [[wiki/repos/<repo>/index]]`.

## Concept page — `wiki/concepts/<name>.md`

```yaml
type: concept
description: "What the concept is and why it matters, in one line"
aliases: []
sources: ["wiki/sources/….md", "wiki/sources/….md"]
```

Body: `# <term>`, definition (agreeing with the `CONTEXT.md` line when one exists), why it is so,
history and what broke, related concepts, each claim cited. Optional: one or two mermaid diagrams
summarising the prose (CONVENTIONS.md § Diagrams). Implementation lives behind a link to
`wiki/repos/<repo>/…` — no code identifiers (CONVENTIONS.md § No code identifiers outside `repos/`).

## Repo pages — `wiki/repos/<repo>/`

`<repo>` is the repository entity's name. `index.md` is generated.

```yaml
type: repo
description: "One line"
raw: "wiki/raw/repos/<owner>-<repo>"             # the clone directory
url: "https://github.com/<owner>/<repo>"         # the clone's origin, normalised; none for a local clone
commit: 1a2b3c4                                  # clone commit the page was written from
entities: ["<repo>", …]
concepts: […]
```

- `ARCHITECTURE.md` — an `Original: <url>` line under the title (when it has a `url`), then purpose, top-level layout,
  main modules and how they talk, entry points, build/test commands, where each domain concept is
  implemented.
- `<topic>.md` — a code-level note answering one code question (repo_writer question mode), with
  the same `Original: <url>` line under the title when it has a `url`.

Repo pages count as sources for the ≥2 threshold.

## Overview — `wiki/overview.md`

`type: overview`. What the project is, its main actors and concepts, and where to start reading:
≤40 lines, links only to pages that exist. Optional: one mermaid map (CONVENTIONS.md § Diagrams).

## Question — `wiki/questions/<YYYY-MM-DD>-<slug>.md`

```yaml
type: question
description: "The question, in one line"
cited: ["wiki/concepts/utterance.md", "wiki/sources/progress-2026-10-19-tts-relay-node20.md"]
```

Body: `# <question>`, the answer as given — with its one diagram, if it had one
(`CONVENTIONS.md § Diagrams`) — `## Cited` with the D14 links, `## Gaps` if the wiki fell short.
Written once.

## Note — `wiki/notes/<slug>.md`

`type: note`, `cited:` as above. A synthesised answer across ≥2 pages, or one the user asked to
save. Enrich in place: append or fold a new section, bump `updated`, keep the rest.

## Open questions — `wiki/open-questions.md`

```markdown
---
type: open-questions
description: "Gaps the wiki could not answer and knowledge waiting for a home"
---
# Open questions

## Gaps
- 2026-10-20 — Why does the relay fail on Node 20? Not covered. (query [[wiki/questions/2026-10-20-relay-node20]])
- 2026-10-20 — [[wiki/concepts/utterance]] says X, [[wiki/sources/progress-…]] says Y. (ingest)
- 2026-10-20 — Term collision: "catch-up" means the speech re-fetch ([[wiki/concepts/catch-up]]) and the session-start wiki ingest ([[wiki/sources/progress-…]]). (ingest)

## Knowledge candidates
- 2026-10-20 — <generic finding> (from [[wiki/sources/progress-2026-10-19-tts-relay-node20]])
```

Append only; create the file with this skeleton when missing. People delete resolved items. A
candidate's indented sub-lines are part of it: the harvest reads them as its `details` and clears
them with the bullet.

## log.md

Append-only. `scripts/wiki record` appends the ledger lines; the orchestrator appends one entry per
run after them:

```markdown
## 2026-10-20 14:05 ingest (note | session-start | archive-plan | explicit)
- lock: taken over from <session>                 # only on a stale takeover
- sources: sources/note-2026-10-20-kickoff, …
- pages: concepts/utterance (updated), entities/jane-doe (created)
- waiting: concepts/speech-relay (1 mention)
- behind: concepts/utterance                      # still in the backlog after its writer re-ran
- failed: notes/2026-10-20-kickoff.md             # receipt was not JSON twice; not ledgered
- warning: https://… paywall stub, no source page

## 2026-10-20 15:10 query
- question: [[wiki/questions/2026-10-20-relay-node20]]
- cited: [[wiki/concepts/speech-relay]], [[wiki/sources/progress-2026-10-19-tts-relay-node20]]
- note: [[wiki/notes/speech-relay-node-versions]]  # only when written
- gap: yes                                         # only when recorded
```

The knowledge harvest appends to `knowledge/wiki/log.md` (`scripts/wiki harvest-status` reads the
newest `harvest` heading for the harvest age):

```markdown
## 2026-10-22 16:40 harvest (manual | -yolo ≥3)
- picked: concepts/sse-backpressure ← pavilio [[pavilio:wiki/sources/progress-2026-10-19-relay]]
- skipped: "Node 20 fetch drops keep-alive" ← motyl
- dropped: "Client X renews in Q3" ← alokai          # prefilter: not generic
- pages: entities/edge-tts (created), concepts/sse-backpressure (updated)
- backlinks: 5
```

Omit lines that would be empty.
