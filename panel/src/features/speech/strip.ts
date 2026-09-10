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

function isTableLine(line: string): boolean {
  return line.trim().startsWith("|");
}

/**
 * Drops fenced code blocks and markdown tables, leaving a single blank line
 * where each block was. That blank line is the whole point: without it the
 * paragraph before and the paragraph after would merge into one, and the unit
 * builder would speak them as a single run-on unit.
 */
function removeBlocks(lines: readonly string[]): string[] {
  const kept: string[] = [];
  let i = 0;

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
        // which is what we want — no raw code leaks into the output.
        if (closing && closing[1][0] === marker && closing[2].trim() === "") break;
      }
      kept.push("");
      continue;
    }

    if (isTableLine(lines[i])) {
      while (i < lines.length && isTableLine(lines[i])) i += 1;
      kept.push("");
      continue;
    }

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
  return spoken.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
