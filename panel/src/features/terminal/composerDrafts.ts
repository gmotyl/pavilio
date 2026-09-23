/**
 * What each cell's composer has typed but not sent yet.
 *
 * ## Why the draft does not live in the composer
 *
 * The pane is rendered only while it is open — `TerminalView` mounts it and
 * unmounts it — so the composer's `useState` is destroyed every time the user
 * presses Escape to look at the terminal underneath. A reply is written in the
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
 */
const drafts = new Map<string, string>();

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
 * Test-only teardown: these drafts are tab-scoped module state that outlives a
 * test's unmount the same way the session store and the sidebar fold do, so
 * `test-setup.ts` clears them between tests.
 */
export function __resetComposerDraftsForTests(): void {
  drafts.clear();
}
