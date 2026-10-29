---
name: pavilio-wiki-migrate
description: Backfill a project's LLM wiki from its whole history — survey the records and estimate the cost, stop for confirmation, snapshot CONTEXT.md and rewrite it as a strict one-line glossary, seed a concept page per glossary term, then ingest every pending record oldest first in batches of ~10 cheap writers, committing after each batch and flushing knowledge pages every 5 batches; resumable from the ledger, ends with overview, lint and a report. Use when the user invokes `/pavilio-wiki-migrate <project>`, asks to "migrate the project to the wiki" or "backfill the wiki", or when a skill hints the project has no wiki or too many pending records.
---

# Pavilio Wiki Migrate

One-time (resumable) backfill of `projects/<p>/wiki/` from the project's records, plus the
`CONTEXT.md` → glossary rewrite. Orchestration only: the main session runs `scripts/wiki`
commands and spawns writers; it never writes source or knowledge pages itself. Day-to-day ingest
is `/pavilio-wiki ingest`, not this skill.

Before the first write, read `skills/pavilio-wiki/CONVENTIONS.md` (layout, identity and the
ledger, glossary exemption, links) and `skills/pavilio-wiki/SKILL.md § 4. Ingest` (sequence,
writers, errors). Writers are `skills/pavilio-wiki/agents/*.md`; spawn them exactly as
`pavilio-wiki SKILL.md § Writers` says. Steps of that skill are cited by their **bold title**
(e.g. **Page writers**), never by number.

## Usage

```
/pavilio-wiki-migrate <project>
```

Every `scripts/wiki` command runs from the workspace root and prints one JSON object; exit 0 ok,
1 error, 2 ask the user.

## 0. Setup

1. `scripts/wiki project --name <p>` (no argument → `scripts/wiki project`; exit 2 → ask which
   project, end the turn).
2. `scripts/wiki config` once → `writerModel`.
3. Session id for the whole run: harness session id, else `$PAVILIO_TERMINAL_ID`, else
   `<hostname>-<epoch>`. Reuse the same id after the confirmation stop.
4. `today` = `date +%F`.

## 1. Survey and confirmation stop

1. `scripts/wiki pending <p>` → the records not yet ingested (or changed). The ledger already
   excludes `tasks.md`, delta specs, active changes and today's progress.
2. Group by kind: `notes/` → note, `memo/` or `memos/` → memo, `adr/` → adr, `progress/` →
   progress, `…/changes/archive/<id>/proposal.md` → proposal, `…/design.md` → design,
   `wiki/raw/*.md` → raw snapshot (one left unledgered by an interrupted ingest; `pending` never
   lists `context-snapshot-*.md`). Count `new`
   and `changed` separately; count ledger lines in `wiki/log.md` as done.
3. Resume state: snapshot present (`wiki/raw/context-snapshot-*.md`)? `CONTEXT.md` rewritten
   (every term line carries `See [[wiki/concepts/`)? Snapshot sections all ledgered?
4. Token estimate (writer input + output, rounded to 100k). A writer subagent costs ~60k tokens
   before it reads its own inputs (harness, agent file, conventions, page contract, indexes,
   tool turns) — measured on the pavilio migration, where source writers averaged ~65k and page
   writers ~65k. Page writers dominate: flushing pages every batch cost ~3 page writes per record,
   because the same hub pages were rewritten in nearly every batch; § 6 flushes every 5 batches.
   - records: 60k per record + Σ bytes of pending records ÷ 4;
   - pages: 65k × (1 page write per record + 1 per distinct slug `scripts/wiki backlog <p>`
     already lists);
   - glossary (only if not yet rewritten): `CONTEXT.md` bytes ÷ 4 × 3 (rewrite + section source
     writers) + 65k per glossary term for seeded concept pages.
5. Show one table: kind | new | changed | KB | est. tokens; then totals, batch count
   (⌈records ÷ 10⌉), page flush count (⌈batches ÷ 5⌉), resume state, writer model. Say the
   estimate is ±50%.
6. Nothing pending and glossary done → say the wiki is migrated, suggest `/pavilio-wiki <p> lint`,
   stop.
7. Ask "Start the migration of `<p>`?" and **end the turn** (workspace `AGENTS.md` § Close the
   loop). Do nothing else until the user answers yes.

## 2. Lock and gitignore

1. `scripts/wiki lock take <p> --session <id>`. `busy: true` → retry once after a few seconds.
   `held: false` → another session is ingesting;
   report and stop. `takenOver: true` → note it for the first log entry. Nothing is written
   before this step.
2. Ensure `wiki/.gitignore` lists `.ingest.lock*` and `raw/repos/`.
3. Hold the lock for the whole migration. Before each batch (and before any step that may run
   long) re-run `lock take` with the same session — that refreshes `ts`, so a run longer than
   15 min is not taken over. `held: false` on a refresh → stop after committing what landed.
