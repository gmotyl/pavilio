# 2. Split desks and rooms into separate models

- **Status:** Accepted — supersedes [0001-single-resource-table.md](0001-single-resource-table.md)
- **Date:** 2025-11-04

> Example content. Roomkeep is a fictional internal tool invented for this sample project.

## Context

The shared `resource` / `booking` tables from [0001](0001-single-resource-table.md) had become the main source of friction. Concretely, over the previous quarter:

- Desk bookings gained a check-in window and a Reclaim job. Rooms have neither.
- Room bookings gained attendee lists, recurrence, and an organiser who may not be an attendee. Desks have none of that.
- Three of five production incidents traced back to a query that forgot `kind`, or to a nullable column being read for the wrong kind.

Two rules that only ever apply to one kind were living in the same function, and neither was testable in isolation.

## Decision

Split into `desk` / `desk_booking` and `room` / `room_booking`. Each pair owns its own constraints and its own booking service. Overlap prevention stays in the database as an exclusion constraint per booking table — this is deliberately duplicated rather than abstracted.

A thin read-side `space_view` union backs the two places that genuinely need "everything bookable on this floorplate": the floorplan renderer and the search index.

Migration is expand/contract: write to both shapes, backfill, flip reads per floorplate, drop the old tables.

## Consequences

Positive:

- Constraints express the rules. `desk_booking` has no `capacity` column to misread.
- Desk and room logic can now change independently; the Reclaim job touches one table.
- Kind-forgetting bugs are structurally impossible in the write path.

Negative:

- Roughly 300 lines of near-duplicate CRUD. Accepted — the two copies drift on purpose.
- Anything that legitimately spans both kinds must go through `space_view`, and it is easy to reach for the underlying tables instead. Called out in code review.
- The migration ran across four floorplates and took most of a sprint.
