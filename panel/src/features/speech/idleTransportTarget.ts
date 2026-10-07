/**
 * Which cell the transport acts on when **nothing is playing** — the one rule
 * both transport surfaces (`useMediaSessionTransport`, `useSpeechKeys`) share,
 * so a media key and `Ctrl+Shift+Space` can never disagree about it.
 *
 * In order:
 *
 * 0. The cell whose cursor the transport last **stepped** (next / previous),
 *    as long as no run has started since. A step is the user working that
 *    cell's transport; the play that follows means "this one". Without it a
 *    step back onto a heard answer drops the cell out of rule 1 — its answer
 *    under the cursor is no longer unheard — and the next press lands on some
 *    other cell, so the transport would walk away from the cell it just moved.
 * 1. The **autoplay** cell holding the unheard answer that arrived earliest.
 *    Several cells may autoplay now, so "the first autoplay cell" is no longer
 *    an answer: the one owed the longest is, which is also the order autoplay
 *    itself would have spoken them in.
 * 2. Else the cell that **spoke last**, which plays what is under its cursor —
 *    "play" on an idle panel most plausibly means "that again".
 * 3. Else nothing.
 *
 * A cell the panel knows has closed is no candidate in any of the three: the
 * channel never forgets a session, so a closed cell would otherwise keep
 * winning and speak (or appear to do nothing) where no cell is shown.
 *
 * Pure on purpose: the host supplies the readings, and the rule is pinned
 * without mounting anything.
 */
export interface IdleTransportInput {
  /** Every cell in autoplay, in the channel's order (the tie-break). */
  autoplaySessionIds: readonly string[];
  /** Arrival order of the cell's oldest unheard answer; `null` when it has none. */
  oldestUnheardArrival: (sessionId: string) => number | null;
  /** The cell the player last started a run in, if any has ever spoken. */
  lastSpokenSessionId: string | null;
  /** The cell the transport last stepped through, until a run starts; absent or null for none. */
  steppedSessionId?: string | null;
  /** False for a session the panel knows has closed. Absent: every session counts. */
  isSessionOpen?: (sessionId: string) => boolean;
}

export function idleTransportTarget(input: IdleTransportInput): string | null {
  const open = (sessionId: string | null | undefined): sessionId is string =>
    !!sessionId && (input.isSessionOpen?.(sessionId) ?? true);

  if (open(input.steppedSessionId)) return input.steppedSessionId;

  let oldest: { sessionId: string; arrival: number } | null = null;
  for (const sessionId of input.autoplaySessionIds) {
    if (!open(sessionId)) continue;
    const arrival = input.oldestUnheardArrival(sessionId);
    if (arrival === null) continue;
    // Strictly earlier, so a tie keeps the cell listed first.
    if (!oldest || arrival < oldest.arrival) oldest = { sessionId, arrival };
  }
  if (oldest) return oldest.sessionId;
  return open(input.lastSpokenSessionId) ? input.lastSpokenSessionId : null;
}
