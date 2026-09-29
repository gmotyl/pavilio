/**
 * Which session the fullscreen terminal area shows.
 *
 * On mobile, and when a cell is maximized, `TerminalLayoutGrid` keeps every
 * session mounted and reveals exactly one: the focused session when it is still
 * in the list, otherwise the first. Anything that must follow "the session on
 * screen" — not merely "the focused one", which can name a session that is
 * gone — reads this helper, so it can never disagree with what the grid shows.
 */

/** The session the fullscreen (mobile / maximized) terminal area shows. */
export function visibleSessionId(
  sessions: readonly { id: string }[],
  focusedId: string | null,
): string | null {
  if (focusedId && sessions.some((s) => s.id === focusedId)) return focusedId;
  return sessions[0]?.id ?? null;
}
