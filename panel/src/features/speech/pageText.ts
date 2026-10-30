import { stripFrontmatter } from "../../lib/frontmatter";
import { voteLanguage } from "./language";
import { prepare } from "./prepare";
import type { PreparedSpeech } from "./types";

/**
 * What of a page's markdown source is handed to speech preparation: the source
 * without its leading frontmatter. Answers never carry frontmatter, so
 * `prepare` has no stage for it; a page does, and it is metadata, not prose.
 *
 * Every page path goes through here — the host's `speakDocument` lands the
 * stripped text (so its utterance id ignores a frontmatter-only edit), and the
 * toolbar asks {@link pageHasSpeech} of the same text — so the two can never
 * disagree on whether a page has anything to say.
 */
export function pageSpeechText(source: string): string {
  return stripFrontmatter(source);
}

/** How many prepared pages {@link preparePageText} keeps: a few open pages, re-rendering. */
const PAGE_CACHE_LIMIT = 8;
/** Stripped page text → its preparation, least recently used first. */
const preparedPages = new Map<string, PreparedSpeech>();

/**
 * A page's preparation, from its already-stripped speech text (what
 * {@link pageSpeechText} returns, and what the host lands as the utterance's
 * text). The ONE way a page is prepared: the host's run, the toolbar's
 * {@link pageHasSpeech} and play-from-here's block matching all come through
 * here, so a unit index means the same unit in all three.
 *
 * A page is not a session: its language is its own vote, read from the same
 * text. The language is not cosmetic — it words the placeholders ("obrazek" vs
 * "image", "blok kodu" vs "code block"), which changes the lengths `prepare`
 * packs by, and with them which unit every later block starts at.
 *
 * Memoised on the text (a small LRU): the toolbar, the ▶ layer and the host all
 * ask for the same page on every render. The result is shared — read it, never
 * mutate it.
 */
export function preparePageText(text: string): PreparedSpeech {
  const cached = preparedPages.get(text);
  if (cached) {
    preparedPages.delete(text);
    preparedPages.set(text, cached);
    return cached;
  }
  const prepared = prepare(text, { language: voteLanguage(text), blockBounded: true });
  preparedPages.set(text, prepared);
  if (preparedPages.size > PAGE_CACHE_LIMIT) {
    const oldest = preparedPages.keys().next().value;
    if (oldest !== undefined) preparedPages.delete(oldest);
  }
  return prepared;
}

/** A page's preparation from its markdown source, frontmatter and all. */
export function preparePage(source: string): PreparedSpeech {
  return preparePageText(pageSpeechText(source));
}

/** Whether a page's source prepares to at least one unit, as the host prepares it. */
export function pageHasSpeech(source: string): boolean {
  return preparePage(source).units.length > 0;
}
