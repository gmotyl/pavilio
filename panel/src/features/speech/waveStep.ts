/**
 * The two rules that make the wave a POSITION in a cell's walk rather than a
 * lid over its newest answer — as two pure predicates, in one file, because
 * four places have to agree about them.
 *
 * The walk:
 *
 * ```
 *  older                                                          newer
 *  previous[n] … previous[0]   current   pending[…]   [ the wave ]
 *         ◄────────── previous ──────────      ── next ──►
 * ```
 *
 * The wave is where the pane's body goes while the agent works. It is NOT an
 * utterance and has no cursor index: `held` names it instead, so nothing that
 * reads the cursor — `utteranceUnderCursor`, the play control, the scrubber,
 * the reducer's same-reference no-op guards — grows a null-position case.
 *
 * ## Why a shared file rather than two `if`s
 *
 * Three surfaces raise the transport: the row's controls, the
 * `Ctrl+Shift+Arrow` chord (`useSpeechKeys`) and the OS media keys
 * (`useMediaSessionTransport`). They all funnel into `useSpeechHost`, which is
 * why the STEP is implemented there once. But a fourth reader exists and cannot
 * be folded into it — the row's two `disabled` attributes, which are
 * presentation and must answer the same question the step will. An end that
 * disagrees with the step either offers a press that does nothing or refuses
 * one that would have worked, and the type checker sees neither.
 *
 * The first version of this change had the step in the row alone. The chord was
 * then a second transport: a no-op on the very cell a reload strands, and a
 * step straight PAST the newest answer wherever history existed. This file is
 * the shape that makes that class of drift impossible to write.
 */

/**
 * Whether a BACKWARD press lands on the answer under the cursor instead of
 * stepping behind it — the wave's own step down.
 *
 * `hasAnswerUnderCursor` is asked rather than assumed: a cell that has never
 * spoken has nothing for the wave to sit on top of, so the wave adds no
 * position and the row's "transport disabled until the first answer" rule is
 * untouched.
 */
export const stepsOffTheWave = (
  waiting: boolean,
  held: boolean,
  hasAnswerUnderCursor: boolean,
): boolean => waiting && !held && hasAnswerUnderCursor;

/**
 * Whether a FORWARD press lands back on the wave instead of stepping towards
 * the newest answer.
 *
 * The gate is **nothing ahead of the cursor**, not "the cursor is on
 * `current`". With a backlog the newest answer the cell holds is
 * `pending.at(-1)` — which is what the row's own unread mark counts — so the
 * wave sits above the BACKLOG, and forward from `current` steps into it.
 * Releasing on a queued cell would spend the hold without moving and cost a
 * second press to go one place.
 */
export const stepsOntoTheWave = (held: boolean, cursor: number, pending: number): boolean =>
  held && cursor === 0 && pending === 0;
