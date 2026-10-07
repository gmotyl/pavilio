/**
 * Which cell the transport acts on when **nothing is playing** — the one rule
 * both transport surfaces (`useMediaSessionTransport`, `useSpeechKeys`) share,
 * so a media key and `Ctrl+Shift+Space` can never disagree about it.
 *
 * In order:
 *
 * 1. The **autoplay** cell holding the unheard answer that arrived earliest.
 *    Several cells may autoplay now, so "the first autoplay cell" is no longer
 *    an answer: the one owed the longest is, which is also the order autoplay
 *    itself would have spoken them in.
 * 2. Else the cell that **spoke last**, which plays what is under its cursor —
 *    "play" on an idle panel most plausibly means "that again".
 * 3. Else nothing.
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
}

export function idleTransportTarget(input: IdleTransportInput): string | null {
  let oldest: { sessionId: string; arrival: number } | null = null;
  for (const sessionId of input.autoplaySessionIds) {
    const arrival = input.oldestUnheardArrival(sessionId);
    if (arrival === null) continue;
    // Strictly earlier, so a tie keeps the cell listed first.
    if (!oldest || arrival < oldest.arrival) oldest = { sessionId, arrival };
  }
  return oldest?.sessionId ?? input.lastSpokenSessionId;
}