4. Release on every stop after this step: `scripts/wiki lock release <p> --session <id>`.

## 3. Snapshot `CONTEXT.md`

1. No `CONTEXT.md` → skip steps 3–5 (no glossary, no seeded pages).
2. Any `wiki/raw/context-snapshot-*.md` exists → **never snapshot again**: reuse the newest one as
   `<snapshot>` (the live `CONTEXT.md` may already be rewritten). Else copy `CONTEXT.md` byte for
   byte to `wiki/raw/context-snapshot-<today>.md`. A raw file is never rewritten. Ledger the
   top-level snapshot right away — its content is carried by the section files, so it is never
   ingested as one page (a plain `pending` already skips `context-snapshot-*.md`; the ledger line
   marks it handled):
   `scripts/wiki pending <p> --only wiki/raw/<snapshot file>` → `scripts/wiki record <p>
   wiki/raw/<snapshot file> <hash>` (skip when already done).
3. Split `<snapshot>` into one verbatim raw file per `##` section:
   `wiki/raw/<snapshot stem>/<nn>-<section-slug>.md` (`nn` = section order, two digits; text
   before the first `##` goes into `00-preamble.md`). Write only files that are missing. These
   section files are the records the concept pages are seeded from; `pending --only` takes each
   (they sit in a sub-dir, so a plain `pending` never lists them).
4. `CONTEXT.md` already rewritten → skip step 4 items 1–3; still run item 4 (commit) when the
   snapshot, its section files or its ledger line are not yet committed.

## 4. Rewrite `CONTEXT.md` as a strict glossary

1. Build the link map the subagent applies to every legacy `[[<name>]]`, first match wins:
   1. spec: `projects/<p>/**/openspec/specs/<name>/spec.md` →
      `[[<project-relative path without .md>]]` (e.g. `[[plans/openspec/specs/speech/spec]]`);
   2. another glossary term — slugify the name first (lowercase kebab-case ASCII, as
      `CONVENTIONS.md § Identity and the ledger`), then match the term slugs →
      `[[wiki/concepts/<slug>]]`;
   3. `[[ADR NNNN]]` (or `[[adr NNNN]]`, `[[NNNN]]`) → the one `adr/NNNN-*.md`, as `[[adr/NNNN-…]]`;
   4. a workspace skill name (`skills/<name>/` exists) → plain text, no brackets;
   5. anything else → plain text, listed in `unresolved`.
2. Spawn **one** subagent (default model, not `writerModel` — every session reads the glossary)
   with: `<snapshot>`, the spec map, the ADR list, the skill names, and these rules:
   - Write `CONTEXT.md` only. Read `<snapshot>` only.
   - Keep the title, the one-line preamble and the `##` section headings.
   - Exactly one line per term:
     `- **<Term>** — <one-sentence definition>. See [[wiki/concepts/<slug>]].` Slug per
     `CONVENTIONS.md § Identity and the ledger`; aliases and `_Avoid_` notes stay in the sentence.
     Spec links go after the `See` link (`; spec [[plans/openspec/specs/speech/spec]]`).
   - Everything beyond the definition is dropped, and so is every prose paragraph that is not a
     term line — both survive in `<snapshot>` and reach the concept pages in step 5.
   - No file paths, functions or flags in definitions.
   - Receipt, one JSON object:
     `{"status":"ok","terms":[{"term","slug","section"}],"links":{"spec":n,"term":n,"adr":n,"skill":n},"unresolved":[…]}`.
3. Verify with `grep`: every `- **` line carries `See [[wiki/concepts/<slug>]]`, and those slugs
   equal the receipt's. A mismatch → re-run the subagent once with the offending lines. Still
   wrong → `cp <snapshot> CONTEXT.md` (restore the original), release the lock, report, stop.
4. Commit `CONTEXT.md`, `wiki/.gitignore`, `wiki/log.md`, `<snapshot>` and its section files:
   `<p>: wiki migrate — glossary`.

## 5. Seed glossary concept pages

Run for the section files `pending <p> --only wiki/raw/<snapshot stem>/<file>` still reports;
skip the step when none are pending.

1. One `source_writer` per pending section file, ≤10 in parallel, with
   `page` = `wiki/sources/<snapshot stem>-<section-slug>.md`. Tell it: keep every term's detail
   (mechanism, reasons, gotchas, history) under a heading per term — this page is the only route
   from the old glossary prose to the concept pages; list each glossary term of the section in
   `concepts:` under its receipt slug.
2. **Backlog** — once every section writer has returned, `scripts/wiki backlog <p> --touched
   <slugs>` with every glossary slug (`See [[wiki/concepts/<slug>]]` in `CONTEXT.md`). Glossary
   terms qualify with one source (`CONVENTIONS.md § Two sources, and the glossary exemption`). On
   a resume, seeded pages already cite their section page, so only the missing ones come back.
