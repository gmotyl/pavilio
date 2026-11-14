/**
 * What each cell's composer has typed but not sent yet.
 *
 * ## Why the draft does not live in the composer
 *
 * The pane is rendered only while it is open — `TerminalView` mounts it and
 * unmounts it — so the composer's `useState` is destroyed every time the user
 * closes the pane to look at the terminal underneath. A reply is written in the
 * middle of reading: glance at the output, go back, finish the sentence. With
 * the text in React state that round trip silently eats it, and the failure is
 * the worst kind — invisible until the sentence is already gone. Module state
 * outlives the mount, so the field comes back holding what was left in it.
 *
 * ## Why it is in memory only
 *
 * Nothing here is persisted and nothing is cleared on unload, deliberately. A
 * draft is unsent text addressed to a live agent session; a reload leaves that
 * session behind, and a reply restored out of storage into a cell that has
 * since moved on is worse than an empty field — it is a half-remembered
 * sentence sitting under an Enter meant for the new answer. Tab-scoped is
 * exactly the lifetime of the thing the draft is a reply to.
 *
 * The one thing that consumes a draft is a send — see `AnswerComposer`.
 * Closing the pane does not, a new answer arriving does not, unmounting does
 * not.
 *
 * ## Why the caret is held here too
 *
 * The text surviving is not enough when the cell around the pane is REBUILT
 * while the user is typing — a grid swap, maximize, a preset or a seam resize,
 * often at the moment an answer arrives. The focused field unmounts, its
 * replacement mounts unfocused with the caret at 0, and the keys typed next go
 * to whatever took focus instead: the pane's root or, on the grid's focused
 * cell, the terminal — so the end of the reply reaches the shell.
 *
 * So a composer taken down WHILE it held focus records its selection here
 * (`holdCaret`), and the next composer mounted for that session takes it back
 * (`takeHeldCaret`): focus, and the caret where it was. The mark is narrow on
 * purpose, because the panel's rule is that an arriving answer never focuses a
 * composer the user was not in:
 *
 * - it is taken ONCE — a second mount (the eye, an auto-open) gets nothing;
 * - a blur while mounted releases it (`releaseCaret`) — the user left the field;
 * - the composer that held it drops it again at the end of its task, so a
 *   mark nobody reclaimed in the rebuild itself (the composer switched off, the
 *   pane closed from the keyboard) cannot focus a field opened much later.
 *
 * In memory only, like the drafts and for the same reason.
 */
const drafts = new Map<string, string>();

/** Where a composer's selection was when it was taken down holding focus. */
export interface HeldCaret {
  start: number;
  end: number;
}

const carets = new Map<string, HeldCaret>();

/**
 * What this cell's composer should open with — `""` for a cell that has never
 * been typed in.
 *
 * Never `undefined`: the value is the `value` of a controlled textarea, and a
 * textarea handed `undefined` is an uncontrolled one for the rest of its life.
 */
export function getDraft(sessionId: string): string {
  return drafts.get(sessionId) ?? "";
}

/** Remember what the field holds now. Per cell — a reply belongs to one agent. */
export function setDraft(sessionId: string, text: string): void {
  drafts.set(sessionId, text);
}

/** Forget this cell's draft. The send that consumed it is the only caller. */
export function clearDraft(sessionId: string): void {
  drafts.delete(sessionId);
}

/**
 * Remember that this session's composer held focus, with this selection, as it
 * was unmounted. Only the composer's own unmount cleanup calls it.
 */
export function holdCaret(sessionId: string, caret: HeldCaret): void {
  carets.set(sessionId, { start: caret.start, end: caret.end });
}

/** Returns and forgets the held caret: one mount reclaims it, never two. */
export function takeHeldCaret(sessionId: string): HeldCaret | null {
  const caret = carets.get(sessionId) ?? null;
  carets.delete(sessionId);
  return caret;
}

/** Forget this session's held caret — the field blurred, so there is nothing to reclaim. */
export function releaseCaret(sessionId: string): void {
  carets.delete(sessionId);
}

/**
 * Test-only teardown: these drafts and carets are tab-scoped module state that
 * outlives a test's unmount the same way the session store and the sidebar fold
 * do, so `test-setup.ts` clears them between tests.
 */
export function __resetComposerDraftsForTests(): void {
  drafts.clear();
  carets.clear();
}
