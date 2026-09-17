/**
 * Response markdown in, speech units out. Pure and synchronous: everything
 * table-driven about this feature lives here.
 *
 * The stage order matters and is easy to get wrong:
 *
 * 1. `stripToSpeakableText` first, so everything after it sees only what will
 *    actually be spoken.
 * 2. Then ordering: the response's opening heading becomes unit 0, a leading
 *    `**TLDR:**` becomes unit 1, and the body is packed into units. Playback
 *    awaits only unit 0, so the first two units are deliberately small.
 *
 * `strip.ts` deliberately leaves heading `#` and emphasis `**` markers in place
 * so this module can find the heading and the TLDR. Removing them is therefore
 * this module's job and nothing else's — see {@link removeMarkers}. A unit's
 * text is the exact string handed to synthesis, so a marker that survives to
 * here is a marker the voice reads out loud.
 *
 * Language is **received, not detected**. It is a property of the session (see
 * `voteLanguage` / `nextLanguageState` in `pronunciation.ts`), accumulated
 * across utterances, and defaults to English — the branch that changes nothing.
 *
 * It is also this module that turns `strip.ts`'s neutral sentinels into words,
 * and it does so **before** the pronunciation map — see
 * {@link speakSentinels}, where the collision that forces that order is spelled
 * out.
 */
import { applyPronunciation } from "./pronunciation";
import { SENTINEL, SENTINEL_ONLY_RE, stripToSpeakableText } from "./strip";
import type { PreparedSpeech, SpeechUnit } from "./types";

/** Floor a packed unit is merged up to. */
export const UNIT_MIN_CHARS = 200;

/** Ceiling a unit is cut at, on sentence boundaries. */
export const UNIT_MAX_CHARS = 450;

export interface PrepareOptions {
  /**
   * The session's language, as accumulated by `nextLanguageState`. Defaults to
   * `"en"`: misapplying the pronunciation map is the harm, so the default is
   * the branch that leaves the text alone.
   */
  language?: "pl" | "en";
}

/**
 * One paragraph in both its readings: `source` as `strip.ts` left it — markers,
 * sentinels and all — and `text` as the voice will receive it. The two travel
 * together through packing so that a unit can say where it was spoken from.
 * Every sizing and joining decision is made on `text`, because `text` is what
 * synthesis gets; `source` only follows along.
 */
interface Packed {
  source: string;
  text: string;
}

/** An ATX heading line: `#` … `######`, up to three leading spaces. */
const HEADING_LINE_RE = /^ {0,3}#{1,6}[ \t]+(.*)$/;

/** A paragraph opening with `**TLDR:**` (or `**TLDR**`). */
const TLDR_PARAGRAPH_RE = /^[ \t]*\*\*TLDR:?\*\*/i;

/**
 * Removes every markdown marker that is still standing. Ordering is what makes
 * it safe: the paired forms are unwrapped before the sweep for stray markers, so
 * `**bold**` becomes `bold` rather than losing its content.
 *
 * Underscores count as emphasis only when the run is bounded by non-word
 * characters — `PAVILIO_TERMINAL_ID` must survive intact, because `strip.ts` has
 * already decided that short identifiers are worth speaking.
 */
function removeMarkers(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(HEADING_LINE_RE, "$1"))
    .join("\n")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/(?<![\p{L}\p{N}_])_([^_\n]+)_(?![\p{L}\p{N}_])/gu, "$1")
    .replace(/\*/g, "");
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
 * reading "obrazek" as the next word of it. The paragraph's two outer edges are
 * deliberately NOT tidied here — a paragraph edge is not an utterance edge, and
 * what the leading comma should become depends on the paragraph before it. That
 * decision belongs to {@link joinPacked} and {@link toUnits}, which are the two
 * places where the neighbour is known.
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
      // pause: units are packed from paragraphs joined by a single space, so a
      // dangling comma would let this paragraph run straight into the next one.
      .replace(/ *, *$/, ".")
      .trim()
  );
}

