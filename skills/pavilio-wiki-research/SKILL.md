---
name: pavilio-wiki-research
description: Build or deepen a research project's wiki on a generic topic — or contribute a round to the current project's own wiki when one is set (asked first) — resolve or scaffold a `kind: research` project, interview one question at a time for research questions, scope and seed links, read the shared `knowledge` wiki first, search the web for candidate sources (articles, YouTube), fetch and ingest them through `pavilio-wiki`, then answer each research question as a cited query. Rerunnable: an existing research project gets a new round. Use when the user invokes `/pavilio-wiki-research <topic> [-yolo]` or asks to "research <topic> into a wiki".
---

# Pavilio Wiki Research

Orchestrator for one research round. A research project is an ordinary project with
`kind: research` in its `PROJECT.md` frontmatter; its external material lives in `wiki/raw/`,
experiment code in its spikes repo (`scripts/project spike-repo <p>`). Fetching, ingest and
query are [[pavilio-wiki]]'s — this skill decides what goes in and in which order, and never
writes source or knowledge pages itself. When a current project is set, step 0 offers
**contribute mode**: the round targets that project's own wiki instead of a research project.

## Usage

```
/pavilio-wiki-research <topic> [-yolo]
```

`-yolo` skips the source pick in step 4: the agent picks up to 10 sources per round itself and
reports which ones it took; the user's seed links are always fetched on top and never count
toward the 10. It does not skip step 0's target question or the interview.

Every `scripts/wiki` and `scripts/project` command runs from the workspace root and prints one
JSON object; exit 0 ok, 1 error, 2 ask the user.

Every workspace page or file named to the user — step 3's knowledge summary, wiki pages, the
ingest report, answers, gaps — is the link `scripts/wiki panel-link <path>` prints (a
`projects/`-prefixed path is accepted); never a bare or workspace path. A spike memo is the
`/project/<p>/memo?file=…` link [[pavilio-memo-explain]] returns, which opens it in the Memo tab
(`panel-link` gives a `/view/…` link for a memo). Web candidates and fetched sources are shown
with their original URL.

## Steps

0. **Target.** Current project = the one set earlier in the conversation (by
   `/pavilio-session-start`, `/pavilio-wiki` or another project-scoped skill), else the project
   of `pwd` read once at the round's start, before any `cd`: `scripts/wiki project --cwd <that
   dir>` counts only with `"via": "cwd"` — `"cell"` (the panel cell's project) or exit 2 → none.
   `kind` from that output or `scripts/wiki project --name <p>`; `topic` = the frontmatter
   `topic` of its `PROJECT.md` (not returned).
   - None or `knowledge` → ask nothing; step 1 as written. `knowledge` is never a target. A
     research project whose `topic` matches → ask nothing; continue `<p>` as a new round.
   - An ordinary project, or a research project with another topic → ask per [[pavilio-ask]]
     (letters fixed), then stop:

     - **A)** Contribute to `<p>`'s wiki *(recommended)*
     - **B)** New or continued research project on `<topic>`
     - **D)** Other, tell me how

     A on an ordinary project → **contribute mode**. A on a research project → its next round
     in today's research flow (step 1 keeps it, skipping topic matching). B → step 1 as written.

   **Contribute mode** (ordinary `<p>`): no project is scaffolded; `<p>`'s `PROJECT.md` is never
   written or committed. Steps 3–6 run unchanged against `<p>` (`/pavilio-wiki <p> ingest …`,
   `/pavilio-wiki <p>: "…"`; a missing `wiki/` is created by that ingest); question pages and
   `## Gaps` are the round's durable record. Steps 1, 2, 7 and 8 note their contribute variant.

1. **Resolve the project.** Contribute mode: the target is `<p>`; show the `## Gaps` of
   `projects/<p>/wiki/open-questions.md` as seeds for this round's questions (file missing or no
   `## Gaps` → nothing to show), then step 2. A research project fixed by step 0 → continue it as
   a new round (as one match below), without topic matching. Otherwise, for each `projects/<p>/`
   with a `PROJECT.md`, `scripts/wiki project --name <p>` → `kind`; keep the `research` ones and
   compare their frontmatter `topic` with the requested topic.
   - One match → continue it as a new round: show its `## Research questions` and `## Scope`,
     and its `## Gaps` from `wiki/open-questions.md` — the previous round's gaps seed this one.
   - Several plausible matches → ask which one, lettered (step 2's format), and stop.
   - None → pick a slug (`[a-z0-9][a-z0-9._-]*`, short, from the topic) and run
     `scripts/project new <slug> --kind research --topic "<topic>"`. Exit 2 `exists` → that slug
     is taken: pick another; `archived` → ask. The scaffold writes `PROJECT.md` and `wiki/`.
2. **Interview** — one question per message, then stop and wait. Format every question per
   [[pavilio-ask]]: discrete choices lettered A)–C) plus D) Other, one markdown list item each
   after a blank line; a bare letter is that option; questions follow the user's language. Settle, in
   this order: research questions (what the round must answer), scope in, scope out, seed links
   (articles, YouTube videos the user already has). Write each item into the research
   `PROJECT.md` as soon as it settles — `## Research questions` (numbered), `## Scope` (`In:` /
   `Out:` lines), seed links as a list under `## Scope` — creating a section on first use, above
   `## See also`. A continued project only adds or amends; it never drops an answered question.
   Contribute mode: same interview, same order, but the answers are kept for this round only —
   nothing is written to `PROJECT.md`.
