/**
 * The deterministic speech-prep filter: response markdown in, speakable prose
 * out. Nothing here is language-aware — this stage only decides *what is worth
 * speaking at all*. Ordering, packing and the pronunciation map belong to the
 * unit builder that calls this.
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
 * sentinel behind — `⟦code⟧`, `⟦table⟧`, `⟦html⟧` for whole blocks, `⟦image⟧`
 * and `⟦link⟧` for the addresses inside a line, `⟦expr⟧` for a code span too
 * long for a listener to follow. They are deliberately not words: this stage
 * does not know the session's language, so it names the *kind* and leaves the
 * wording to `prepare.ts`, which does. The corner
 * brackets are the point — no answer contains them, so the substitution
 * downstream cannot collide with the response's own prose.
 *
 * An address is the one removal with a *named* exception: `[text](url)` keeps
 * its text and gets no sentinel, because the sentence around it already reads
 * as a whole sentence without the address. Only an address with nothing
 * readable attached — a bare URL, an image — is worth interrupting for.
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
 *
 * The final segment is optional (`*`, not `+`) and the separator repeats
 * (`\/+`), so a directory written the way people write directories —
 * `openspec/changes/speech-flow-and-diction/` — is *one* token, trailing
 * separators included. Leaving them outside the match is what stranded a bare
 * slash beside the elided segment, and what stopped `isWholePath` recognising
 * such a path inside a code span at all — where the span was then dropped for
 * length and the whole token spoken as nothing.
 *
 * The final segment may not *end* in a dot, which is what keeps the sentence's
 * own full stop out of the token — the commonest position a path appears in at
 * all. `…/speech-flow-and-diction/.` used to match through the stop, so the
 * last segment was `"."`, and `tidySpacing`'s "no space before punctuation"
 * rule then glued it back onto the preceding word: "The plan lives in. Next."
 * A filename's internal dots are untouched, because only the last character of
 * the token is constrained.
 */
const PATH_RE =
  /(?:[\w.@~+-]+\/+)+(?:[\w.@+-]*[\w@+-])?(?::\d+(?:[-:]\d+)?)?|[\w.@+-]+\.[A-Za-z]\w{0,4}:\d+(?:[-:]\d+)?/g;

/** A path token's own trailing line reference. */
const LINE_REFERENCE_RE = /:\d+(?:[-:]\d+)?$/;

/**
 * The separators *inside* a path segment. Applied nowhere else, and that scope
 * is the whole safety argument rather than an implementation detail: in prose a
 * hyphen joins one word (`czarno-biały`) and spacing it out would split it in
 * two, while inside a segment it is the only word boundary there is.
 */
const SEGMENT_SEPARATOR_RE = /[-_]+/g;

/**
 * A link's visible text: anything without brackets, plus **one** level of
 * nested `[...]` so `[see [this] note](url)` survives whole. One level is a
 * deliberate stopping point — deeper nesting cannot be matched by a regular
 * expression at all, and the failure mode is the safe one: the construct is
 * simply left as written and spoken with its brackets.
 */
const LINK_TEXT = String.raw`(?:[^\[\]]|\[[^\[\]]*\])*`;

/**
 * A link's destination: the URL and any title after it, with one level of
 * nested parens for the `(a(b))`-shaped URLs that do occur in the wild.
 */
const LINK_DESTINATION = String.raw`(?:[^()]|\([^()]*\))*`;

/** Either half of a link's tail: `(url)` inline, or `[ref]` reference-style. */
const LINK_TAIL = String.raw`(?:\(${LINK_DESTINATION}\)|\[[^\[\]]*\])`;

/**
 * `![alt](url)` and `![alt][ref]`. Matched before links so the `!` cannot be
 * left stranded in front of the alt text by the link rule.
 */
const IMAGE_RE = new RegExp(String.raw`!\[${LINK_TEXT}\]${LINK_TAIL}`, "g");

/** `[text](url)` and `[text][ref]` — capture group 1 is the spoken text. */
const LINK_RE = new RegExp(String.raw`\[(${LINK_TEXT})\]${LINK_TAIL}`, "g");

/**
 * A reference definition's destination: angle-bracketed, or a run without
 * whitespace that carries a path separator, a scheme colon, a fragment or a
 * dotted domain. Those marks are what separate an address from an ordinary
 * word, and the whole safety of the rule below rests on them.
 */
const REFERENCE_DESTINATION = String.raw`<[^<>]*>|(?=\S*[/:#]|\S*\.[A-Za-z])\S+`;

