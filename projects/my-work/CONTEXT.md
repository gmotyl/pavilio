# Context — Roomkeep

> Example content. Roomkeep is a fictional internal tool invented for this sample project.

Roomkeep is the internal desk- and room-booking tool maintained by the Workplace Tools team. This file is the shared vocabulary — if a term shows up in a ticket, an ADR, or a memo, it should be defined here first.

## Domain terms

- **Space** — anything bookable. Always one of two kinds: a **Desk** or a **Room**. "Resource" is the old word for this; avoid it (see [adr/0001-single-resource-table.md](adr/0001-single-resource-table.md)).
- **Desk** — a single seat. Booked for a whole day, one person, no attendee list.
- **Room** — a meeting space. Booked for a time range, has a capacity and an organiser.
- **Floorplate** — one floor of one building. The unit we roll out by; a floorplate is either live in Roomkeep or it isn't.
- **Neighbourhood** — a named cluster of desks on a floorplate, usually owned by one team. Desks belong to exactly one neighbourhood.
- **Booking** — a confirmed claim on a Space. Immutable once the day starts; changes create a new Booking and cancel the old one.
- **Hold** — a soft, unconfirmed claim that expires after 10 minutes. Created while someone is picking a desk in the UI so two people can't land on the same seat.
- **Check-in window** — the first 90 minutes of a desk Booking. Miss it and the Booking is reclaimed.
- **Reclaim** — the job that cancels un-checked-in desk Bookings and returns the desk to the pool. Runs every 15 minutes.
- **Occupancy signal** — evidence that a Space was actually used, derived from the badge-reader export. Never authoritative on its own; only ever used to trigger a Reclaim or feed reporting.
- **Steward** — the person accountable for a neighbourhood's desk allocation. Can override a Reclaim and can move desks between neighbourhoods.
- **Blackout** — a date range where a floorplate (or part of it) accepts no Bookings. Used for moves, deep cleans, and events.
- **Quiet hours** — the nightly window when the import job and Reclaim backlog run. Deploys are avoided here.

## Naming rules

- Code and API use `desk` / `room`, never `resource`.
- IDs are opaque strings; never build meaning into them (no floor number prefixes).
- User-facing copy says "seat" for a Desk. The code does not.

## See also

- [notes/architecture.md](notes/architecture.md)
- [notes/booking-rules.md](notes/booking-rules.md)
- [notes/floorplate-rollout.md](notes/floorplate-rollout.md)
