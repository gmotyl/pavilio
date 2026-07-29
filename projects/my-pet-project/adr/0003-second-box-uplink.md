# 0003 — How a second perch box gets its data home

- **Status:** Proposed
- **Date:** 2026-06-21

## Context

Box 1 sits by the feeder, four metres from the house, on solid wifi. The tallies
it produces are therefore tallies of *the feeder*, not of the garden — the back
fence is a different habitat (hedge, no feeder, shade) and I'd bet it hears a
different set of species.

I want a Box 2 at the back fence, ~35 m out. Wifi there is one bar on a good
day and drops entirely when the hedge is wet. Mains power is not going down
there; it'll be a battery and a small panel.

The constraint that matters: clips are big and the link is bad. Detections are
tiny.

## Decision

Proposed, not settled. Three options on the table:

1. **Wifi repeater in the shed.** Box 2 behaves exactly like Box 1 — clips
   locally, database copied nightly. Cheapest in code, and mains is already in
   the shed. Depends on a link I've measured as unreliable.
2. **Low-bandwidth radio uplink, summaries only.** Box 2 runs the gate *and* a
   small on-box classifier, and sends detections only — no audio ever leaves the
   fence. Robust and low power. Means two different classifiers in the project,
   which breaks the `0002` rule that the box never decides what a sound is.
3. **Sneakernet.** Swap the card every fortnight when I'm out there anyway. Zero
   new failure modes, zero new code, and Box 2's data is always up to two weeks
   stale.

Leaning 3 for the first season to find out whether the back fence is even
interesting, then 1 if it is. Option 2 is the one I *want* to build, which is
exactly why it needs to wait for evidence.

## Consequences

- Under 3, Roost has to stop assuming "latest detection ≈ now". Every chart with
  a live edge grows a per-box freshness marker or it lies.
- Any option adds a `box_id` to detections and tallies, so the schema change
  lands regardless. Doing it before choosing is safe and unblocks the rest.
- Under 2, the confidence floor would be applied on the box, before the data
  ever reaches me — irreversible, unlike every other tuning knob in the project.
  That's the strongest argument against the option I like most.
