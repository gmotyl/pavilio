---
name: pavilio-wiki-migrate
description: Backfill a project's LLM wiki from its whole history — survey the records and estimate the cost, stop for confirmation, snapshot CONTEXT.md and rewrite it as a strict one-line glossary, seed a concept page per glossary term, then ingest every pending record oldest first in batches of ~10 cheap writers, committing after each batch; resumable from the ledger, ends with overview, lint and a report. Use when the user invokes `/pavilio-wiki-migrate <project>`, asks to "migrate the project to the wiki" or "backfill the wiki", or when a skill hints the project has no wiki or too many pending records.
---

# Pavilio Wiki Migrate

One-time (resumable) backfill of `projects/<p>/wiki/` from the project's records, plus the
`CONTEXT.md` → glossary rewrite. Orchestration only: the main session runs `scripts/wiki`
commands and spawns writers; it never writes source or knowledge pages itself. Day-to-day ingest
is `/pavilio-wiki ingest`, not this skill.

Before the first write, read `skills/pavilio-wiki/CONVENTIONS.md` (layout, identity and the
ledger, glossary exemption, links) and `skills/pavilio-wiki/SKILL.md § 4. Ingest` (sequence,
writers, errors). Writers are `skills/pavilio-wiki/agents/*.md`; spawn them exactly as
`pavilio-wiki SKILL.md § Writers` says.

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
2. Group by kind: `notes/` → note, `memo/` → memo, `adr/` → adr, `progress/` → progress,
   `…/changes/archive/<id>/proposal.md` → proposal, `…/design.md` → design. Count `new` and
   `changed` separately; count ledger lines in `wiki/log.md` as done.
3. Resume state: snapshot present (`wiki/raw/context-snapshot-*.md`)? `CONTEXT.md` rewritten
   (every term line carries `See [[wiki/concepts/`)? Snapshot ledgered?
4. Token estimate (writer input + output, rounded to 10k):
   - records: Σ bytes of pending records ÷ 4 + 8k per record (agent file, conventions, page
     contract, indexes, receipt) + 4k per record for page writers;
   - glossary (only if not yet rewritten): `CONTEXT.md` bytes ÷ 4 × 2 for the rewrite, + 4k per
     glossary term for seeded concept pages.
5. Show one table: kind | new | changed | KB | est. tokens; then totals, batch count
   (⌈records ÷ 10⌉), resume state, writer model.
6. Nothing pending and glossary done → say the wiki is migrated, suggest `/pavilio-wiki <p> lint`,
   stop.
7. Ask "Start the migration of `<p>`?" and **end the turn** (workspace `AGENTS.md` § Close the
   loop). Do nothing else until the user answers yes.

## 2. Lock and gitignore

1. `scripts/wiki lock take <p> --session <id>`. `held: false` → another session is ingesting;
   report and stop. `takenOver: true` → note it for the first log entry.
2. Ensure `wiki/.gitignore` lists `.ingest.lock` and `raw/repos/`.
3. Hold the lock for the whole migration. Before each batch (and before any step that may run
   long) re-run `lock take` with the same session — that refreshes `ts`, so a run longer than
   15 min is not taken over. `held: false` on a refresh → stop after committing what landed.
4. Release on every stop after this step: `scripts/wiki lock release <p> --session <id>`.

## 3. Snapshot `CONTEXT.md`

Skip steps 3–4 when a `wiki/raw/context-snapshot-*.md` exists **and** `CONTEXT.md` is already
rewritten; use that snapshot for step 5.

1. No `CONTEXT.md` → skip steps 3–5 (no glossary, no seeded pages).
2. Copy `CONTEXT.md` byte for byte to `wiki/raw/context-snapshot-<today>.md`. A raw file is never
   rewritten afterwards.

## 4. Rewrite `CONTEXT.md` as a strict glossary

1. Build the spec map: every `projects/<p>/**/openspec/specs/<name>/spec.md` →
   `<name>` → `[[<project-relative path without .md>]]` (e.g. `speech` →
   `[[plans/openspec/specs/speech/spec]]`).
