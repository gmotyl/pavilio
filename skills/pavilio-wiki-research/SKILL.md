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
toward the 10. It does not skip step 0's target question nor the interview.

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
   `/pavilio-session-start`, `/pavilio-wiki` or another project-scoped skill), else `<p>` of a
   `pwd` inside `projects/<p>/`. Check its `kind` with `scripts/wiki project --name <p>`.
   - None, `knowledge`, or a research project whose `topic` matches → ask nothing; step 1 as
     written (a matching one continues as a new round). `knowledge` is never a target.
   - An ordinary project, or a research project with another topic → ask per [[pavilio-ask]]
     (letters fixed), then stop:

     - **A)** Contribute to `<p>`'s wiki *(recommended)*
     - **B)** New or continued research project on `<topic>`
     - **D)** Other, tell me how

     A on an ordinary project → **contribute mode**. A on a research project → its next round
     in today's research flow (step 1 keeps it, skipping topic matching). B → step 1 as written.
   **Contribute mode** (ordinary `<p>`): no project is scaffolded; `<p>`'s `PROJECT.md` is never
   written nor committed. Steps 3–6 run unchanged against `<p>` (`/pavilio-wiki <p> ingest …`,
   `/pavilio-wiki <p>: "…"`; a missing `wiki/` is created by that ingest); question pages and
   `## Gaps` are the round's durable record. Steps 1, 2, 7 and 8 note their contribute variant.

1. **Resolve the project.** Contribute mode: the target is `<p>`; show the `## Gaps` of
   `projects/<p>/wiki/open-questions.md` as seeds for this round's questions, then step 2.
   Otherwise, for each `projects/<p>/` with a `PROJECT.md`,
   `scripts/wiki project --name <p>` → `kind`; keep the `research` ones and compare their
   frontmatter `topic` with the requested topic.
   - One match → continue it as a new round: show its `## Research questions` and `## Scope`,
     and its `## Gaps` from `wiki/open-questions.md` — the previous round's gaps seed this one.
   - Several plausible matches → ask which one, lettered (step 2's format), and stop.
   - None → pick a slug (`[a-z0-9][a-z0-9._-]*`, short, from the topic) and run
     `scripts/project new <slug> --kind research --topic "<topic>"`. Exit 2 `exists` → that slug
     is taken: pick another; `archived` → ask. The scaffold writes
     `PROJECT.md` and `wiki/` (with `wiki/raw/`).
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
7. **Spike** — only when a question needs an experiment. `scripts/project spike-repo <p>` →
   `path` (created and registered in `repos.json` on first use; exit 2 → ask). Write the code in
   `<path>/<spike-slug>/` and commit it in that repo, never in the workspace. Write the findings
   with [[pavilio-memo-explain]] to `projects/<p>/memo/`, then give `<spike-slug>/` a one-line
   `README.md` linking the memo's `/project/<p>/memo?file=…` link that pavilio-memo-explain
   returns — never a `FINDINGS.md`, never a `panel-link` one. Spike memos are wiki records, so
   the next ingest picks them up — this round's answers do not include them; note them in step
   8's gaps / next-round line.
   Contribute mode (ordinary `<p>`) — ask per spike, lettered (letters fixed), then stop:
   - **A)** Spike branch in a code repo *(recommended)* — repos from `projects/<p>/repos.json`
     minus the spikes repo; several → the user picks one; none → do not offer A. Run
     `git -C <repo> worktree add ../<repo-basename>-spike-<slug> -b spike/<slug> <default branch>`,
     write the code under `<worktree>/<spike-slug>/` and commit it on `spike/<slug>`; never push,
     never use the workspace repo.
   - **B)** Skip — record the question under `## Gaps` as "needs an experiment".
   - **C)** New spike folder — `scripts/project spike-repo <p>`, as in a research project.

   Memo + one-line `README.md` as above for A and C (A: the README is committed on the branch).
8. **Commit + next round** — commit `projects/<p>/PROJECT.md` (plus `repos.json` and the spike
   memos after a spike) as `<p>: research round <topic>` (the wiki commits are pavilio-wiki's).
   On a new project's first round commit the whole `projects/<p>/` instead (the scaffold's
   `STATUS.md` and `progress/` with it), never `.projects.local.md` — the registry row is local
   and gitignored. End with the gaps as the next round's search (plus any spike memo awaiting
   ingest), and the one-line hint `/pavilio-wiki-research <topic>` to run it.
   Contribute mode: commit only the spike memos this round wrote, as `<p>: research round
   <topic>` (plus `repos.json` after C); never `PROJECT.md`. The next-round hint is the same —
   run from `<p>` it hits step 0 again.

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
