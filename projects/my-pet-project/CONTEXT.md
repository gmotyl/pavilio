# Finchwatch — context

> Example content. Finchwatch is a made-up hobby project: a microphone in a box
> on the garden fence that logs which birds show up, and when.

Terms below are used the same way in every note, ADR and memo in this folder.
If a word here starts meaning two things, split it instead of overloading it.

## Things

- **Perch box** — the weatherproof enclosure on the fence. One SBC, one USB mic,
  one power lead. "Box 1" is the one by the feeder; a second box is only proposed
  (see `adr/0003-second-box-uplink.md`).
- **Listener** — the always-on process on the box. Watches the mic level, writes
  clips. Knows nothing about birds.
- **Sorter** — the offline job that turns clips into detections. Runs on the
  laptop, not on the box.
- **Roost** — the little dashboard. Reads the database, draws the day.

## Data

- **Clip** — one ~10 s audio file written by the listener, named by timestamp.
  Disposable: clips age out after 30 days.
- **Detection** — one row: clip + species label + confidence + timestamp.
  Permanent. Detections are the actual dataset; clips are just evidence.
- **Tally** — a per-day, per-species count, rolled up from detections. What
  Roost charts.
- **Confidence floor** — the cutoff below which the sorter throws a guess away.
  Currently 0.62, tuned by hand and argued about roughly monthly.
- **Dedup window** — 90 s. The same species inside one window counts once, so a
  single loud robin doesn't become forty detections.

## Time

- **Dawn chorus window** — sunrise minus 45 min to sunrise plus 90 min. Busiest
  slice of the day; most tuning arguments happen about this window.
- **Quiet hours** — 22:00–04:00. The listener still runs; the mic gate is raised
  so passing cars and foxes don't fill the card.

## Non-terms

- Not "recording" — say clip (a file) or detection (a row).
- Not "bird count" — say tally. A tally counts detections, not birds; one bird
  singing all morning inflates it and that's a known, accepted lie.
