const ATTENTION = new Set(["conflict", "push-failed", "stale"]);

export function effectiveState(s: { state: string; stale?: boolean }): string {
  return s.stale ? "stale" : s.state;
}

/** Returns the attention state just entered, or null (no transition / first observation). */
export function attentionTransition(
  prev: string | null,
  next: { state: string; stale?: boolean },
): string | null {
  const eff = effectiveState(next);
  if (prev === null) return null; // page load — don't toast history
  if (eff === prev) return null;
  return ATTENTION.has(eff) ? eff : null;
}

let lastEffective: string | null = null;

/** Shared across all hook instances so concurrent pollers can't double-report one transition. */
export function observeTransition(next: { state: string; stale?: boolean }): string | null {
  const entered = attentionTransition(lastEffective, next);
  lastEffective = effectiveState(next);
  return entered;
}

export function resetAttentionForTest(): void {
  lastEffective = null;
}