/**
 * Substitutes each sentinel for its spoken form in the session's language.
 *
 * This MUST run before {@link applyPronunciation}, and the reason is concrete
 * rather than stylistic: the Polish maps contain `code → koud` and the acronym
 * `html → ejcz-ti-em-el`, and `⟦` is a word boundary to both. Applied first,
 * the map turns `⟦code⟧` into `⟦koud⟧` — no longer a sentinel, so nothing here
 * recognises it, and the voice spells the brackets out. Substituting first also
 * leaves the map a useful job: `blok HTML` then becomes `blok ejcz-ti-em-el`,
 * which is the acronym said correctly.
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
 * This runs AFTER {@link speakSentinels} and BEFORE {@link applyPronunciation},
 * and the second half of that is the part with teeth: the acronym table matches
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
 * A paragraph as the voice will receive it: markers gone, line breaks collapsed
 * into spaces, placeholders said in words, code-shaped tokens said as words,
 * and the pronunciation map applied on the Polish branch only — in that order,
 * for the reasons on {@link speakSentinels} and {@link speakCodeShapes}.
 */
function toSpokenText(text: string, language: "pl" | "en"): string {
  const spoken = speakSentinels(removeMarkers(text).replace(/\s+/g, " ").trim(), language);
  const said = speakCodeShapes(spoken, language);

  return language === "pl" ? applyPronunciation(said) : said;
}

/** A paragraph paired with its spoken form, or `null` when nothing is left to say. */
function speak(source: string, language: "pl" | "en"): Packed | null {
  const text = toSpokenText(source, language);

  return text ? { source, text } : null;
}

/** Blank-line-separated blocks, the shape `stripToSpeakableText` leaves behind. */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

/**
 * Sentences, for cutting an oversized paragraph. The trailing alternative keeps
 * a final fragment that never got its terminator — dropping it would silently
 * lose the end of a paragraph.
 */
function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?…]+[.!?…]+["'”’)\]]*|[^.!?…]+$/g);

  return matches ? matches.map((part) => part.trim()).filter((part) => part.length > 0) : [text];
}

/** Greedily fills pieces up to `max`, splitting on words only as a last resort. */
function cutAtCeiling(text: string, max: number): string[] {
  const pieces: string[] = [];
  let pending = "";

  const flush = (): void => {
    if (pending) pieces.push(pending);
    pending = "";
  };

  for (const sentence of splitSentences(text)) {
    if (pending && `${pending} ${sentence}`.length > max) flush();

    if (sentence.length > max) {
      flush();
      for (const word of sentence.split(/\s+/)) {
        if (pending && `${pending} ${word}`.length > max) flush();
        pending = pending ? `${pending} ${word}` : word;
      }
      continue;
    }

    pending = pending ? `${pending} ${sentence}` : sentence;
  }
  flush();

  return pieces;
}

/**
 * {@link cutAtCeiling} for a paragraph in both readings. The spoken text decides
 * the pieces; every piece carries the whole paragraph as its source. The
 * consumer of `source` — `matchUnitsToBlocks` — works at the granularity of a
 * rendered block, and a paragraph is one block, so a slice of it would map to
 * exactly the block the whole does. Cutting the source too would only buy a
 * second sentence splitter to keep aligned with the first, and a wrong slice
 * would be a lie where the whole is merely coarse.
 */
function cutPackedAtCeiling(paragraph: Packed, max: number): Packed[] {
  return cutAtCeiling(paragraph.text, max).map((text) => ({ source: paragraph.source, text }));
}

/**
 * Joins one packed paragraph onto the unit being built.
 *
 * A paragraph that begins with a comma begins with a placeholder, and that
 * comma is its pause. Whether the pause is *needed* is decidable only here, at
 * the seam, because it depends on the paragraph before it. Paragraphs are
 * joined by a single space, so a left side carrying no punctuation of its own —
 * a mid-body heading, which `removeMarkers` strips to bare words and which
 * therefore never has a terminator — would otherwise run straight into the
 * placeholder, and "Wyniki blok kodu" is one noun phrase to a listener. A
 * heading followed by a fenced block is the most common shape an agent answer
 * has, so this is the common case, not a corner.
 *
 * When the left side does already pause, theirs wins and ours goes: that is
 * {@link tidyAroundPlaceholder}'s first rule, applied at the one place where
 * the thing it reasons about is actually visible.
 */
function joinPacked(pending: string, paragraph: string): string {
  if (!paragraph.startsWith(", ")) return `${pending} ${paragraph}`;

  return /[,.;:!?…—–]$/.test(pending) ? `${pending} ${paragraph.slice(2)}` : `${pending}${paragraph}`;
}

