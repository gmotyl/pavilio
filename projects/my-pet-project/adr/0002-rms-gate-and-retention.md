# 0002 — Level gate on the box, 30-day clip retention

- **Status:** Accepted
- **Date:** 2025-10-05
- **Supersedes:** [0001](0001-record-everything-sort-later.md)

## Context

Continuous recording filled the card in under three weeks and produced a corpus
that was overwhelmingly nothing. With three months of real audio measured, I now
know two useful facts:

1. Ambient level in the garden sits in a narrow band that drifts slowly with
   weather and time of day. A fixed threshold is wrong twice a day; a rolling
   one tracks it fine.
2. Detections are small and clips are enormous. Keeping every clip forever costs
   real money and buys almost nothing after the first look.

## Decision

**Gate on the box.** The listener keeps a rolling 10-minute level floor and only
writes a clip when the signal sits above floor + margin for at least 400 ms.
During quiet hours the margin is raised so foxes and cars don't trigger it.

**Split the lifetimes.** Clips expire 30 days after they're written, swept
nightly. Detections and tallies are permanent and live in a single database file
that gets copied off the box every night.

**Keep the sorter offline.** The gate decides *whether to keep audio*. It never
decides *what the audio is*. Species labelling stays a separate, re-runnable
step on the laptop.

## Consequences

Good:

- Clips dropped by roughly 95 %. The card has not been more than a third full
  since. The nightly sweep takes under a second.
- Because clips are already interesting, the sorter finishes in minutes instead
  of a whole evening.
- Re-running the sorter with a new confidence floor is cheap for the last 30
  days, which is the only window I ever actually revisit.

Bad:

- Anything quieter than the margin is gone forever and I will never know what I
  missed. Distant calls are systematically underrepresented in every tally.
- The 400 ms hold clips the front of short alarm calls. Two species I care about
  start with a click; those come in truncated and the sorter is worse at them.
- Retention is 30 days everywhere, including for a species seen once. Losing the
  only clip of a rare visitor to a routine sweep would be genuinely annoying —
  a "pin this clip" escape hatch is the obvious missing piece and isn't built.
