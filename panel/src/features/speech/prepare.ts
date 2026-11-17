/**
 * Response markdown in, speech units out. Pure and synchronous: everything
 * table-driven about this feature lives here.
 *
 * The stage order matters and is easy to get wrong:
 *
 * 1. `stripToSpeakableText` first, so everything after it sees only what will
 *    actually be spoken.
 * 2. Then units: every block is spoken on its own, a heading whole and
 *    everything else one sentence per unit (see {@link prepareBlocks}). Pages
 *    and answers take this same one path.
 *
 * `strip.ts` deliberately leaves heading `#` and emphasis `**` markers in place
 * so this module can find the heading and the TLDR. Removing them is therefore
 * this module's job and nothing else's — see {@link removeMarkers}. A unit's
 * text is the exact string handed to synthesis, so a marker that survives to
 * here is a marker the voice reads out loud.
 *
 * Language is **received, not detected**. It is a property of the session (see
 * `voteLanguage` / `nextLanguageState` in `language.ts`), accumulated
 * across utterances, and defaults to English — the branch that changes nothing.
 *
 * It is also this module that turns `strip.ts`'s neutral sentinels into words,
 * which must happen **before** anytts' Pronunciation map sees the text — see
 * {@link speakSentinels}, where the collision that forces that order is spelled
 * out. The map itself is no longer applied here: anytts respells at synthesis,
 * per engine, from the request's `lang` (the `speech.pronunciationByEngine`
 * switches), so a unit's `text` is the text as written.
 */
import { firstSentence, packUnits } from "anytts/text";
import { SENTINEL, stripToSpeakableText } from "./strip";
import type { PreparedSpeech, SpeechUnit } from "./types";

/** Ceiling a single over-long sentence is cut at, on word boundaries. */
export const UNIT_MAX_CHARS = 450;

export interface PrepareOptions {
  /**
   * The session's language, as accumulated by `nextLanguageState`. Defaults to
   * `"en"`. It words the placeholders here and is what synthesis receives as
   * `lang`, where it picks the Pronunciation map.
   */
  language?: "pl" | "en";
}

/**
 * One unit in both its readings: `source`, the block it came from as
 * `strip.ts` left it — markers, sentinels and all — and `text` as the voice
 * will receive it. Every sizing decision is made on `text`, because `text` is
 * what synthesis gets; `source` only follows along.
 */
interface Packed {
  source: string;
  text: string;
  /** The index of the block this unit was spoken from. */
  block: number;
}

/** An ATX heading line: `#` … `######`, up to three leading spaces. */
const HEADING_LINE_RE = /^ {0,3}#{1,6}[ \t]+(.*)$/;

export interface RemoveMarkersOptions {
  /**
   * Never drop a lone `*`. Only two things lose their asterisks: an emphasis
   * pair whose delimiters hug the text and do not sit inside a word (`*em*`,
   * `**bold**`, not `* 3 = 6, a *` or `2*3 and 4*5`), and a list bullet at the
   * start of a line. Every other `*` is left exactly where it is — guessing
   * which ones are operators (`(a + b) * c`, `5*-3`, …) was a rule that kept
   * missing cases, and a stray `*` in a read preview costs nothing. Off for
   * speech, where a spoken "asterisk" is noise either way; on for the
   * notification preview, which is read.
   */
  keepLiteralAsterisks?: boolean;
}

/*
 * The preview's emphasis: delimiters hug the text, as markdown's flanking rule
 * asks, AND never sit inside a word. CommonMark does allow intraword `*`
 * emphasis, but in an agent's answer `2*3 and 4*5` or `a*b*c` is arithmetic far
 * more often than it is `2<em>3 and 4</em>5`, and a preview that reads literally
 * is the safer mistake.
 */
/** `**bold**`, flanked and not intraword. */
const FLANKED_BOLD_RE = /(?<![\p{L}\p{N}_])\*\*(?=[^\s*])([^*]*?[^\s*])\*\*(?![\p{L}\p{N}_])/gu;
/** `*em*`, flanked and not intraword. */
const FLANKED_EM_RE = /(?<![\p{L}\p{N}_*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\p{L}\p{N}_*])/gu;
/**
 * A list bullet: `* ` or `- ` opening a line, possibly indented. The indent is
 * kept (group 1); the marker and the gap after it go.
 */
