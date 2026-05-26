# A busy state shorter than 10 seconds is not real work

The per-project time tracker watches the same `busy` state that drives the
terminal-activity LED. Output from a shell prompt redraw, a `git status` in
a powerlevel10k prompt, or a `clear` followed by a new prompt all flick the
state to `busy` for one or two seconds without representing real work. If
the tracker counts every flick, the auto-tracked "today" badge climbs
during periods when the user wasn't actually using the agent — and Greg
ends up with a chargeable number he can't defend to a client.

The server-side activity state machine already has a canonical threshold
for "did real work" vs "noise": `BUSY_THRESHOLD_MS = 10_000` in
`panel/server/lib/terminalActivity.ts`. When a busy session ends after
less than 10 seconds of cumulative output, the LED returns to `idle`
rather than `attention`. The time tracker now uses the same threshold:
a busy state must persist for 10 continuous seconds before the
[[Busy block]] opens.

This pairs with a second rule the gemini-code-assist bot caught on the
PR review: while `agentBusy` stays `true` past 15 minutes, the
accumulator's per-minute tick re-dispatches a `busy` event to extend the
lock. Without that extension, a 30-minute continuous agent run would
have closed the block at 15 minutes and undercounted the second half.
Debounce-on-entry and extend-while-continuous together produce the
intended billing semantics: short flickers vanish, long sessions
accumulate accurately.

## Considered options

- **No debounce, raw edge-trigger** — what the first cut shipped with.
  Every prompt redraw opens a 15-minute slot. Auto-tracked total
  overstates real work and cannot be trusted as a billing reference.

- **Long debounce (60s+)** — would eliminate every false positive but
  also misses legitimate short-running commands (e.g. a 20-second
  test run is real billable work).

- **10s debounce matching the server's `BUSY_THRESHOLD_MS`** *(chosen)* —
  reuses an existing, defended threshold from the activity-LED design.
  The constants in client and server are duplicated (one in
  `panel/src/features/time/useBusyAccumulator.ts`, one in
  `panel/server/lib/terminalActivity.ts`) — both carry an inline
  cross-reference comment. If the LED's "real work" threshold ever
  changes, both should move together.

- **Source from the server's `attention` state instead of `busy`** —
  natural alternative, since the server already distinguishes flicker
  from real work via the busy→attention transition. Rejected because
  `attention` only resolves *after* a quiet period (1s `IDLE_DEBOUNCE_MS`
  plus the 10s `BUSY_THRESHOLD_MS`). The tracker needs to start
  accumulating while the agent is still running, not 11 seconds after
  it stops. The 10s debounce on the busy edge gives us the same
  filtering with the right phase.

## Consequences

- Sub-10s output bursts are silently ignored — they appear nowhere in
  the tracker's totals. Acceptable since they also don't trip the
  attention LED.

- A real busy session under 10 seconds is dropped too (e.g. running
  `ls` in a tracked terminal). Acceptable trade-off: those are
  rarely the kind of work the user bills for, and the tracker is
  a *suggestion* for filling in the manual entry, not the manual
  entry itself. Greg can always log time manually.

- Continuous activity past 15 minutes now extends the slot via the
  per-minute tick. The recorded duration overshoots actual activity
  by up to 15 minutes at the tail (the lock decays after the last
  busy heartbeat). Acceptable because the auto-tracked number is
  a *reference*, and Greg fills in the chargeable hours manually.

- The 10-second value is duplicated in client and server modules.
  A future ADR or shared-constants extraction is fair game if more
  state-machine constants leak between the two surfaces.

- This rule is per-project: each [[useBusyAccumulator]] instance
  runs its own debounce timer keyed by `projectName`, so a flick
  in project A does not arm a debounce in project B.
