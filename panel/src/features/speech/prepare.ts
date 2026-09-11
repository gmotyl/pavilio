/**
 * Response markdown in, speech units out. Pure and synchronous: everything
 * table-driven about this feature lives here.
 *
 * The stage order matters and is easy to get wrong:
 *
 * 1. `stripToSpeakableText` first — the **budget cut happens after stripping**,
 *    so a response that is 90% diff still spends its whole budget on the 10%
 *    that is prose.
 * 2. Then ordering: the response's opening heading becomes unit 0, a leading
 *    `**TLDR:**` becomes unit 1, and the body is packed into units. Playback
 *    awaits only unit 0, so the first two units are deliberately small.
 * 3. Then the budget cut, which only decides *how many* of those units are
 *    spoken. The rest are reported as the remainder rather than dropped, so the
 *    panel can offer them.
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
 */
import { applyPronunciation } from "./pronunciation";
import { stripToSpeakableText } from "./strip";
import type { PreparedSpeech, SpeechUnit } from "./types";

/** Characters of prepared speech one utterance may spend — ~90s of Polish. */
export const SPEECH_BUDGET_CHARS = 1300;

/** Floor a packed unit is merged up to. */
export const UNIT_MIN_CHARS = 200;

/** Ceiling a unit is cut at, on sentence boundaries. */
export const UNIT_MAX_CHARS = 450;

export interface PrepareOptions {
  budgetChars?: number;
  /**
   * The session's language, as accumulated by `nextLanguageState`. Defaults to
   * `"en"`: misapplying the pronunciation map is the harm, so the default is
   * the branch that leaves the text alone.
   */
  language?: "pl" | "en";
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

/**
 * A paragraph as the voice will receive it: markers gone, line breaks collapsed
 * into spaces, and the pronunciation map applied on the Polish branch only.
 */
function toSpokenText(text: string, language: "pl" | "en"): string {
  const spoken = removeMarkers(text).replace(/\s+/g, " ").trim();

  return language === "pl" ? applyPronunciation(spoken) : spoken;
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
 * Packs spoken paragraphs into units: merge consecutive ones until the unit
 * reaches {@link UNIT_MIN_CHARS}, never merging past {@link UNIT_MAX_CHARS}, and
 * cut a paragraph that is oversized on its own.
 *
 * The floor exists because a two-word paragraph costs a whole synthesis round
 * trip for half a second of audio; the ceiling exists because a unit is also the
 * barge-in granularity, and a 40-second unit cannot be interrupted mid-thought.
 */
function packUnits(paragraphs: readonly string[]): string[] {
  const units: string[] = [];
  let pending = "";

  const flush = (): void => {
    if (pending) units.push(pending);
    pending = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > UNIT_MAX_CHARS) {
      flush();
      units.push(...cutAtCeiling(paragraph, UNIT_MAX_CHARS));
      continue;
    }

    if (!pending) pending = paragraph;
    else if (`${pending} ${paragraph}`.length > UNIT_MAX_CHARS) {
      flush();
      pending = paragraph;
    } else pending = `${pending} ${paragraph}`;

    if (pending.length >= UNIT_MIN_CHARS) flush();
  }
  flush();

  return units;
}

/** The opening sentence, used as a small fast-start unit when there is no TLDR. */
function firstSentence(text: string): string | null {
  return text.match(/^[\s\S]*?[.!?…]+(?=\s|$)/)?.[0].trim() ?? null;
}

/**
 * Pulls the response's opening heading off the front, if it has one. Only a
 * heading that *opens* the response is a title: a heading further down is a
 * section marker inside the body, and hoisting it to unit 0 would speak the
 * response out of order. Mutates `paragraphs`, which is this function's local
 * working list.
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

  return heading[1].trim();
}

function toUnits(texts: readonly string[]): SpeechUnit[] {
  return texts.map((text) => ({ text, chars: text.length }));
}

/**
 * How many leading units fit the budget. At least one unit is always spoken
 * when there is one: a budget smaller than unit 0 should still say something
 * rather than fall silent and report the whole response as a remainder.
 */
function countWithinBudget(units: readonly SpeechUnit[], budgetChars: number): number {
  let spent = 0;
  let spoken = 0;

  for (const unit of units) {
    if (spoken > 0 && spent + unit.chars > budgetChars) break;
    spent += unit.chars;
    spoken += 1;
  }

  return spoken;
}

export function prepare(markdown: string, opts?: PrepareOptions): PreparedSpeech {
  const language = opts?.language ?? "en";
  const budgetChars = opts?.budgetChars ?? SPEECH_BUDGET_CHARS;

  const paragraphs = splitParagraphs(stripToSpeakableText(markdown));
  const heading = takeHeading(paragraphs);

  // Only the FIRST body paragraph can be the TLDR, because the TLDR unit is
  // hoisted to index 1 — honouring a mid-body one would speak the response out
  // of order. A `**TLDR:**` paragraph anywhere else is ordinary body.
  const tldr = paragraphs.length > 0 && TLDR_PARAGRAPH_RE.test(paragraphs[0]) ? paragraphs[0] : null;

  const opening: string[] = [];
  if (heading) {
    const spoken = toSpokenText(heading, language);
    if (spoken) opening.push(spoken);
  }

  let body = (tldr === null ? paragraphs : paragraphs.slice(1))
    .map((paragraph) => toSpokenText(paragraph, language))
    .filter((paragraph) => paragraph.length > 0);

  if (tldr !== null) {
    const spoken = toSpokenText(tldr, language);
    if (spoken) opening.push(spoken);
  } else {
    // No TLDR: the fast-start unit is the body's first sentence, and what is
    // left of its paragraph goes back to the head of the packing queue.
    const [first, ...rest] = body;
    const sentence = first ? firstSentence(first) : null;

    if (first && sentence) {
      opening.push(sentence);
      const remainder = first.slice(sentence.length).trim();
      body = remainder ? [remainder, ...rest] : rest;
    }
  }

  const units = toUnits([...opening, ...packUnits(body)]);
  const spokenUnits = countWithinBudget(units, budgetChars);

  return {
    units,
    language,
    spokenUnits,
    remainderParagraphs: units.length - spokenUnits,
  };
}
