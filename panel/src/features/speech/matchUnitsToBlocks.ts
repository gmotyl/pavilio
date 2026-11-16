/**
 * How a rendered markdown block relates to the speech unit it was spoken as —
 * by text, not by offsets. Play from here (`firstUnitsOfBlocks`) pairs the
 * blocks with units in page order using these rules.
 *
 * Offsets were the obvious alternative and were rejected: a unit is the end
 * product of a dozen stripping and packing passes (`stripToSpeakableText`,
 * marker removal, sentinels, pronunciation, packing to a floor, cutting at a
 * ceiling), and none of them keeps a line range back into the markdown. The
 * renderer walks the same markdown independently. Threading source positions
 * through both pipelines would touch every pass for a result that, for prose,
 * text matching already gives: the paragraph the voice is reading *is* the
 * paragraph on screen, modulo markers — so normalize both sides and compare.
 *
 * `SpeechUnit.source` is the packed paragraph text before markers, sentinel
 * wording and pronunciation, which is what makes the comparison possible: the
 * spoken `text` says "code block" and "dizajn", the source still says `⟦code⟧`
 * and "design", and the rendered block says "design" too.
 *
 * Two constants shape the rules (see {@link blockMatchStrength}):
 *
 * - `MIN_MATCH_CHARS` (12): a floor on *both* sides of every substring and
 *   window rule. On the block it keeps a one-word list item — "Tests" — from
 *   matching every unit that contains the word through `u.includes(b)`. On the
 *   unit it keeps a short unit — `## Result`, or a bare `Yes.` — from marking
 *   every block that happens to contain "result" or "yes" through
 *   `b.includes(u)`: without it, the opening heading's ▶ would land on
 *   whichever paragraph echoes the word. Exact equality is exempt from
 *   the floor: a short heading is usually its own unit (`prepare` does not pack
 *   a leading heading into its neighbour), and a block that *is* the unit has
 *   no cross-unit ambiguity to guard against. Accepted residue: a heading of
 *   twelve or more characters echoed as its paragraph's opener
 *   (`## Installation steps` + "Installation steps are…") matches both
 *   blocks; the in-order walk still gives each block its own unit. Also accepted: a short heading in the middle of the body
 *   (`## Notes`, 5 chars) is packed by `prepare` into its paragraph's unit, so
 *   its own block is under the floor and stays unmarked while the paragraph
 *   beside it is.
 * - An empty unit (`source === ""`) claims nothing: equality is exempt from
 *   the floor, so without that guard it would hand an `<hr>` — an empty
 *   `textContent` block — to the empty unit.
 * - `WINDOW_CHARS` (24): a unit is not always a superstring of its block.
 *   `strip` replaces a code span longer than the spoken limit, a bare URL or
 *   an image *inside* a paragraph with an inline sentinel (`⟦expr⟧`,
 *   `⟦link⟧`, `⟦image⟧`), so `u.includes(b)` fails on the sentinel and
 *   `b.includes(u)` fails because the unit packs neighbouring paragraphs too
 *   (smoke test, 2026-09-16: the second paragraph of a three-paragraph answer
 *   went unmarked). The head and the tail of the block survive the sentinel
 *   unless the paragraph both opens and closes with one, so the rule compares
 *   the block's first and last 24 characters against the unit: long enough to
 *   be distinctive, short enough to sit on one side of the sentinel. The
 *   window subsumes the old opening-prefix comparison — a block packed whole
 *   into a unit starts inside it, and a block under 24 characters compares
 *   whole. `b.includes(u)` stays for the unit anytts `packUnits` carves out of a
 *   longer block. Accepted residue: a paragraph that opens AND closes with a
 *   sentinel is not found; two paragraphs that share their first or last 24
 *   characters both match the unit that speaks either of them. That is as far
 *   as the damage goes: the strength orders the candidates — the unit whose
 *   source equals the block, then one that holds it whole, then one the block
 *   holds, and only then a window-only match — so the look-alike paragraph
 *   still lands on its own unit.
 */

/**
 * Below this length neither a normalized block nor a normalized unit takes part
 * in the substring and window rules; only equality does. See the module comment.
 */
export const MIN_MATCH_CHARS = 12;

/** How much of a block's head and tail is looked for in the unit; see the module comment. */
export const WINDOW_CHARS = 24;

/**
 * Markdown markers and punctuation that the renderer drops or that the voice
 * ignores: `#`, `*`, `_`, backticks, `~`, `>`, `|`, brackets, parentheses, and
 * sentence punctuation. Each becomes a space so that word boundaries survive
 * (`**TLDR:**the` and `TLDR: the` normalize alike). The sentinel corner
 * brackets `⟦ ⟧` are deliberately NOT in this set: a `⟦code⟧` source must stay
 * a token no rendered block ever contains, rather than collapse into "code"
 * and match the first paragraph that mentions code.
 */
const NOISE_RE = /[#*_`~>|[\]()!\-–—.,;:"'’]/g;

/** Lower-cased, markers and punctuation blanked, whitespace collapsed. */
export function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(NOISE_RE, " ").replace(/\s+/g, " ").trim();
}

/**
 * How a rendered block relates to a unit, strongest first. Every kind counts
 * as a match; the order decides which unit wins a block when several match it
 * (see the module comment).
 */
const enum MatchKind {
  /** the block is the unit */
  Equal = 0,
  /** the unit packs the block whole */
  UnitHoldsBlock = 1,
  /** the unit was cut out of the block by the ceiling */
  BlockHoldsUnit = 2,
  /** only the block's head or tail window is found in the unit */
  Window = 3,
}

/**
 * How a rendered block was spoken as (part of) a unit, both already
 * normalized; `null` when it was not. Empty text never matches — an empty
 * window would otherwise be found in everything. A block that is the unit
 * matches outright; the looser rules below need both sides at or above the
 * floor.
 */
function matchKind(block: string, unit: string): MatchKind | null {
  if (unit.length === 0) return null;
  if (block === unit) return MatchKind.Equal; // a block that IS the unit needs no floor
  if (block.length < MIN_MATCH_CHARS || unit.length < MIN_MATCH_CHARS) return null;

  if (unit.includes(block)) return MatchKind.UnitHoldsBlock; // block packed into the unit
  if (block.includes(unit)) return MatchKind.BlockHoldsUnit; // unit cut out of a longer block
  if (
    unit.includes(block.slice(0, WINDOW_CHARS)) || // a sentinel ate the tail, head intact
    unit.includes(block.slice(-WINDOW_CHARS)) // …or a sentinel ate the head, tail intact
  ) {
    return MatchKind.Window;
  }
  return null;
}

/**
 * How strongly a normalized rendered block matches a normalized unit source:
 * 0 (the block is the unit) to 3 (only a head/tail window is found), lower is
 * stronger; `null` when it does not match. A caller pairs blocks with units its
 * own way — Play from here (`firstUnitsOfBlocks`) walks both in order and lets
 * the strongest match win.
 */
export function blockMatchStrength(block: string, unit: string): number | null {
  return matchKind(block, unit);
}