3. **Knowledge first** — walk `projects/knowledge/wiki/` for the topic along
   `skills/pavilio-wiki/CONVENTIONS.md § Reading ladder`, read-only (no query, no question page,
   no log entry). Note what is already known, with its pages as panel links, so the search
   skips it. No `knowledge` project → skip this step.
4. **Search** — web search for each research question not covered by step 3 or the seeds.
   Present the candidates numbered: `<n>. <title> — <why relevant> — article|video`. The user
   picks by number; only the picked ones and the seeds are fetched. With `-yolo`, pick at most 10
   (seeds are always kept and do not count) and list them before step 5.
5. **Fetch + ingest** — `/pavilio-wiki <p> ingest <url>…` with every seed and pick. That ingest
   fetches via `scripts/wiki fetch-article` / `fetch-youtube` into `wiki/raw/`; page writing and
   the `wiki/` commit are that run's too; never fetch outside it.
   Report every source the ingest dropped, with its reason.
6. **Answer** — each research question as a query: `/pavilio-wiki <p>: "<question>"`. It leaves
   the question page, cites every page as a panel link (`scripts/wiki panel-link <path>`) and
   records what the wiki cannot answer under `## Gaps`. Show the answers together.
7. **Spike** — only when a question needs an experiment. One `<slug>` per spike (short, from
   the question); the spikes repo is the `<p>-spikes` entry of `projects/<p>/repos.json`.
   - **Research project:** `scripts/project spike-repo <p>` → `path` (created and registered in
     `repos.json` on first use; exit 2 → ask). Write the code in `<path>/<slug>/` and commit it
     in that repo, never in the workspace.
   - **Contribute mode** (ordinary `<p>`): ask per spike (letters fixed), then stop:

     - **A)** Spike branch in a code repo *(recommended)* — `projects/<p>/repos.json` entries
       (`{name, path}`; `<repo>` = `path`) minus `<p>-spikes`; several → the user picks one;
       none → do not offer A, and C is recommended. Default branch = `git -C <repo>
       symbolic-ref --short refs/remotes/origin/HEAD` minus `origin/`, else the current branch.
       Run `git -C <repo> worktree add ../<repo-basename>-spike-<slug> -b spike/<slug> <default
       branch>` (branch or worktree exists → pick a new slug), write the code under
       `<worktree>/<slug>/` and commit it on `spike/<slug>`; never push, never use the workspace
       repo.
     - **B)** Skip — append the question to `## Gaps` in `projects/<p>/wiki/open-questions.md` as
       "needs an experiment", per `skills/pavilio-wiki/CONVENTIONS.md` (file or section missing →
       create it); an item already on the same question gets the note instead.
     - **C)** New spike folder — `scripts/project spike-repo <p>`, as in a research project.
     - **D)** Other, tell me how

   Every spike that ran: write the findings with [[pavilio-memo-explain]] to
   `projects/<p>/memo/`, then give `<slug>/` a one-line `README.md` linking the memo's
   `/project/<p>/memo?file=…` link that pavilio-memo-explain returns (committed with the code: on
   the branch for A, in the spikes repo otherwise) — never a `FINDINGS.md`, never a `panel-link`
   one. Spike memos are wiki records, so the next ingest picks them up, not this round's
   answers; note them in step 8's next-round line.
8. **Commit + next round** — commit `projects/<p>/PROJECT.md` (plus `repos.json` and the spike
   memos after a spike) as `<p>: research round <topic>` (the wiki commits are pavilio-wiki's).
   On a new project's first round commit the whole `projects/<p>/` instead (the scaffold's
   `STATUS.md` and `progress/` with it), never `.projects.local.md` — the registry row is local
   and gitignored. End with the gaps as the next round's search (plus any spike memo awaiting
   ingest), and the one-line hint `/pavilio-wiki-research <topic>` to run it.
   Contribute mode: commit the spike memos this round wrote, `projects/<p>/wiki/open-questions.md`
   when B ran and `repos.json` when C ran, as `<p>: research round <topic>`; never `PROJECT.md`;
   nothing staged → no commit. Same next-round hint — run from `<p>` it hits step 0 again.

Report: target project (new, continued or contributed to), questions settled, sources fetched /
dropped (with reasons), pages written, questions answered, gaps left (incl. "needs an
experiment"), spike memos (as their Memo-tab links), a spike branch's worktree path and branch.

## Non-goals

- Never writes or commits an ordinary project's `PROJECT.md`, and never pushes a spike branch.
- Never writes into `knowledge` — not a page, not a log line. Generic findings reach it only
  through the project's `## Knowledge candidates` and the user-run harvest
  (`/pavilio-wiki-ingest-knowledge`).
- Does not pick more than 10 sources per `-yolo` round (seed links come on top).
- Does not restate ingest or query steps — `skills/pavilio-wiki/SKILL.md` owns them.
