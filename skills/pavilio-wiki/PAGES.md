# Wiki page contracts

The shape of every page kind. Rules (slugs, links, write regimes) are in
`skills/pavilio-wiki/CONVENTIONS.md`. Dates are local `YYYY-MM-DD`. `description` is one line —
the indexes and the panel show it — so make it say what the page answers.

## Common frontmatter

```yaml
type: source | entity | concept | repo | overview | question | note | open-questions
title: Human title            # optional; else the first "# " heading
description: One line the indexes show
created: 2026-10-20           # set once, never changed
updated: 2026-10-20           # bumped on every rewrite
```

A page without `type` stops `scripts/wiki index` and the ingest with it. Path fields hold real
paths with `.md`: `record` and `raw` relative to the project, `sources` and `cited` relative to
`wiki/`. Links in bodies use the D14 form without `.md`.

## Source page — `wiki/sources/<kind>-<stem>.md`

```yaml
type: source
description: What this record adds to the project's knowledge
record: progress/2026-10-19-tts-relay-node20.md  # workspace record
# or
raw: wiki/raw/article-edge-tts-limits.md         # raw-layer file
entities: [jane-doe, edge-tts]                   # bare names
concepts: [utterance, speech-relay]
```

Body: `# <title>`, a one-line provenance line linking the record (`From [[progress/…]]`), then
short sections of durable knowledge — mechanisms, decisions with their reasons, gotchas, people
and their roles. No status lines: PR numbers, test counts, branch names, "pending restart",
checklists. Code detail is allowed here; it is cited from `repos/` pages, not concept pages.

## Entity page — `wiki/entities/<name>.md`

```yaml
type: entity
kind: person | repository | service | organization
description: Who or what it is, in one line
aliases: [Jane, J. Doe]                          # human-added aliases are kept forever
sources: [sources/note-2026-10-01-kickoff.md, sources/progress-2026-10-19-tts-relay-node20.md]
```

Body: `# <name>`, what it is, its role in this project, relationships (`[[wiki/entities/…]]`),
decisions it is part of, each claim cited `([[wiki/sources/…]])`. A `repository` entity is a short
node that links down: `Code: [[wiki/repos/<repo>/index]]`.

## Concept page — `wiki/concepts/<name>.md`

```yaml
type: concept
description: What the concept is and why it matters, in one line
aliases: []
sources: [sources/….md, sources/….md]
```

Body: `# <term>`, definition (agreeing with the `CONTEXT.md` line when one exists), why it is so,
history and what broke, related concepts, each claim cited. Implementation lives behind a link to
`wiki/repos/<repo>/…` — no code identifiers (CONVENTIONS.md § No code identifiers outside `repos/`).

## Repo pages — `wiki/repos/<repo>/`

`<repo>` is the repository entity's name. `index.md` is generated.

```yaml
type: repo
description: One line
raw: wiki/raw/repos/<owner>-<repo>               # the clone directory
commit: 1a2b3c4                                  # clone commit the page was written from
entities: [<repo>, …]
concepts: […]
```

- `ARCHITECTURE.md` — purpose, top-level layout, main modules and how they talk, entry points,
  build/test commands, where each domain concept is implemented.
- `<topic>.md` — a code-level note answering one code question (repo_writer question mode).

Repo pages count as sources for the ≥2 threshold.

## Overview — `wiki/overview.md`

`type: overview`. What the project is, its main actors and concepts, and where to start reading:
≤40 lines, links only to pages that exist.

## Question — `wiki/questions/<YYYY-MM-DD>-<slug>.md`

```yaml
type: question
description: The question, in one line
cited: [concepts/utterance.md, sources/progress-2026-10-19-tts-relay-node20.md]
```

Body: `# <question>`, the answer as given, `## Cited` with the D14 links, `## Gaps` if the wiki
fell short. Written once.

## Note — `wiki/notes/<slug>.md`

`type: note`, `cited:` as above. A synthesised answer across ≥2 pages, or one the user asked to
save. Enrich in place: append or fold a new section, bump `updated`, keep the rest.

## Open questions — `wiki/open-questions.md`

```markdown
---
type: open-questions
description: Gaps the wiki could not answer and knowledge waiting for a home
---
# Open questions

## Gaps
- 2026-10-20 — Why does the relay fail on Node 20? Not covered. (query [[wiki/questions/2026-10-20-relay-node20]])
- 2026-10-20 — [[wiki/concepts/utterance]] says X, [[wiki/sources/progress-…]] says Y. (ingest)

## Knowledge candidates
- 2026-10-20 — <generic finding> (from [[wiki/sources/progress-2026-10-19-tts-relay-node20]])
```

Append only; create the file with this skeleton when missing. People delete resolved items.

## log.md

Append-only. `scripts/wiki record` appends the ledger lines; the orchestrator appends one entry per
run after them:

```markdown
## 2026-10-20 14:05 ingest (note | session-start | archive-plan | explicit)
- lock: taken over from <session>                 # only on a stale takeover
- sources: sources/note-2026-10-20-kickoff, …
- pages: concepts/utterance (updated), entities/jane-doe (created)
- waiting: concepts/speech-relay (1 mention)
- failed: notes/2026-10-20-kickoff.md             # receipt was not JSON twice; not ledgered
- warning: https://… paywall stub, no source page

## 2026-10-20 15:10 query
- question: [[wiki/questions/2026-10-20-relay-node20]]
- cited: [[wiki/concepts/speech-relay]], [[wiki/sources/progress-2026-10-19-tts-relay-node20]]
- note: [[wiki/notes/speech-relay-node-versions]]  # only when written
- gap: yes                                         # only when recorded
```

Omit lines that would be empty.
