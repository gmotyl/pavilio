# 1. One shared `resource` table for desks and rooms

- **Status:** Superseded by [0002-split-desk-and-room-models.md](0002-split-desk-and-room-models.md)
- **Date:** 2025-06-11

> Example content. Roomkeep is a fictional internal tool invented for this sample project.

## Context

Roomkeep launched with two bookable things — desks and meeting rooms. Both have a name, a floorplate, a capacity, and a booking calendar. The overlap looked large enough that modelling them separately felt like duplication, and we were under pressure to get the first floorplate live before the office move.

Booking a desk and booking a room also shared a UI shell: pick a floorplate, see a plan, click a thing, confirm.

## Decision

Store both in a single `resource` table with a `kind` column (`desk` | `room`), and a single `booking` table pointing at it. Kind-specific fields (`capacity`, `organiser_id`, `neighbourhood_id`) are nullable columns on the shared tables. Validation of which fields apply to which kind happens in the application layer.

## Consequences

Positive:

- One set of CRUD endpoints, one conflict-checking code path, one import script.
- Shipped the first floorplate in six weeks.

Negative:

- Every query about desks carries `WHERE kind = 'desk'` and every reader has to remember it. We shipped two bugs from forgetting it.
- Half the columns are nullable, so the schema documents nothing. "Is `capacity` meaningful here?" is answerable only by reading application code.
- Desk and room booking rules diverged faster than expected — whole-day vs time-range, check-in windows, attendee lists — and the shared `booking` table grew conditional logic that reads as a permanent `if kind ==` branch.

By late 2025 the divergence was clearly structural rather than incidental, which led to [0002](0002-split-desk-and-room-models.md).
