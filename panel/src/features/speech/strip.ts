/**
 * The deterministic speech-prep filter: response markdown in, speakable prose
 * out. Nothing here is language-aware and nothing here is a budget — this stage
 * only decides *what is worth speaking at all*. Ordering, packing, the
 * pronunciation map and the budget cut belong to the unit builder that calls
 * this.
 *
 * An agent answer is not prose. Read literally, a fenced diff is a minute of
 * noise and a path with a line range is spoken character by character, so both
 * are removed or reduced before anything downstream sees the text.
 *
 * Two markers are deliberately NOT stripped: heading `#` and emphasis `**`.
 * The unit builder needs them to find the response's first heading and a
 * leading `**TLDR:**` paragraph; it removes them when it emits a unit.
 *
 * What is removed is *named*. A silent removal is indistinguishable from an
 * answer that never mentioned the thing, so every removal leaves a neutral
 * sentinel behind — `⟦code⟧`, `⟦table⟧`, `⟦html⟧`. They are deliberately not
 * words: this stage does not know the session's language, so it names the
 * *kind* and leaves the wording to `prepare.ts`, which does. The corner
 * brackets are the point — no answer contains them, so the substitution
 * downstream cannot collide with the response's own prose.
 */

/**
 * Longest code-ish run kept verbatim in spoken text. It governs both inline
 * code spans and bare path tokens, because the question is the same for both:
 * can a listener still follow this, or does it become spelled-out noise?
 * `prepare` or `src/strip.ts` is fine; a 60-character path is not.
 */
export const MAX_SPOKEN_CODE_CHARS = 24;

/** A fence line: ``` or ~~~ (up to three leading spaces), plus an info string. */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*(.*)$/;

