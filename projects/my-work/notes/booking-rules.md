# Booking rules

> Example content. Roomkeep is a fictional internal tool invented for this sample project.

The rules that govern a Booking, in the order they are applied. Terms are defined in [CONTEXT.md](../CONTEXT.md).

## Where each rule lives

Rules fall into three tiers and it matters which tier a new rule joins:

- **Database constraint** — invariants that must never be violated regardless of caller. Overlap is the main one: each booking table carries an exclusion constraint over (space, time range). No application code may assume it is the only writer.
- **Booking service** — policy that depends on who is asking or what day it is. Quotas, Blackouts, check-in windows.
- **UI** — hints only. Everything the UI blocks is re-checked server-side. The UI is allowed to be more restrictive, never less.

## Desk bookings

1. Bookings are whole-day. There is no half-day desk.
2. One desk per person per day. A second booking replaces the first and cancels it.
3. Booking horizon is 14 days ahead. Stewards can exceed it for their own neighbourhood.
4. A Hold is taken when the confirm step opens and expires after 10 minutes. A Hold is not a Booking and never appears in reporting.
5. Check-in window is the first 90 minutes. Reclaim cancels anything un-checked-in and returns the desk to the pool.
6. A Steward may override a Reclaim for their neighbourhood on the same day only.

## Room bookings

1. Bookings are time ranges, minimum 15 minutes, aligned to 5-minute boundaries.
2. The organiser is always recorded and is not necessarily an attendee.
3. Attendee count above room capacity is a warning, not a rejection — people stand.
4. Recurrence is stored as a rule plus generated instances, 90 days ahead, extended nightly.
5. No check-in window and no Reclaim. Unused rooms are a reporting problem, not an enforcement one.

## Blackouts

A Blackout wins over everything except an in-progress Booking. Creating one cancels overlapping single Bookings and notifies the owners. Recurring room Bookings that reach into a Blackout are **not yet handled consistently** — see [memo/2026-07-06_1103_blackouts-vs-recurring-rooms.md](../memo/2026-07-06_1103_blackouts-vs-recurring-rooms.md).

## Things deliberately not rules

- No approval workflow. Booking a desk is not a request.
- No priority or seniority. First confirmed Booking wins.
- No automatic release of desks when someone books time off — we do not read the calendar for this, and Reclaim covers the common case.
