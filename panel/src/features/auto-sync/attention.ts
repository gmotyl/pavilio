/** Concrete states that need a person; they win over `stale`. */
const CONCRETE = new Set(["conflict", "push-failed", "blocked"]);
const ATTENTION = new Set([...CONCRETE, "stale"]);

const ATTENTION_TEXT: Record<string, string> = {
  conflict: "Auto-sync: merge conflict — repo needs manual attention",
  "push-failed": "Auto-sync: push failed — repo needs manual attention",
  blocked: "Auto-sync blocked by local changes — commit or discard them",
  stale: "Auto-sync: no successful sync for a long time — check the panel",
};

/** The alert text for an attention state just entered, with the status detail appended. */
export function attentionMessage(state: string, detail: string): string {
  // syncRepo's blocked detail already names the files and the remedy — don't repeat it.
  if (state === "blocked" && detail) return `Auto-sync blocked: ${detail}`;
  return `${ATTENTION_TEXT[state]}${detail ? ` (${detail})` : ""}`;
}

export function effectiveState(s: { state: string; stale?: boolean }): string {
  if (CONCRETE.has(s.state)) return s.state;
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
