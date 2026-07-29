# 0001 — Record everything, sort it out later

- **Status:** Superseded by [0002](0002-rms-gate-and-retention.md)
- **Date:** 2025-06-14

## Context

First weekend of Finchwatch. The perch box is a spare SBC and a USB mic taped
inside a lunchbox. I have no idea what the audio actually looks like: how loud a
blackbird is versus a lawnmower, how much of the day is silence, whether the mic
clips when it rains.

Writing a smart trigger before I've heard the data is guessing. The cheap move
is to record continuously and keep everything, then decide what matters by
looking at real files.

## Decision

The listener records continuously and writes every 10 s window to disk as a
clip. Nothing is filtered, nothing is deleted. Classification happens later, in
bulk, whenever I feel like running the sorter.

A 128 GB card gives roughly three weeks of headroom at the bitrate I picked,
which felt like plenty of runway for an experiment.

## Consequences

Good:

- I got a real corpus in four days, including rain, wind, and a very committed
  neighbour's leaf blower. Every threshold in `0002` came out of that corpus.
- Nothing is lost while the pipeline is half-built. Every wrong classifier run
  is re-runnable against the same audio.

Bad:

- The card filled in 19 days, not three weeks — I was wrong about the bitrate.
  The listener kept writing until the filesystem went read-only and the box went
  quiet for two days before I noticed.
- ~94 % of the corpus is silence or traffic. Sorting it burns an evening of
  laptop fan noise for very little signal.
- No retention story at all, so "the dataset" and "the disk" are the same thing.
  Losing the card loses the project.

Superseded once I had enough audio to set a sensible gate. Keeping the ADR
because the 30-day retention number in `0002` is only defensible with the
measurements this phase produced.