/** Inline code span, single line only — a multi-line span is a fenced block's job. */
const INLINE_CODE_RE = /`+([^`\n]+)`+/g;

/**
 * A path-ish token: either slash-separated segments, or a bare filename with a
 * line range (`useTerminalOrdering.ts:66-75`). A trailing `:12-34` / `:12:5`
 * line reference is part of the token so it can be dropped with it.
 */
const PATH_RE =
  /(?:[\w.@~+-]+\/)+[\w.@+-]+(?::\d+(?:[-:]\d+)?)?|[\w.@+-]+\.[A-Za-z]\w{0,4}:\d+(?:[-:]\d+)?/g;

/** A path token's own trailing line reference. */
const LINE_REFERENCE_RE = /:\d+(?:[-:]\d+)?$/;

/** Bullet or ordered list marker at the start of a line. */
const LIST_MARKER_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;

/** Punctuation a text-to-speech voice already reads as an end of sentence. */
const SENTENCE_TERMINATOR_RE = /[.!?:;…]$/;

/** Text that is nothing but sentinels and whitespace — an answer with no answer in it. */
const SENTINEL_ONLY_RE = /^(?:\s*⟦[a-z]+⟧)*\s*$/;

/**
 * The removals this stage can make. One sentinel per kind, not per block: the
 * listener needs to know that *something of this kind* was skipped, and hearing
 * "code block" three times in a row tells them nothing the first one did not.
 */
type RemovedKind = "code" | "table" | "html";

/**
 * The neutral names a removal leaves behind. Language-unaware by construction —
 * `prepare.ts` owns the spoken wording — and the single place a sentinel is
 * spelled, so a later removal adds a kind here rather than a literal at its
 * call site.
 */
export const SENTINEL: Record<RemovedKind, string> = {
  code: "⟦code⟧",
  table: "⟦table⟧",
  html: "⟦html⟧",
};

function isTableLine(line: string): boolean {
  return line.trim().startsWith("|");
}

/**
 * Tag names that mean "a block starts here" when they open a line. A whitelist
 * rather than "any tag", because the rule is anchored to the start of a line
 * and inline markup does occasionally start one — `<em>this</em> matters.` is a
 * sentence, not a block, and removing it would eat the prose after the tag.
 * The list is the block-level half of CommonMark's HTML-block tag set; a tag
 * missing from it is simply spoken as written, which is the safe failure.
 */
const HTML_BLOCK_TAGS = new Set([
  "address", "article", "aside", "audio", "blockquote", "br", "caption",
  "center", "col", "colgroup", "dd", "details", "dialog", "div", "dl", "dt",
  "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6",
  "header", "hr", "iframe", "img", "li", "main", "nav", "ol", "p", "picture",
  "pre", "script", "section", "source", "style", "summary", "table", "tbody",
  "td", "tfoot", "th", "thead", "tr", "ul", "video",
]);

/**
 * A line that opens (or closes) an HTML block: up to three leading spaces, then
 * a tag whose name is followed by whitespace, `/` or `>`. That lookahead is
 * what keeps `<- see above` and `<3` out of it.
 */
const HTML_TAG_LINE_RE = /^ {0,3}<(\/?)([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])/;

/**
 * The index just past an HTML block starting at `from`, or `null` when no block
 * starts there. Three cases, in the spirit of `isTableLine` rather than of a
 * parser:
 *
 * - a closing or self-closing tag is a block of exactly one line;
 * - otherwise the block runs through the first line carrying the matching
 *   `</tag>`, however many blank lines sit inside it — a `<details>` with prose
 *   folded into it is one removal, not three;
 * - and when that closing tag never comes, the block stops at the next blank
 *   line. Unlike an unclosed fence, where swallowing the rest of the response
 *   is exactly right, an unbalanced tag is far likelier to be a stray than a
 *   truncation, so its damage is bounded to its own paragraph.
 *
 * Nesting of the same tag is not counted. It costs a loop and buys almost
 * nothing: nested markup arrives inside a fence, and that is already gone.
 */
function htmlBlockEnd(lines: readonly string[], from: number): number | null {
  const opening = HTML_TAG_LINE_RE.exec(lines[from]);
  if (!opening || !HTML_BLOCK_TAGS.has(opening[2].toLowerCase())) return null;

  const line = lines[from];
  if (opening[1] === "/" || line.trimEnd().endsWith("/>")) return from + 1;

  const closing = `</${opening[2].toLowerCase()}`;
  if (line.slice(opening[0].length).toLowerCase().includes(closing)) return from + 1;

  for (let i = from + 1; i < lines.length; i += 1) {
    if (lines[i].toLowerCase().includes(closing)) return i + 1;
  }

  // No closing tag anywhere ahead. The blank line is checked only now, not
  // during the search above: a `<details>` normally has blank lines inside it,
  // and stopping at the first one would end the block before its `</details>`
  // and read the folded prose aloud.
  for (let i = from + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "") return i;
  }
  return lines.length;
}

/**
 * Drops fenced code blocks, markdown tables and HTML blocks, leaving a named
 * sentinel on a line of its own where each one stood, with a blank line either
 * side. Those blank lines are the whole point: without them the paragraph
 * before and the paragraph after would merge into one, and the unit builder
 * would speak them as a single run-on unit. The sentinel sits *between* the two
 * rather than inside either, so it becomes its own short unit and the voice
 * pauses around it instead of running it into a sentence.
 *
 * Adjacent removals of the same kind collapse. `pendingKind` remembers the last
 * sentinel emitted and forgets it the moment a line with anything spoken on it
 * is kept — a blank line does not forget it, because a blank line between two
 * fences is not something a listener hears.
 */
function removeBlocks(lines: readonly string[]): string[] {
  const kept: string[] = [];
  let pendingKind: RemovedKind | null = null;
  let i = 0;

  const name = (kind: RemovedKind): void => {
    if (kind === pendingKind) return;
    kept.push("", SENTINEL[kind], "");
    pendingKind = kind;
  };

  while (i < lines.length) {
    const opening = FENCE_RE.exec(lines[i]);

    if (opening) {
      const marker = opening[1][0];
      i += 1;
      while (i < lines.length) {
        const closing = FENCE_RE.exec(lines[i]);
        i += 1;
        // A closing fence is the same character with no info string. An
        // unclosed fence (a truncated response) simply runs to the end here,
        // which is what we want — no raw code leaks into the output, and the
        // whole run is one removal, so it is still one sentinel.
        if (closing && closing[1][0] === marker && closing[2].trim() === "") break;
      }
      name("code");
      continue;
    }

    if (isTableLine(lines[i])) {
      while (i < lines.length && isTableLine(lines[i])) i += 1;
      name("table");
      continue;
    }

    const htmlEnd = htmlBlockEnd(lines, i);
    if (htmlEnd !== null) {
      i = htmlEnd;
      name("html");
      continue;
    }

    if (lines[i].trim() !== "") pendingKind = null;
    kept.push(lines[i]);
    i += 1;
  }

  return kept;
}

/**
 * Elides a path to its basename and drops the line reference. The basename is
 * the only part a listener can act on — "TerminalLayoutGrid.tsx" locates the
 * file, while the directories and "colon four five three dash four seven
 * eight" are pure noise at listening speed.
 */
function elidePath(token: string): string {
  const withoutRange = token.replace(LINE_REFERENCE_RE, "");
  return withoutRange.slice(withoutRange.lastIndexOf("/") + 1);
}

function isWholePath(value: string): boolean {
  const matches = value.match(PATH_RE);
  return matches !== null && matches.length === 1 && matches[0] === value;
}

/** Shortens the path tokens that are too long to follow; leaves short ones alone. */
function elideLongPaths(text: string): string {
  return text.replace(PATH_RE, (token) =>
    token.length > MAX_SPOKEN_CODE_CHARS ? elidePath(token) : token,
  );
}

/**
 * Unwraps short inline code, elides long paths, and drops anything else that is
 * too long — a dropped span is better than a voice spelling out an expression.
 */
function reduceInlineCode(line: string): string {
  return line.replace(INLINE_CODE_RE, (_match, code: string) => {
    const spoken = isWholePath(code) ? elideLongPaths(code) : code;
    return spoken.length > MAX_SPOKEN_CODE_CHARS ? "" : spoken;
  });
}

/** Repairs the gaps a dropped code span leaves behind. */
function tidySpacing(line: string): string {
  return line
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ([,.;:!?])/g, "$1")
    .trimEnd();
}

/**
 * Turns a list item into a sentence: the marker is dropped (a voice reads it as
 * a stray "dash") and a terminator is appended when the item has none, so items
 * are spoken as separate sentences instead of one breathless clause.
 */
function listItemToSentence(line: string): string {
  const item = LIST_MARKER_RE.exec(line);
  if (!item) return line;

  const content = item[2].trim();
  if (content === "") return "";

  return SENTENCE_TERMINATOR_RE.test(content) ? content : `${content}.`;
}

export function stripToSpeakableText(markdown: string): string {
  const lines = removeBlocks(markdown.replace(/\r\n?/g, "\n").split("\n"));

  const spoken = lines.map((line) =>
    listItemToSentence(tidySpacing(elideLongPaths(reduceInlineCode(line)))),
  );

  // Collapse the blank lines the removed blocks left behind to a single
  // paragraph boundary, then trim — a response that was only code must be
  // exactly "", not whitespace.
  const text = spoken.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  // A sentinel names an omission *within* an answer; with no answer around it
  // there is nothing for it to stand beside, and waking a cell up only to say
  // "code block" is worse than staying quiet. So a response that reduces to
  // sentinels alone still has nothing to say.
  return SENTINEL_ONLY_RE.test(text) ? "" : text;
}
