# The perch box (hardware notes)

Everything physical about Box 1, written down because I forget it between
visits and it's cold out there.

## What's in it

- A spare single-board computer, headless, on the house wifi.
- One USB microphone on a short lead, capsule pointing down through a hole in
  the base plate.
- Power over a single outdoor-rated lead from the shed socket. No battery, no
  panel — Box 1 is mains and that's why it's the easy one.
- A cheap food container as the shell, lid down, mounted lid-side-up on the
  fence post about 1.8 m off the ground.

## Weatherproofing, learned the hard way

- **Mic points down.** First build had it pointing sideways through the wall and
  it drowned in the first proper rain.
- **Cable enters from below** with a drip loop. Water walks along a cable and
  will follow it inside if the cable enters from the top.
- **The hole is the enemy, not the rain.** One hole, silicone, done. Every extra
  hole is a future failure. This is the actual reason the stereo-pair idea in
  the July 2026 memo is annoying to try.
- **Leave a vent gap under the overhang.** Fully sealed meant condensation
  inside on the first cold clear night, which is worse than a little damp air.

## Gotchas

- **The card dies before anything else does.** Continuous writes killed one card
  under `adr/0001`. Since the level gate landed the write volume is a fraction
  of that, but the nightly database copy off the box is not optional.
- **Filesystem going read-only is silent.** The listener kept "running" for two
  days writing nothing. There's now a check that the newest clip is younger than
  the longest plausible silence, which is a genuinely awkward thing to define in
  January.
- **Wifi drops when the hedge is wet.** Confirmed, repeatedly, at Box 1's four
  metres. Directly informs the uplink options in `adr/0003` for a box at 35 m.
- **Fence posts move.** Mounting drifted enough over one winter to change the
  ambient floor. Re-check the mount before blaming the gate.

## If I rebuild it

Proper gland instead of silicone, mic on a longer lead so the electronics can
sit higher and drier than the capsule, and a mount that doesn't rely on the
fence being where it was last year.