const BULLET_RE = /^([ \t]*)[*-][ \t]+/gm;

/**
 * Removes every markdown marker that is still standing. Ordering is what makes
 * it safe: the paired forms are unwrapped before the sweep for stray markers, so
 * `**bold**` becomes `bold` rather than losing its content. In keep mode that
 * final sweep removes list bullets only.
 *
 * Underscores count as emphasis only when the run is bounded by non-word
 * characters — `PAVILIO_TERMINAL_ID` must survive intact, because `strip.ts` has
 * already decided that short identifiers are worth speaking.
 *
 * Exported so the notification preview strips markers by the same rules instead
 * of keeping a copy that drifts; the preview passes
 * {@link RemoveMarkersOptions.keepLiteralAsterisks}.
 */
export function removeMarkers(text: string, options: RemoveMarkersOptions = {}): string {
  const keep = options.keepLiteralAsterisks === true;
  return text
    .split("\n")
    .map((line) => line.replace(HEADING_LINE_RE, "$1"))
    .join("\n")
    .replace(keep ? FLANKED_BOLD_RE : /\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(keep ? FLANKED_EM_RE : /\*([^*\n]+)\*/g, "$1")
    .replace(/(?<![\p{L}\p{N}_])_([^_\n]+)_(?![\p{L}\p{N}_])/gu, "$1")
    .replace(keep ? BULLET_RE : /\*/g, keep ? "$1" : "");
}

/** The removal kinds `strip.ts` names, borrowed rather than re-declared. */
type Sentinel = keyof typeof SENTINEL;

/**
 * What each of `strip.ts`'s neutral sentinels is said as, per language. The
 * phrases are stored bare; {@link speakSentinels} adds the pauses, so the one
 * fiddly part of this — punctuation — lives in one place instead of being baked
 * into twelve string literals.
 */
const SPOKEN_SENTINEL: Readonly<Record<"pl" | "en", Readonly<Record<Sentinel, string>>>> = {
  pl: {
    code: "blok kodu",
    table: "tabela",
    html: "blok HTML",
    image: "obrazek",
    link: "link",
    expr: "wyrażenie",
  },
  en: {
    code: "code block",
    table: "table",
    html: "HTML block",
    image: "image",
    link: "link",
    expr: "expression",
  },
};

/** Built from {@link SENTINEL} so a new removal kind cannot be spelled twice. */
const SENTINEL_RE = new RegExp(`⟦(${Object.keys(SENTINEL).join("|")})⟧`, "g");

/**
 * Tidies the punctuation a substitution just created. Only ever runs on text a
 * sentinel actually stood in — see {@link speakSentinels} — so it cannot drift
 * into rewriting ordinary prose.
 *
 * Every rule here is a way a `, phrase,` can land badly *within one paragraph*.
 * What none of them may do is *remove the pauses*: the commas are the whole
 * reason the voice sets the placeholder apart from the sentence instead of
 * reading "obrazek" as the next word of it. The leading comma of a paragraph
 * that opens with a placeholder is deliberately NOT tidied here — that is an
 * utterance edge, and {@link toUnits} is where it is dropped.
 *
 * Single quotes are absent from the bracket classes on purpose: `'` and `’` are
 * Polish inflection apostrophes (`pipeline'y`), not aside markers, and the
 * ASCII `"` is absent because it is both an opener and a closer — it would eat
 * the legitimate comma in `⟦link⟧, "cytat"`.
 */
function tidyAroundPlaceholder(text: string): string {
  return (
    text
      // "Kod poniżej: , blok kodu," — the author's mark already pauses; ours
      // would be read as a second beat. Theirs wins, because it carries
      // meaning. An em or en dash pauses exactly the same way.
      .replace(/([,.;:!?…—–]) *, */g, "$1 ")
      // The mirror case, where our trailing comma leans on the sentence's own
      // terminator. This is also what collapses two adjacent placeholders'
      // touching commas into one.
      .replace(/ *, *([,.;:!?…])/g, "$1")
      // A dash is that mirror case too, but it cannot share the class above:
      // that replacement drops the space, and "obrazek— dalej" is not a dash.
      .replace(/ *, *(?=[—–])/g, " ")
      // "Zobacz (, link,) tutaj." — a bracket or a quotation mark is the
      // author's own setting-apart. The voice does not read it, but our comma
      // hard against one is heard as a stumble, and brackets hug their content,
      // so no space is left behind.
      .replace(/([([{„“«]) *, */g, "$1")
      .replace(/ *, *([)\]}”»])/g, "$1")
      // "Obrazek , obrazek," — a space before a comma is heard as a stumble.
      .replace(/ +,/g, ",")
      // One closing the paragraph becomes a full stop rather than losing its
      // pause: a unit that ends on a dangling comma sounds unfinished before the
      // next one starts.
      .replace(/ *, *$/, ".")
      .trim()
  );
}

/**
 * Substitutes each sentinel for its spoken form in the session's language.
 *
 * This MUST happen before anytts' Pronunciation map (applied at synthesis)
 * sees the text, and the reason is concrete rather than stylistic: the Polish
 * maps contain `code → koud` and the acronym `html → ejcz ti em el`, and `⟦` is
 * a word boundary to both. Applied first, the map would turn `⟦code⟧` into
 * `⟦koud⟧` — no longer a sentinel, and the voice spells the brackets out.
 * Substituting first also leaves the map a useful job: `blok HTML` then becomes
 * `blok ejcz ti em el`, which is the acronym said correctly.
 *
 * Returning `text` itself when nothing matched is not an optimisation — it is
 * what guarantees a response with no removals is prepared byte-for-byte as it
 * was before placeholders existed, because the tidy pass never sees it.
 */
function speakSentinels(text: string, language: "pl" | "en"): string {
  const phrases = SPOKEN_SENTINEL[language];
  const substituted = text.replace(SENTINEL_RE, (_match, kind: Sentinel) => `, ${phrases[kind]},`);

  return substituted === text ? text : tidyAroundPlaceholder(substituted);
}

/**
 * The shapes a listener cannot follow when they are spelled out, as source
 * fragments so the recogniser and the classifier below cannot drift apart.
 *
 * `HEX_RUN` carries two lookaheads and both are load-bearing:
 * - **at least one digit** is the safety argument for the whole rule. Without
 *   it, `deadbeef`, `defaced`, `facade` and `decade` are ordinary English words
 *   drawn entirely from the hex alphabet, and the voice eats them.
 * - **at least one hex letter** is the mirror the contract's table does not
 *   spell out: a run of seven digits is also a run of seven hex characters, so
 *   "1048576 bytes" would be spoken as "hash bytes". A hash has both.
 *
 * `camelCase` is deliberately absent. The same rule that would improve
 * `useSpeechHost` ruins `TypeScript` and `GitHub`: capitalisation is not a word
 * boundary in prose, and an underscore is one nowhere else.
 */
const UUID_SHAPE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const DIGEST_SHAPE = "(?:sha1|sha224|sha256|sha384|sha512|md5|blake2b|blake2s|blake3):[0-9a-f]{4,}";
const IDENTIFIER_SHAPE = "[a-z][a-z0-9]*(?:_[a-z0-9]+)+";
const HEX_RUN_SHAPE = "(?=[0-9a-f]*[0-9])(?=[0-9a-f]*[a-f])[0-9a-f]{7,}";

/**
 * One pass, ordered alternation, so no rule can ever re-read another's output.
 * The order matters twice: a UUID's last group is twelve hex characters and
 * would otherwise be eaten by `HEX_RUN_SHAPE`, and a digest's prefix belongs to
 * the token rather than being a word standing in front of it.
 *
 * The token boundaries are Unicode word boundaries rather than `\b`, so a hex
 * run buried inside a longer word (`abc1234def5678xyz`) is left alone.
 */
const CODE_SHAPE_RE = new RegExp(
  `(?<![\\p{L}\\p{N}_])(?:${UUID_SHAPE}|${DIGEST_SHAPE}|${IDENTIFIER_SHAPE}|${HEX_RUN_SHAPE})(?![\\p{L}\\p{N}_])`,
  "giu",
);

const IS_UUID = new RegExp(`^${UUID_SHAPE}$`, "i");
const IS_DIGEST = new RegExp(`^${DIGEST_SHAPE}$`, "i");
const IS_IDENTIFIER = new RegExp(`^${IDENTIFIER_SHAPE}$`, "i");

/** The label each shape is announced with. `hash` needs no translating. */
const SPOKEN_SHAPE: Readonly<Record<"pl" | "en", { variable: string; id: string }>> = {
  pl: { variable: "zmienna", id: "identyfikator" },
  en: { variable: "variable", id: "identifier" },
};

/**
 * Says the code-shaped tokens in the surviving prose as words.
 *
 * This runs AFTER {@link speakSentinels} and before anytts' Pronunciation map
 * (applied at synthesis), and the second half of that is the part with teeth: the acronym table matches
 * `html` only as a standalone word and treats `_` as a word character, so
 * `HTML_PARSER` is invisible to the map until this stage has split it. Run the
 * map first and the acronym is simply never said. Substituting first hands the
 * map ordinary words, which is the only input it was tuned for.
 *
 * What `strip.ts` already did is not re-derived here. Short inline code arrives
 * unwrapped (so a backticked `user_id` is labelled like any bare token), an
 * over-long expression arrives as `⟦expr⟧` (so a full 64-character digest in
 * backticks is named an expression and never reaches the hash rule), and a path
 * arrives as its last segment with `-` and `_` already spoken as spaces — which
 * removes the very evidence the identifier rule keys on, so a path is spoken as
 * bare words with no label. That is right: it was named as a path, not as a
 * variable. A hash that IS a path's last segment keeps its shape and is named.
 */
function speakCodeShapes(text: string, language: "pl" | "en"): string {
  const labels = SPOKEN_SHAPE[language];

  return text.replace(CODE_SHAPE_RE, (token) => {
    if (IS_UUID.test(token)) return labels.id;
    if (IS_DIGEST.test(token)) return "hash";
    if (IS_IDENTIFIER.test(token)) return `${labels.variable} ${token.toLowerCase().replace(/_/g, " ")}`;

    return "hash";
  });
}

/**
 * A paragraph as synthesis will receive it: markers gone, line breaks collapsed
 * into spaces, placeholders said in words, then code-shaped tokens said as
 * words — in that order, for the reasons on {@link speakSentinels} and
 * {@link speakCodeShapes}.
 */
function toSpokenText(text: string, language: "pl" | "en"): string {
  const spoken = speakSentinels(removeMarkers(text).replace(/\s+/g, " ").trim(), language);

  return speakCodeShapes(spoken, language);
}

/** Blank-line-separated blocks, the shape `stripToSpeakableText` leaves behind. */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

/**
 * The one place where "a placeholder opening the text has nothing behind it to
 * pause after" is actually true: a unit is exactly the string handed to
 * synthesis, so an utterance can no more open with a comma than a sentence can.
 * A block that opens with a placeholder opens its first sentence with one.
 *
 * Unconditional rather than gated on a substitution having happened, because
 * the invariant is about utterances, not about placeholders — and ordinary
 * prose cannot reach here starting with a comma anyway: a block would have to
 * literally begin with one, after `removeMarkers`, whitespace collapse and a
 * trim.
 */
function toUnits(packed: readonly Packed[], lang: "pl" | "en"): SpeechUnit[] {
  return packed.map(({ source, text: spoken, block }) => {
    const text = spoken.replace(/^ *, */, "");

    return { text, chars: text.length, source, lang, block };
  });
}

/** A blockquote line with no text: `>` (or nested `> >`) alone separates two quoted paragraphs. */
const QUOTE_SEPARATOR_RE = /^ {0,3}>[>\s]*$/;
/** A setext underline: the paragraph lines above it render as one heading. */
const SETEXT_UNDERLINE_RE = /^ {0,3}(?:=+|-+)[ \t]*$/;
/** A line's blockquote prefix, nested ones included (`> `, `> > `). */
const QUOTE_PREFIX_RE = /^(?: {0,3}> ?)+/;

/** How many blockquotes the line sits in: `0` outside any, `2` for `> > `. */
function quoteDepth(line: string): number {
  return (QUOTE_PREFIX_RE.exec(line)?.[0].match(/>/g) ?? []).length;
}

/** The line inside its blockquote container: what markdown parses as the quoted block's line. */
function unquote(line: string): string {
  return line.replace(QUOTE_PREFIX_RE, "");
}

/**
 * One block of a text, as {@link splitBlockLines} cuts it: its `source` (what
 * the viewer text-matches against the rendered block) and what is `spoken`,
 * which differ only for a setext heading, whose underline is structure — not
 * text the renderer shows or the voice should read.
 */
interface TextBlock {
  source: string;
  spoken: string;
  heading: boolean;
}

/**
 * A paragraph cut at every boundary markdown renders as two blocks but
 * `strip.ts` keeps in one paragraph (there is no blank line between them):
 * - an ATX heading line — a heading may interrupt a paragraph, and the text
 *   right under it is a block of its own, so each heading line stands alone;
 * - a setext underline — the lines above it are the heading, and what follows
 *   is a new block; the underline itself is dropped from the heading's source
 *   and its speech, so a short heading still matches its rendered text. Only
 *   in the same container as the line above it: `Intro` then `> ===` is a
 *   paragraph and a quote whose `===` is text, so that line stays literal;
 * - a blockquote line holding only `>` — the quoted paragraphs on either side
 *   render as two `<p>`; the separator itself speaks nothing and is dropped.
 * Headings are recognised inside a blockquote too, after its `>` prefix: a
 * quoted heading keeps the prefix in its source (the matcher ignores `>` and
 * `#`) but is spoken as its bare text.
 */
function splitBlockLines(paragraph: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let run: string[] = [];
  const push = (source: string, spoken: string, heading: boolean): void => {
    if (source) blocks.push({ source, spoken, heading });
  };
  const flush = (heading = false): void => {
    const source = run.join("\n").trim();
    // A paragraph keeps its quote markers as ever; a heading speaks bare.
    push(source, heading ? run.map(unquote).join("\n").trim() : source, heading);
    run = [];
  };

  for (const line of paragraph.split("\n")) {
    if (QUOTE_SEPARATOR_RE.test(line)) {
      flush();
    } else if (HEADING_LINE_RE.test(unquote(line))) {
      flush();
      push(line.trim(), unquote(line).trim(), true);
    } else if (
      SETEXT_UNDERLINE_RE.test(unquote(line)) &&
      run.length > 0 &&
      quoteDepth(line) === quoteDepth(run[run.length - 1]!)
    ) {
      flush(true);
    } else {
      run.push(line);
    }
  }
  flush();

  return blocks;
}

/**
 * Abbreviations that sit before a name, a number or a noun and so never end a
 * sentence on their own full stop, compared lowercased without the trailing
 * dot. Ambiguous ones that also close sentences (`etc.`, `itd.`, `itp.`, `r.`,
 * `ok.`, `No.`) are absent: the lowercase-or-digit rule in {@link continues}
 * already keeps them inside a sentence when the text carries on.
 */
const ABBREVIATIONS = new Set([
  // English
  "mr", "mrs", "ms", "dr", "prof", "st", "vs", "fig", "cf", "e.g", "i.e",
  // Polish
  "ul", "np", "tzw", "m.in", "wg", "nr", "godz",
]);

/** The token right before a full-stop terminator, closing quotes allowed. */
const LAST_TOKEN_RE = /(?:^|\s)[("'„“‘«[]*(\S+?)\.["'”’»)\]]*$/u;

/** Text that carries a sentence on: a lowercase letter (any script) or a digit. */
const CONTINUATION_RE = /^[\p{Ll}\p{N}]/u;

/**
 * Whether `sentence` — one of `firstSentence`'s cuts — is not really over
 * because `next`, the text after it, still belongs to it: the next word starts
 * lowercase or with a digit ("e.g. grep", "np. grep", inline code `pnpm test.`
 * unwrapped mid-sentence, "No. 5"), or the cut fell on a known abbreviation's
 * full stop ("Mr. Smith", "Prof. Nowak").
 *
 * Known limitation: the lowercase-or-digit rule cannot tell a continuation
 * from a real sentence that opens lowercase or with a digit, so "npm install
 * runs next." or "4 were eaten." joins the sentence before it. Accepted —
 * one longer unit costs less than halving every "e.g." and "No." — and pinned
 * in `prepare.test.ts`.
 */
function continues(sentence: string, next: string): boolean {
  if (!next) return false;
  if (CONTINUATION_RE.test(next)) return true;
  const token = LAST_TOKEN_RE.exec(sentence)?.[1];
  return token !== undefined && ABBREVIATIONS.has(token.toLowerCase());
}

/**
 * A block's spoken text cut into sentences, in order. A trailing run with no
 * terminator — a heading-like lead-in, a list item without a full stop, a
 * paragraph that just stops — is a sentence of its own. Uses `anytts/text`'s
 * `firstSentence`, so "2.5" is never a boundary and closing quotes stay with
 * the sentence they close; a cut that {@link continues} is glued back onto the
 * next one, so an abbreviation never halves a sentence.
 */
function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let rest = text.trim();
  let pending = "";

  while (rest) {
    const cut = firstSentence(rest);
    if (!cut) {
      sentences.push(pending ? `${pending} ${rest}` : rest);
      return sentences;
    }
    // `rest` is trimmed, so `firstSentence`'s cut is exactly its prefix.
    rest = rest.slice(cut.length).trim();
    const sentence = pending ? `${pending} ${cut}` : cut;
    if (continues(sentence, rest)) {
      pending = sentence;
    } else {
      sentences.push(sentence);
      pending = "";
    }
  }
  if (pending) sentences.push(pending);

  return sentences;
}

/**
 * Sentence units — the one preparation every spoken text goes through, a page
 * or an answer alike. Each block (a top-level paragraph, a heading, a list item,
 * which `strip.ts` already makes a paragraph of its own, or a removed block's
 * placeholder) is spoken on its own:
 * - a heading is one unit, whole;
 * - every other block is one unit per sentence, never crossing the block's
 *   edge;
 * - a single sentence over {@link UNIT_MAX_CHARS} is still cut, by
 *   `anytts/text`'s `packUnits` with no floor — which, fed one sentence at a
 *   time, never merges and only ever cuts.
 *
 * The ceiling stays because a unit is also the barge-in granularity: a
 * 40-second unit cannot be interrupted mid-thought.
 *
 * Ordering needs no special code: the opening heading is the first block and so
 * unit 0, and a leading `**TLDR:**` paragraph's first sentence is unit 1. A
 * heading further down is spoken where it stands.
 *
 * Every piece of a block keeps the whole block as its `source` — the consumer
 * of `source` text-matches it against a rendered block.
 *
 * Block indices: `block` counts the blocks that produce at least one unit, in
 * document order, from 0 — a block that speaks nothing (a paragraph of bare
 * markers) takes no index, and a placeholder (`⟦code⟧`, `⟦table⟧`, `⟦html⟧`,
 * spoken "code block") takes one, because it is a unit. Every unit of a block
 * carries the same index and a block's units are consecutive, so the first unit
 * of block `b` is `units.findIndex((u) => u.block === b)`. A rendered code
 * block, mermaid diagram or table never text-matches a placeholder's source, so
 * it gets no ▶; frontmatter never reaches here (`pageSpeechText` strips it).
 */
function prepareBlocks(paragraphs: readonly string[], language: "pl" | "en"): Packed[] {
  const blocks = paragraphs.flatMap(splitBlockLines);
  const units: Packed[] = [];
  let index = 0;

  for (const block of blocks) {
    const text = toSpokenText(block.spoken, language);
    if (!text) continue;

    const sentences = block.heading ? [{ text }] : splitSentences(text).map((sentence) => ({ text: sentence }));
    for (const piece of packUnits(sentences, { min: 0, max: UNIT_MAX_CHARS })) {
      units.push({ source: block.source, text: piece.text, block: index });
    }
    index += 1;
  }

  return units;
}

export function prepare(markdown: string, opts?: PrepareOptions): PreparedSpeech {
  const language = opts?.language ?? "en";
  const paragraphs = splitParagraphs(stripToSpeakableText(markdown));

  return { units: toUnits(prepareBlocks(paragraphs, language), language), language };
}