/** A definition's optional title, quoted or parenthesised, as CommonMark has it. */
const REFERENCE_TITLE = String.raw`"[^"]*"|'[^']*'|\([^()]*\)`;

/**
 * A whole line that is a reference definition: `[ref]: url "title"`. It is pure
 * link plumbing with no prose in it, so it is dropped rather than named — a
 * sentinel here would announce an omission the listener never had.
 *
 * That makes it the one removal in this module that leaves no trace, so it has
 * to be *certain*, and matching on the bracket shape alone was not: `[label]:
 * text` is equally how a log line, a footnote and a bracketed aside are
 * written, and agent answers are full of all three. `[WARN]: connection
 * refused` and `[1]: Kowalski, 2026, page 14` vanished silently. Requiring an
 * address-shaped destination — and nothing after it but a title — is what
 * distinguishes plumbing from prose, since prose after a label runs on into
 * words a destination may not contain.
 */
const REFERENCE_DEFINITION_RE = new RegExp(
  String.raw`^ {0,3}\[[^\]]+\]:\s*(?:${REFERENCE_DESTINATION})(?:\s+(?:${REFERENCE_TITLE}))?\s*$`,
);

/**
 * A bare `http(s)://…`, optionally wrapped in an autolink's angle brackets. The
 * final character class is what keeps the sentence's own punctuation out of the
 * match, so "…at https://pavil.io/x." keeps its full stop after the sentinel.
 * `www.`-style addresses are deliberately not matched: without a scheme the
 * pattern starts eating ordinary prose. Unmatched does not mean untouched,
 * though — `www.pavil.io/getting-started` has slashes in it, so `PATH_RE`
 * claims it and speaks its last segment, "getting started". That is a lossy
 * answer rather than a wrong one, and cheaper than a scheme-less address
 * pattern that would have to tell `pavil.io/x` apart from `e.g./x`.
 * The backtick is excluded from the body for the same reason as the closing
 * angle bracket: no URL contains one, and swallowing a span's closing backtick
 * would leave the opening one behind for the voice to trip over.
 */
