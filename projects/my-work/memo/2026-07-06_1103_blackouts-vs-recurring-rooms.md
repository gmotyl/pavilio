# Blackouts vs recurring room bookings

**2026-07-06 11:03** · example memo

Blackout on a floorplate next month for the refit, and it surfaced a gap: nobody decided what a Blackout does to recurring room Bookings that reach into it.

Right now the constraint rejects new Bookings inside a Blackout, and existing single Bookings get cancelled when the Blackout is created. Recurring ones are untouched, because a recurrence is stored as a rule plus generated instances and the cancel step only looks at instances that already exist. So instances generated after the Blackout is set slide straight through and land inside it.

Three plausible behaviours and they are genuinely different products:

1. Cancel the whole series. Brutal, and wrong — most series outlive the Blackout.
2. Suppress the overlapping instances, keep the series. Probably what people mean, and the organiser needs telling.
3. Refuse to create the Blackout until someone resolves the conflicts. Honest, but pushes the work onto Facilities at the worst moment.

Leaning (2) with a mandatory notice to organisers. Wants a real decision rather than my preference — this is small enough to skip an ADR but big enough that I should not just pick it alone.
