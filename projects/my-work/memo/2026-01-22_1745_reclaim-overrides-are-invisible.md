# Reclaim overrides are invisible

**2026-01-22 17:45** · example memo

Steward asked me today why "their" desks keep freeing up mid-morning. Took twenty minutes to reconstruct: Reclaim had cancelled four Bookings in that neighbourhood, the Steward had overridden two of them, and there is no record anywhere that either thing happened. I found it by reading the job log.

So: Reclaim is a destructive action with no audit trail and no notification. The person who lost their desk gets nothing, the Steward who restored it gets nothing, and we can only explain it by grepping logs. That is the whole complaint, and it is fair.

Minimum viable fix — a `desk_booking_event` row for every Reclaim and every override, with actor and reason, surfaced on the neighbourhood view. Notification to the affected person can come later; the trail is the part that makes the tool trustworthy.

Related: nobody has ever tuned the 90-minute check-in window. It was a guess in the first sprint. Once we have events we can actually measure how many Reclaims get overridden, and if that number is high the window is simply too short.
