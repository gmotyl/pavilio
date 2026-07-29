# Roost should draw the year as one picture

**2026-01-04 22:47**

Six months of detections now and the dashboard still only shows one day at a
time. Wrong shape for the data. The interesting thing isn't "what was here
today", it's "when in the year did each species start showing up".

Idea: one heatmap per species. X axis = day of year, Y axis = hour of day, cell
= detection count. Stack them vertically, one strip per species, sorted by first
appearance.

What I think that would show:

- The dawn chorus window sliding earlier through spring, as a diagonal edge.
- Winter species as a solid block that just stops in a particular week.
- The 90 s dedup window flattening everything, because a bird singing for an
  hour is one cell's worth of hits. Might have to chart *presence* not count for
  this view. Presence is honest; count was always half a lie.

Cheap version: precompute an hour bucket column on tallies and let Roost read
that straight. No new pipeline, one extra column.

Not tonight. Writing it down so I stop re-inventing it every few weeks.
