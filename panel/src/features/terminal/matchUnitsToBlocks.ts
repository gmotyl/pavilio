/**
 * Finds, for each speech unit, the rendered markdown block(s) it was spoken
 * from — by text, not by offsets.
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
 * Two constants shape the rules (see {@link matchUnitsToBlocks}):
 *
 * - `MIN_MATCH_CHARS` (12): a floor on *both* sides of every substring and
 *   prefix rule. On the block it keeps a one-word list item — "Tests" — from
 *   matching every unit that contains the word through `u.includes(b)`. On the
 *   unit it keeps a short unit — `## Result`, or a bare `Yes.` — from marking
 *   every block that happens to contain "result" or "yes" through
 *   `b.includes(u)`: without it, speaking the opening heading would scroll the
 *   pane to whichever paragraph echoes the word. Exact equality is exempt from
 *   the floor: a short heading is usually its own unit (`prepare` does not pack
 *   a leading heading into its neighbour), and a block that *is* the unit has
 *   no cross-unit ambiguity to guard against. Accepted residue: a heading of
 *   twelve or more characters echoed as its paragraph's opener
 *   (`## Installation steps` + "Installation steps are…") marks both blocks
 *   while the heading is spoken — adjacent, overlapping segments, not a wrong
 *   scroll.
 * - `PREFIX_CHARS` (40): `cutAtCeiling` turns one 900-character paragraph into
 *   two units. The second is a substring of the block and `b.includes(u)`
 *   finds it; the first is too, but the general case — the block having been
 *   *packed* into a unit alongside other paragraphs — is covered by comparing
 *   the opening 40 characters in either direction, which is long enough to be
 *   distinctive and short enough to survive a unit and a block that diverge
 *   only in their tails.
 */

export interface UnitBlockMap {
  /** unit index → block indexes it was packed from, ascending; [] when none */
  unitToBlocks: readonly (readonly number[])[];
  /** block index → first unit that matches it; null for unspoken blocks */
  blockToUnit: readonly (number | null)[];
}

/**
 * Below this length neither a normalized block nor a normalized unit takes part
 * in the substring and prefix rules; only equality does. See the module comment.
 */
export const MIN_MATCH_CHARS = 12;

/** How much of an opening is compared by the prefix rules; see the module comment. */
export const PREFIX_CHARS = 40;

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
 * Whether a rendered block was spoken as (part of) a unit, both already
 * normalized. Empty text never matches — an empty `startsWith` prefix would
 * otherwise match everything. A block that is the unit matches outright; the
 * looser rules below need both sides at or above the floor.
 */
function blockMatchesUnit(block: string, unit: string): boolean {
  if (unit.length === 0) return false;
  if (block === unit) return true; // a block that IS the unit needs no floor
  if (block.length < MIN_MATCH_CHARS || unit.length < MIN_MATCH_CHARS) return false;

  return (
    unit.includes(block) || // block packed whole into the unit
    block.includes(unit) || // unit cut out of a longer block
    block.startsWith(unit.slice(0, PREFIX_CHARS)) || // first of several units from one block
    unit.startsWith(block.slice(0, PREFIX_CHARS)) // unit that begins with this block
  );
}

export function matchUnitsToBlocks(
  units: readonly { source: string }[],
  blocks: readonly string[],
): UnitBlockMap {
  const normalizedBlocks = blocks.map(normalizeForMatch);
  const blockToUnit: (number | null)[] = blocks.map(() => null);

  const unitToBlocks = units.map((unit, unitIndex) => {
    const normalizedUnit = normalizeForMatch(unit.source);
    const owned: number[] = [];

    normalizedBlocks.forEach((block, blockIndex) => {
      if (!blockMatchesUnit(block, normalizedUnit)) return;
      owned.push(blockIndex);
      if (blockToUnit[blockIndex] === null) blockToUnit[blockIndex] = unitIndex;
    });

    return owned;
  });

  return { unitToBlocks, blockToUnit };
}