/**
 * Packs spoken paragraphs into units: merge consecutive ones until the unit
 * reaches {@link UNIT_MIN_CHARS}, never merging past {@link UNIT_MAX_CHARS}, and
 * cut a paragraph that is oversized on its own.
 *
 * The floor exists because a two-word paragraph costs a whole synthesis round
 * trip for half a second of audio; the ceiling exists because a unit is also the
 * barge-in granularity, and a 40-second unit cannot be interrupted mid-thought.
 */
function packUnits(paragraphs: readonly Packed[]): Packed[] {
  const units: Packed[] = [];
  let pending: Packed | null = null;

  const flush = (): void => {
    if (pending) units.push(pending);
    pending = null;
  };

  for (const paragraph of paragraphs) {
    if (paragraph.text.length > UNIT_MAX_CHARS) {
      flush();
      units.push(...cutPackedAtCeiling(paragraph, UNIT_MAX_CHARS));
      continue;
    }

    if (!pending) pending = paragraph;
    else {
      const joined = joinPacked(pending.text, paragraph.text);

      if (joined.length > UNIT_MAX_CHARS) {
        flush();
        pending = paragraph;
      } else {
        // Source paragraphs never open with a placeholder's comma — the
        // sentinel is still a sentinel there — so a single space is the same
        // join `joinPacked` performs on the spoken side.
        pending = { source: `${pending.source} ${paragraph.source}`, text: joined };
      }
    }

    if (pending.text.length >= UNIT_MIN_CHARS) flush();
  }
  flush();

  return units;
}

/** The opening sentence, used as a small fast-start unit when there is no TLDR. */
function firstSentence(text: string): string | null {
  return text.match(/^[\s\S]*?[.!?…]+(?=\s|$)/)?.[0].trim() ?? null;
}

/**
 * The fast-start unit taken off the front of the body, paired with what is left
 * to pack. `null` when there is no sentence to open with at all, which leaves
 * the first unit to {@link packUnits} exactly as it was before this rule existed.
 *
 * The second branch is the one that needs arguing for, because it is the only
 * place a unit is built from two paragraphs before packing. A lead-in ending in
 * a colon — "Here are the steps:" — is not a sentence but a sentence
 * *fragment*, and the sentence it opens finishes in the paragraph behind it.
 * That used to be invisible, because a tight list was one paragraph with its
 * intro; now `strip.ts` gives every item its own paragraph so a unit's `source`
 * names exactly the items it speaks. Read one paragraph at a time, the lead-in
 * has no terminator, `firstSentence` finds nothing, the rule is skipped, and
 * the intro packs together with five of its items — unit 0, the one playback
 * waits on, grows four times over. So the fast start is allowed to cross one
 * paragraph boundary, and one only: it takes the lead-in plus the first
 * sentence behind it, which is the unit this shape produced all along.
 *
 * `source` is then both blocks, because both are spoken in it — `matchUnitsToBlocks`
 * reads a unit's source as the concatenation of the paragraphs it says.
 */
function takeFastStart(first: Packed, rest: readonly Packed[]): { unit: Packed; body: Packed[] } | null {
  const own = firstSentence(first.text);

  if (own) {
    const remainder = first.text.slice(own.length).trim();

    return {
      unit: { source: first.source, text: own },
      body: remainder ? [{ source: first.source, text: remainder }, ...rest] : [...rest],
    };
  }

  const [next, ...tail] = rest;
  const sentence = next ? firstSentence(next.text) : null;
  if (!next || !sentence) return null;

  // This unit is built before packing runs, so nothing downstream would cut it:
  // over the ceiling, the fast start would hand playback a unit larger than any
  // {@link packUnits} would ever emit — the opposite of what it exists for. So
  // it stands down and lets the normal packing path cut the sentence instead.
  if (joinPacked(first.text, sentence).length > UNIT_MAX_CHARS) return null;

  const remainder = next.text.slice(sentence.length).trim();

  return {
    unit: { source: `${first.source} ${next.source}`, text: joinPacked(first.text, sentence) },
    body: remainder ? [{ source: next.source, text: remainder }, ...tail] : [...tail],
  };
}

