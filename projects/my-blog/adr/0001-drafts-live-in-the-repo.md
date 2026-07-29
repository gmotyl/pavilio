# 0001 — Drafts live in the repo, not in the site editor

## Status

Accepted — 12 June 2025

## Context

Posts were being started in the site's built-in editor and left there. The editor
had no history, so a paragraph rewritten badly was gone. Worse, there was no way to
see how many half-finished things existed: the draft list was a modal I never opened.

Meanwhile the survey data for the Kerb Walk was already in the repo as CSV, so
half the project was versioned and half was not.

## Decision

Everything textual lives in the repo as markdown. Three folders, and a post moves
one way only:

```
drafts/     stubs and works in progress — no date in the filename
ready/      finished, waiting for a slot in the calendar
posts/      published, filename gets the publication date prefix
```

Publishing is a move from `ready/` to `posts/` plus a rename. The site editor is
used for nothing but the final preview.

## Consequences

- Every rewrite is recoverable. The badly-rewritten paragraph problem is gone.
- `ls drafts/` is an honest count of unfinished work. It was eleven. That was useful
  to know and slightly demoralising.
- Front matter now has to be hand-written. Small tax, worth it.
- The four-a-year roundup can be assembled by reading `posts/` filenames instead of
  scrolling the site archive.
- Stubs accumulate silently. Reviewed each season — see
  [notes/seasonal-cadence.md](../notes/seasonal-cadence.md).
