# Rolling out a floorplate

> Example content. Roomkeep is a fictional internal tool invented for this sample project.

What it takes to bring one floor of one building live in Roomkeep. Written after the fourth rollout, when the steps had stopped changing.

## Prerequisites

A floorplate cannot go live until all four exist:

1. **A plan drawing** with every bookable Space marked and labelled. Facilities owns this; it is the single most common blocker.
2. **Neighbourhood boundaries** agreed, with a named Steward per neighbourhood. Unowned desks end up in a catch-all neighbourhood and immediately become a support problem, so we no longer allow it.
3. **Space records loaded**, desks and rooms separately (see [adr/0002-split-desk-and-room-models.md](../adr/0002-split-desk-and-room-models.md)).
4. **A Blackout covering the move itself**, so nobody books a desk that is still in a crate.

## Sequence

1. Load Spaces with the floorplate flagged not-live. Everything is queryable, nothing is bookable.
2. Walk the floor against the plan. Expect discrepancies — every rollout so far has found desks that exist physically and not in the drawing, and at least one room that had been repurposed.
3. Fix the drawing, not the data. The drawing is the source of truth; reconciling in Roomkeep only hides the divergence until the next rollout.
4. Brief the Stewards. They need to know what a Reclaim is before their people start losing desks to it, otherwise the first week generates a wave of tickets.
5. Flip the floorplate live, Blackout still in force.
6. Lift the Blackout on move-in day, and keep the booking horizon short for the first week so mistakes expire quickly.

## What has gone wrong

- **Stale plan drawing** — twice. Both times we went live with desks that did not exist and had to blackout individual Spaces after the fact.
- **Missing Steward** — one neighbourhood went live unowned, which meant no one could override a Reclaim, which meant the Reclaims looked like a Roomkeep bug for three days.
- **Occupancy gap** — the badge export does not cover a new floorplate until the badge system's own config catches up, usually a week behind. Utilisation numbers for the first week are therefore meaningless and we should stop reporting them. The queue-based ingest in [adr/0003-occupancy-ingest-via-queue.md](../adr/0003-occupancy-ingest-via-queue.md) does not fix this — the lag is upstream of us.

## Rough effort

Two to three weeks elapsed per floorplate, of which our engineering work is about two days. The rest is waiting on drawings and on people deciding who owns what.