/**
 * Pulls the response's opening heading off the front, if it has one. Only a
 * heading that *opens* the response is a title: a heading further down is a
 * section marker inside the body, and hoisting it to unit 0 would speak the
 * response out of order. Mutates `paragraphs`, which is this function's local
 * working list.
 *
 * Returns the heading *line*, `#` included: it is a paragraph like any other
 * and goes through {@link speak}, whose `removeMarkers` is what drops the
 * hashes — so the unit's source keeps them and its text does not.
 */
function takeHeading(paragraphs: string[]): string | null {
  const first = paragraphs[0];
  if (first === undefined) return null;

  const [line, ...rest] = first.split("\n");
  const heading = HEADING_LINE_RE.exec(line);
  if (!heading) return null;

  const remainder = rest.join("\n").trim();
  if (remainder) paragraphs[0] = remainder;
  else paragraphs.shift();

  return line.trim();
}

/**
 * The other half of {@link joinPacked}, and the one place where "a placeholder
 * opening the text has nothing behind it to pause after" is actually true: a
 * unit is exactly the string handed to synthesis, so an utterance can no more
 * open with a comma than a sentence can. A paragraph, by contrast, is only ever
 * a fragment of one — which is why this rule used to fire a paragraph too early
 * and silently delete the pause a packed paragraph needed.
 *
 * Unconditional rather than gated on a substitution having happened, because
 * the invariant is about utterances, not about placeholders — and ordinary
 * prose cannot reach here starting with a comma anyway: a paragraph would have
 * to literally begin with one, after `removeMarkers`, whitespace collapse and a
 * trim.
 */
function toUnits(packed: readonly Packed[]): SpeechUnit[] {
  return packed.map(({ source, text: spoken }) => {
    const text = spoken.replace(/^ *, */, "");

    return { text, chars: text.length, source };
  });
}

export function prepare(markdown: string, opts?: PrepareOptions): PreparedSpeech {
  const language = opts?.language ?? "en";

  const paragraphs = splitParagraphs(stripToSpeakableText(markdown));
  const heading = takeHeading(paragraphs);

  const opening: Packed[] = [];
  if (heading) {
    const spoken = speak(heading, language);
    if (spoken) opening.push(spoken);
  }

  // A response that opens with a removed block opens with a sentinel paragraph.
  // It carries no sentence terminator, so `firstSentence` finds nothing in it
  // and the fast-start rule below is skipped entirely — the sentinel then packs
  // together with the whole first prose paragraph, and unit 0, the one playback
  // waits on, becomes a long synthesis instead of a short one.
  //
  // Taking such a paragraph as its own opening unit fixes that without
  // reordering anything: it is already the shortest unit there can be, it stays
  // exactly where the answer put it, and the first *prose* paragraph behind it
  // is then free to give up its opening sentence as usual. The alternative —
  // skipping past the sentinel to pick the fast start — would speak the answer
  // out of order, which is the one thing this stage must never do.
  while (paragraphs.length > 0 && SENTINEL_ONLY_RE.test(paragraphs[0])) {
    const spoken = speak(paragraphs.shift() as string, language);
    if (spoken) opening.push(spoken);
  }

  // Only the FIRST body paragraph can be the TLDR, because the TLDR unit is
  // hoisted to the front — honouring a mid-body one would speak the response
  // out of order. A `**TLDR:**` paragraph anywhere else is ordinary body. The
  // sentinels above do not count against "first": they are omissions, not
  // prose, so a TLDR standing behind one is still the response's summary.
  const tldr = paragraphs.length > 0 && TLDR_PARAGRAPH_RE.test(paragraphs[0]) ? paragraphs[0] : null;

  let body = (tldr === null ? paragraphs : paragraphs.slice(1))
    .map((paragraph) => speak(paragraph, language))
    .filter((paragraph): paragraph is Packed => paragraph !== null);

  if (tldr !== null) {
    const spoken = speak(tldr, language);
    if (spoken) opening.push(spoken);
  } else {
    // No TLDR: the fast-start unit is the body's first sentence, and what is
    // left of the paragraph it came from goes back to the head of the packing
    // queue. Both halves keep the whole paragraph as their source — see
    // `cutPackedAtCeiling` for why a piece is never sliced.
    const [first, ...rest] = body;
    const fastStart = first ? takeFastStart(first, rest) : null;

    if (fastStart) {
      opening.push(fastStart.unit);
      body = fastStart.body;
    }
  }

  return { units: toUnits([...opening, ...packUnits(body)]), language };
}