2. Spawn **one** subagent (default model, not `writerModel` — every session reads the glossary)
   with: the snapshot path, the spec map, and these rules:
   - Write `CONTEXT.md` only. Read the snapshot only.
   - Keep the title, the one-line preamble and the `##` section headings.
   - Exactly one line per term:
     `- **<Term>** — <one-sentence definition>. See [[wiki/concepts/<slug>]].` Slug per
     `CONVENTIONS.md § Identity and the ledger`; aliases and `_Avoid_` notes stay in the sentence.
   - Everything beyond the definition is dropped — it lives in the snapshot and reaches the
     concept page in step 5.
   - Legacy `[[<name>]]` capability links → the spec map path, placed after the `See` link
     (`; spec [[plans/openspec/specs/speech/spec]]`). A name not in the map → plain text, listed in
     `unresolved`.
   - No file paths, functions or flags in definitions.
   - Receipt, one JSON object: `{"status":"ok","terms":[{"term","slug"}],"specLinks":<n>,"unresolved":[…]}`.
3. Verify with `grep`: every `- **` line carries `See [[wiki/concepts/<slug>]]`, and those slugs
   equal the receipt's. A mismatch → re-run the subagent once with the offending lines, then stop
   and report.
4. Commit `CONTEXT.md`, `wiki/.gitignore` and the snapshot: `<p>: wiki migrate — glossary`.

## 5. Seed glossary concept pages

Skip when `scripts/wiki pending <p> --only wiki/raw/<snapshot>` reports nothing (already seeded).

1. One `source_writer` for the snapshot → `wiki/sources/context-<snapshot stem>.md`. Tell it every
   glossary term the snapshot defines goes in `concepts:` under its glossary slug.
2. `scripts/wiki mentions <p> --touched <every concepts/<slug> from the step 4 receipt>`. Glossary
   terms qualify with this one source (`CONVENTIONS.md § Two sources, and the glossary exemption`).
3. One `page_writer` per `qualifying` slug, ≤10 in parallel: `sources` = the snapshot's source
   page, `glossary` = the term's `CONTEXT.md` line. Refresh the lock between groups of 10.
4. A glossary slug that did not qualify (the source page missed it) → list it in the report.
5. `scripts/wiki index <p>` (exit 1 → stop: no record, no commit, report, release),
   `scripts/wiki record <p> wiki/raw/<snapshot> <hash>`, append a log entry
   (`PAGES.md § log.md`, kind `migrate`), commit `projects/<p>/wiki` as
   `<p>: wiki migrate — seeded <n> concepts`.

## 6. Batches, oldest first

1. `scripts/wiki pending <p>` again (the ledger is the resume point — finished records are gone).
2. Sort oldest first: the first `YYYY-MM-DD` in the path (progress, notes, memo, change ids); else
   else the date the file was added, `git log --diff-filter=A --format=%as -1 -- <path>`
   (ADRs). Ties by path.
3. Cut into batches of 10. For each batch:
   1. Refresh the lock.
   2. Run `pavilio-wiki SKILL.md § 4. Ingest § Sequence` steps 4–11 for the batch: source writers
      (≤10 in parallel), mentions `--touched` this batch's slugs, page writers given only this
      batch's source pages, index, record, log, `generic:` and contradictions into
      `open-questions.md`. Skip step 7 (overview) — it runs once at the end.
   3. Commit `projects/<p>/wiki` as `<p>: wiki migrate batch <k>/<n> (<m> records)`.
   4. One progress line: batch, records done/total, pages created/updated, failures.
4. Errors follow `pavilio-wiki SKILL.md § 4. Ingest § Errors`: a failed record is not ledgered and
   comes back on resume; `index` exit 1 stops the run after releasing the lock.

Archived changes contribute only `proposal.md` and `design.md`. Never pass a `tasks.md`, a delta
spec or an active change to a writer, even by hand.

## 7. Finish

1. One `overview_writer` with every knowledge page created or updated during the run.
2. `scripts/wiki index <p>`, then `scripts/wiki lint <p>`.
3. Append a final log entry, commit `projects/<p>/wiki` as `<p>: wiki migrate — overview`,
   release the lock.
4. Report: records ingested by kind, failed records (rerun to retry), source pages, knowledge
   pages created, slugs waiting at 1 mention, glossary terms without a page, unresolved legacy
   links, lint groups with counts (`pavilio-wiki SKILL.md § 5. Lint` for remedies), actual vs
   estimated batches.

## Non-goals

- Does not ingest `tasks.md`, delta specs, active changes or today's progress.
- Does not start without the survey confirmation, and does not ask more than that one question.
- Does not edit records or raw files, hand-edit any `index.md`, or fix lint findings.
- Does not ingest outside files, articles or repos — that is `/pavilio-wiki ingest`.
- Does not push, and does not commit anything outside `CONTEXT.md` and `projects/<p>/wiki`.
