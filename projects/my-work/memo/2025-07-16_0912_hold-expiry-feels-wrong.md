# Hold expiry feels wrong

**2025-07-16 09:12** · example memo

Watched two people try to book desks in the same neighbourhood this morning and the Hold behaviour is not doing what we designed it for.

The 10-minute Hold assumes someone is actively picking. What actually happens: they open the floorplan, get pulled into a conversation, come back 20 minutes later, and the Hold is gone — but the UI still shows their seat highlighted, so they click confirm and get a conflict error on a desk that looks available. Two support pings about this in a week.

Two separate problems tangled together. The expiry length is probably fine. The bug is that the client never learns the Hold died, so it renders a stale claim. Fix is to have the Hold carry its expiry timestamp to the client and let the UI count down and clear itself, rather than discovering expiry at confirm time.

Second thing while I'm here: we create a Hold on hover-then-click, which means idle browsing generates Holds nobody wanted. Should only be on entering the confirm step.

Not urgent enough to jump the queue but write it down before I forget which of the two is the actual defect.
