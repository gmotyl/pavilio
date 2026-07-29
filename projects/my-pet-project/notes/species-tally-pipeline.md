# From clip to tally

How a sound becomes a number on the dashboard, and where each step lies to you.
Terms are as defined in `CONTEXT.md`.

## The four steps

1. **Listener → clip.** Box-side. Level above the rolling floor for 400 ms →
   write ~10 s of audio, timestamped. No labels, no judgement. Clips age out
   after 30 days (`adr/0002`).
2. **Sorter → detections.** Laptop-side, run manually every week or so. Each
   clip gets a species label and a confidence. Anything under the confidence
   floor (0.62) is dropped rather than stored as a maybe.
3. **Dedup.** Same species inside a 90 s window collapses to one detection.
   Applied at write time, so the stored detection count is already deduped —
   which is worth remembering before wondering why the numbers are so small.
4. **Rollup → tallies.** Per day, per species, a count. This is what Roost
   reads; nothing in the dashboard touches raw detections.

## Where it lies

- **Loud beats interesting.** A bird at the feeder trips the gate; the same bird
  in next door's tree doesn't. Tallies measure proximity as much as presence.
- **Presence is trustworthy, counts aren't.** "Species X was here on day Y" is
  solid. "Species X was here 14 times" mostly measures how long one individual
  sang, sampled by the dedup window.
- **The floor is a taste setting.** At 0.62 I get a clean list with occasional
  misses. Dropped it to 0.5 for one week in March and got a "detection" of
  something that doesn't live on this continent, so 0.62 stayed.
- **Truncated attack.** The 400 ms hold cuts the start of short calls. Two of
  the species I most want are exactly those, and they're under-detected for a
  reason that has nothing to do with the classifier.

## Known false friends

- Squeaky garden gate → consistently labelled as a small songbird. High
  confidence, too. Oiled the gate; problem solved in hardware.
- Distant car alarm → labelled as an alarm call, which is almost fair.
- Rain on the lid → raises the floor enough that a wet hour has near-zero
  detections. Rainy days look empty and aren't.

## Re-running

Detections are derived, so the sorter can be re-run over any clip still inside
retention. Practically that means the last 30 days are re-tunable and everything
older is frozen at whatever floor was current at the time — which makes
year-over-year comparisons across a floor change quietly invalid.