const BARE_ADDRESS_RE = /<?https?:\/\/[^\s<>`]*[^\s<>`.,;:!?'")\]]>?/gi;

/** Bullet or ordered list marker at the start of a line. */
const LIST_MARKER_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;

/** Punctuation a text-to-speech voice already reads as an end of sentence. */
const SENTENCE_TERMINATOR_RE = /[.!?:;…]$/;

/**
 * Text that is nothing but sentinels and whitespace — an answer with no answer
 * in it. Exported because `prepare.ts` needs the same question answered of a
 * single paragraph: a paragraph that is only a sentinel has no sentence in it
 * to use as a fast start, so it has to be recognised rather than guessed at.
 * It matches the empty string too, which is harmless at both call sites.
 */
export const SENTINEL_ONLY_RE = /^(?:\s*⟦[a-z]+⟧)*\s*$/;

/**
 * The removals this stage can make. One sentinel per kind, not per block: the
 * listener needs to know that *something of this kind* was skipped, and hearing
 * "code block" three times in a row tells them nothing the first one did not.
 */
type RemovedKind = "code" | "table" | "html" | "image" | "link" | "expr";

/**
 * The half of the vocabulary `removeBlocks` may emit. Splitting it out is not
 * decoration: the "adjacent removals collapse" rule is a property of *blocks*
 * standing on their own lines, and two links in one sentence are two links.
 * Typing the block pass narrowly is what stops that rule leaking inline.
 */
type RemovedBlockKind = Extract<RemovedKind, "code" | "table" | "html">;

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
  image: "⟦image⟧",
  link: "⟦link⟧",
  expr: "⟦expr⟧",
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
 * The block tags that can never carry a closing tag. A strict subset of
 * {@link HTML_BLOCK_TAGS}, and it must stay one — a name reaches
 * {@link htmlBlockEnd} only after passing the whitelist above.
 *
 * Without this set the search for `</br>` finds nothing, every void tag fell
 * through to the fallback, and a lone `<br>` between two paragraphs deleted
 * everything after it.
 */
const HTML_VOID_TAGS = new Set(["br", "col", "hr", "img", "source"]);

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
 * - a closing tag, a void tag (`<br>`, `<hr>`, `<img>`, …) and a self-closing
 *   tag are each a block of exactly one line. None of the three can ever be
 *   paired with a `</tag>` further down — a closing tag opens nothing, a void
 *   element holds nothing, a self-closed one is already finished — so pairing
 *   them with one would delete every line standing in between;
 * - otherwise the block runs through the first line carrying the matching
 *   `</tag>`, however many blank lines sit inside it — a `<details>` with prose
 *   folded into it is one removal, not three;
 * - and when that closing tag never comes, the block is its **opening line and
 *   nothing else**. Unlike an unclosed fence, where swallowing the rest of the
 *   response is exactly right, an unbalanced tag is far likelier to be a stray
 *   than a truncation. The fallback used to run to the next blank line, and
 *   with none ahead to the end of the response, so a single stray `<p>` — or
 *   any void tag, which can never find its closing tag — silently deleted
 *   every word after it. Leaving one line of markup to be spoken is the cheap
 *   failure; deleting the answer is not, and no fallback may cost more than
 *   the line that triggered it.
 *
 * Nesting of the same tag is not counted. It costs a loop and buys almost
 * nothing: nested markup arrives inside a fence, and that is already gone.
 */
function htmlBlockEnd(lines: readonly string[], from: number): number | null {
  const opening = HTML_TAG_LINE_RE.exec(lines[from]);
  if (!opening) return null;

  const tag = opening[2].toLowerCase();
  if (!HTML_BLOCK_TAGS.has(tag)) return null;

  const line = lines[from];
  if (opening[1] === "/" || HTML_VOID_TAGS.has(tag) || line.trimEnd().endsWith("/>")) {
    return from + 1;
  }

  const closing = `</${tag}`;
  if (line.slice(opening[0].length).toLowerCase().includes(closing)) return from + 1;

  for (let i = from + 1; i < lines.length; i += 1) {
    if (lines[i].toLowerCase().includes(closing)) return i + 1;
  }

  // No closing tag anywhere ahead: the opening line is the whole block.
  return from + 1;
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
  let pendingKind: RemovedBlockKind | null = null;
  let i = 0;

  const name = (kind: RemovedBlockKind): void => {
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
 * Elides a path to its last meaningful segment and drops the line reference.
 * That segment is the only part a listener can act on — "TerminalLayoutGrid.tsx"
 * locates the file, while the directories and "colon four five three dash four
 * seven eight" are pure noise at listening speed.
 *
 * The last segment with anything *left to say*, not "everything after the last
 * slash" and not "the last non-empty segment" either. A directory path is
 * routinely written with a trailing separator, so the text after the last slash
 * is the empty string — `openspec/changes/speech-flow-and-diction/` was spoken
 * as nothing at all, mid-sentence, with no sign anything had gone missing. But
 * skipping empty segments is not enough on its own: a segment of separators
 * alone (`…/speech/__`) is non-empty, and `_` is a word character, so both
 * "non-empty" and "contains a word character" still hand back a segment that
 * *becomes* the empty string once the separators turn into spaces. The test has
 * to be applied to the spoken form, which is why the loop reduces first and
 * asks afterwards. The invariant it buys: this function never returns "".
 *
 * The segment's own `-`/`_` become spaces here and only here, because here is
 * the one place we know we are inside a path rather than inside prose.
 */
function elidePath(token: string): string {
  const withoutReference = token.replace(LINE_REFERENCE_RE, "");
  const segments = withoutReference.split("/");

  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const spoken = segments[i].replace(SEGMENT_SEPARATOR_RE, " ").trim();
    if (spoken !== "") return spoken;
  }

  // Nothing in the whole token survives being spoken — separators end to end.
  // Speaking it as written is this module's standard safe failure, and it is
  // the one answer that cannot be silence.
  return withoutReference;
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
 * Applies `reduce` to the parts of a line that are **not** inside an inline code
 * span, passing every span through byte for byte.
 *
 * Only the link rule needs this, and the asymmetry is the point: an address is
 * an address whether or not someone wrapped it in backticks, but a `[…](…)`
 * shape inside backticks is a *quotation of source code*, and the one thing a
 * quotation may not do is come out as something else.
 */
function outsideCodeSpans(line: string, reduce: (text: string) => string): string {
  let out = "";
  let cursor = 0;

  for (const span of line.matchAll(INLINE_CODE_RE)) {
    const at = span.index ?? 0;
    out += reduce(line.slice(cursor, at)) + span[0];
    cursor = at + span[0].length;
  }

  return out + reduce(line.slice(cursor));
}

/**
 * Replaces links with their text — but only where the construct really is a
 * link, which the shape alone does not settle.
 *
 * A link never abuts a word character on its left. Indexing does, and that one
 * character is the whole difference between `see [the plan](url)` and
 * `arr[0](x)`, `x[i][j]`, `note[1](x)` — expressions that markdown will happily
 * read as links and that the rule then rewrote into `arr0`, `xi`, `note1`.
 * Swapping a token for a different, plausible-sounding token is worse than
 * reading the original aloud: the listener cannot tell it happened.
 *
 * With the text empty there is nothing readable attached, so the named
 * exception that lets a link go unannounced has not been paid for — `[](url)`
 * is a bare address by another spelling and is named like one.
 */
function reduceLinks(segment: string): string {
  return segment.replace(LINK_RE, (match: string, text: string, offset: number) => {
    if (offset > 0 && /\w/.test(segment[offset - 1])) return match;
    return text.trim() === "" ? SENTINEL.link : text;
  });
}

/**
 * Takes the addresses out of a line: images and bare URLs become sentinels,
 * links keep their text and lose their destination, and a reference definition
 * line disappears entirely.
 *
 * Runs **before** `reduceInlineCode` on purpose. An address is an address
 * whether or not someone wrapped it in backticks, and inline code is judged by
 * length: a 40-character URL in a span would otherwise be named an
 * *expression*, which tells the listener the wrong thing about what they
 * missed. Reducing first turns the
 * span into `` `⟦link⟧` ``, which is then short enough to unwrap normally.
 *
 * The link rule is the exception and skips spans entirely, because that
 * argument does not carry it: a bracket-and-paren shape in quoted code is code,
 * not an address, and nothing is gained by naming it. Skipping spans is
 * preferred to running the rule *after* `reduceInlineCode`, which would fix
 * only the long spans — a short one is unwrapped verbatim and would be caught
 * by the rule anyway — and would force the bare-address rule ahead of the link
 * rule, breaking the ordering the next paragraph turns on.
 *
 * It runs **after** `removeBlocks`, which is why nothing here has to look
 * inside a fence, a table or an HTML block: those are already sentinels, and
 * the addresses that were in them went with the block they belonged to. That
 * ordering is also load-bearing in the other direction — a destination swallows
 * anything without parens in it, a closing `</details>` included, so running
 * these rules first could delete a block's boundary and spill its contents.
 *
 * The order within the line is load-bearing twice over. Images before links, or
 * the link rule strands the `!`. Bare addresses last, so a link whose text is
 * itself an address — `[https://x](https://x)` — has already been reduced to
 * its text by then and is named a link rather than read out as one.
 */
function reduceAddresses(line: string): string {
  if (REFERENCE_DEFINITION_RE.test(line)) return "";

  const withoutImages = line.replace(IMAGE_RE, SENTINEL.image);

  return outsideCodeSpans(withoutImages, reduceLinks).replace(BARE_ADDRESS_RE, SENTINEL.link);
}

/**
 * Unwraps short inline code, elides a path to its segment, and *names* anything
 * else too long to follow by ear.
 *
 * Naming rather than dropping is the fix for the second silent disappearance: a
 * span over the cap used to be replaced with nothing, so "call `<44 characters
 * of expression>` first" was spoken as "call first" — a sentence the answer
 * never wrote. `⟦expr⟧` costs a syllable and keeps the sentence true.
 *
 * A path is never named this way, however long the span: `elideLongPaths` has
 * already reduced it to something speakable, and "expression" would be the
 * wrong word for it anyway.
 */
function reduceInlineCode(line: string): string {
  return line.replace(INLINE_CODE_RE, (_match, code: string) => {
    if (isWholePath(code)) return elideLongPaths(code);
    return code.length > MAX_SPOKEN_CODE_CHARS ? SENTINEL.expr : code;
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
 *
 * An item that is nothing but sentinels gets no terminator, because the period
 * would be the only thing distinguishing it from a bare sentinel — and that is
 * exactly what {@link SENTINEL_ONLY_RE} looks for downstream. `- ![a](url)`
 * became `⟦image⟧.`, which no longer reads as sentinel-only, so a response that
 * was one bulleted image woke the cell up to say "obrazek".
 */
function listItemToSentence(line: string): string {
  const item = LIST_MARKER_RE.exec(line);
  if (!item) return line;

  const content = item[2].trim();
  if (content === "" || SENTINEL_ONLY_RE.test(content)) return content;

  return SENTENCE_TERMINATOR_RE.test(content) ? content : `${content}.`;
}

export function stripToSpeakableText(markdown: string): string {
  const lines = removeBlocks(markdown.replace(/\r\n?/g, "\n").split("\n"));

  const spoken = lines.map((line) =>
    listItemToSentence(tidySpacing(elideLongPaths(reduceInlineCode(reduceAddresses(line))))),
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
