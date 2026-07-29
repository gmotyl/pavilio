# 3. Replace the nightly occupancy import with a queue consumer

- **Status:** Proposed
- **Date:** 2026-07-14

> Example content. Roomkeep is a fictional internal tool invented for this sample project.

## Context

Occupancy signals reach Roomkeep as a file the badge system drops nightly during quiet hours. A cron job parses it and writes one row per Space per day. That was fine when occupancy only fed the monthly utilisation report.

It is no longer fine:

- Reclaim now wants occupancy. A signal that lands the following night is useless for reclaiming a desk at 10:30 the same morning, so Reclaim currently relies on manual check-in only, and Stewards chase no-shows by hand.
- The import is all-or-nothing. One malformed row fails the batch, and nobody notices until the report is late. We have had three silent gaps this year.
- Reprocessing means re-fetching a file that may already have been rotated away.

The badge system can publish per-read events to the internal message broker; another team already consumes them for a different purpose.

## Decision

Consume badge-read events from the broker and fold them into occupancy signals as they arrive. Keep the nightly file as a reconciliation input only: replay it into the same handler, compare, and alert on drift. Delete the file path once two consecutive months reconcile clean.

Signals stay non-authoritative (see [CONTEXT.md](../CONTEXT.md)) — Reclaim treats a signal as a check-in, never as a reason to cancel someone's Booking.

## Consequences

Positive:

- Reclaim can act within the check-in window instead of the next day.
- Per-event failures are isolated and retryable; a bad read no longer costs a day of data.
- Idempotent handler means replay is safe, which the file path never was.

Negative:

- Roomkeep gains a runtime dependency on the broker and needs a dead-letter path and an alert on consumer lag.
- Out-of-order and duplicate reads become our problem. The handler must key on (space, day, reader event id).
- Occupancy stops being a stable end-of-day snapshot, so the utilisation report needs an explicit cutoff instead of "whatever the table says".

Open question before this can move to Accepted: whether the broker's retention is long enough to cover a multi-day Roomkeep outage, or whether we keep the file permanently as a backstop.