3. One `page_writer` per `create` and `update` slug, ≤10 in parallel, refreshing the lock between
   groups: `sources` = the paths the backlog lists, `glossary` = the term's `CONTEXT.md` line. Then
   re-run the backlog check as `pavilio-wiki SKILL.md` **Page writers** says.
4. A glossary slug in neither `create` nor `update` and without a page (its section page missed
   it) → list it in the report.
5. `scripts/wiki index <p>` (exit 1 → stop: no record, no commit, report, release).
6. `scripts/wiki record` each section file whose source page landed.
7. Append a log entry (`PAGES.md § log.md`) headed `ingest (migrate)`; commit `projects/<p>/wiki`
   as `<p>: wiki migrate — seeded <n> concepts`.

## 6. Batches, oldest first

1. `scripts/wiki pending <p>` again (the ledger is the resume point — finished records are gone).
2. Sort oldest first: the first `YYYY-MM-DD` in the path (progress, notes, memo, change ids), else
   the date the file was added, `git log --diff-filter=A --format=%as -1 -- <path>` (ADRs). Ties
   by path.
3. Cut into batches of 10. Source pages land every batch; knowledge pages are **flushed** every 5
   batches and after the last one. Hub pages (a person, the core concepts) are named by most
   records, so updating them every batch rewrites the same page dozens of times — a flush folds 5
   batches of sources into one write per page. Nothing is lost between flushes: the backlog is
   read from the pages, so a stop or a crash before a flush only defers the work.
4. For each batch:
   1. Refresh the lock.
   2. Run these steps of `pavilio-wiki SKILL.md § 4. Ingest § Sequence` for the batch:
      **Source writers**, **Index**, **Record**, **Log** (entry headed `ingest (migrate)`, pages
      line omitted; `generic:` items into `open-questions.md`), **Commit**. Wait for every source
      writer's receipt before **Index** — never commit with a writer still running.
   3. Commit message: `<p>: wiki migrate batch <k>/<n> (<m> records)`.
   4. Batch number divisible by 5, or the last batch → flush (step 5) before the next batch.
   5. One progress line: batch, records done/total, failures.
5. **Flush** — the knowledge pages for everything ingested so far:
   1. Refresh the lock. `scripts/wiki backlog <p>` with no `--touched`: everything the pages owe,
      which also catches slugs that qualified across batches and writers that failed before.
   2. **Page writers** as `pavilio-wiki SKILL.md § 4. Ingest § Sequence` says (≤10 in parallel,
      ≤12 sources per writer, the verifying backlog re-run), refreshing the lock between groups.
   3. **Index**; a log entry headed `ingest (migrate)` with the pages line and `waiting:`;
      contradictions and collisions into `open-questions.md`, filtered and deduped as
      `pavilio-wiki SKILL.md § 4. Ingest` step 11 says; commit
      `<p>: wiki migrate pages <f>/<total flushes> (<n> pages)`.
6. Errors follow `pavilio-wiki SKILL.md § 4. Ingest § Errors`: a failed record is not ledgered and
   comes back on resume; `index` exit 1 stops the run after releasing the lock. On a resume, run a
   flush first when `scripts/wiki backlog <p>` lists anything.

Archived changes contribute only `proposal.md` and `design.md`. Never pass a `tasks.md`, a delta
spec or an active change to a writer, even by hand.

## 7. Finish

1. `scripts/wiki backlog <p>` must list nothing in `create` or `update` (the last flush ran);
   anything left → one more flush, then report what still remains.
2. One `overview_writer` with every knowledge page created or updated during the run — the flush
   receipts, or `git diff --name-only <first migrate commit>^ HEAD -- projects/<p>/wiki/entities
   projects/<p>/wiki/concepts` after a resume.
3. `scripts/wiki index <p>`, then `scripts/wiki lint <p>`.
4. `scripts/wiki pending <p>` once more: a record edited while the run ingested it (an open
   progress file, auto-sync) shows up as `changed` — report it, do not chase it.
5. Append a final `ingest (migrate)` log entry, commit `projects/<p>/wiki` as
   `<p>: wiki migrate — overview`, release the lock.
6. Report: records ingested by kind, failed records (rerun to retry), records changed during the
   run, source pages, knowledge pages created, `waiting` slugs from the last backlog, glossary
   terms without a page, unresolved legacy links, lint groups with counts (`pavilio-wiki SKILL.md
   § 5. Lint` for remedies), actual vs estimated batches and tokens.

## Non-goals

- Does not ingest `tasks.md`, delta specs, active changes or today's progress.
- Does not start without the survey confirmation, and does not ask more than that one question.
- Does not re-snapshot `CONTEXT.md` once a snapshot exists, or leave a half-rewritten glossary.
- Does not edit records or raw files, hand-edit any `index.md`, or fix lint findings.
- Does not ingest outside files, articles or repos — that is `/pavilio-wiki ingest`.
- Does not push, and does not commit anything outside `CONTEXT.md` and `projects/<p>/wiki`.
