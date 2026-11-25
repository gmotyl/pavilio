import { stripFrontmatter } from "../../lib/frontmatter";
import { prepare } from "./prepare";
import type { PreparedSpeech } from "./types";
import type { VoiceLanguage } from "./voiceLanguage";

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
/** Language + stripped page text → its preparation, least recently used first. */
const preparedPages = new Map<string, PreparedSpeech>();

/**
 * A page's preparation, from its already-stripped speech text (what
 * {@link pageSpeechText} returns, and what the host lands as the utterance's
 * text), in the voice language of the voice meant to speak it. The ONE way a
 * page is prepared: the host's run, the toolbar's {@link pageHasSpeech} and
 * play-from-here's block matching all come through here, so a unit index means
 * the same unit in all three.
 *
 * The language is the caller's, read from the host's `languageFor` port for
 * the page's `doc:` key (its project's voice), never from the page's own text.
 * It is not cosmetic — it words the placeholders ("obrazek" vs "image",
 * "blok kodu" vs "code block") and travels as each unit's `lang` — so the same
 * page in the other language is different units, and with them different audio.
 *
 * Memoised on the language and the text (a small LRU): the toolbar, the ▶
 * layer and the host all ask for the same page on every render, and a page
 * prepared under one voice language is never served under the other. The
 * result is shared — read it, never mutate it.
 */
export function preparePageText(text: string, language: VoiceLanguage): PreparedSpeech {
  const key = `${language}\n${text}`;
  const cached = preparedPages.get(key);
  if (cached) {
    preparedPages.delete(key);
    preparedPages.set(key, cached);
    return cached;
  }
  const prepared = prepare(text, { language });
  preparedPages.set(key, prepared);
  if (preparedPages.size > PAGE_CACHE_LIMIT) {
    const oldest = preparedPages.keys().next().value;
    if (oldest !== undefined) preparedPages.delete(oldest);
  }
  return prepared;
}

/** A page's preparation from its markdown source, frontmatter and all. */
export function preparePage(source: string, language: VoiceLanguage): PreparedSpeech {
  return preparePageText(pageSpeechText(source), language);
}

/** Whether a page's source prepares to at least one unit, as the host prepares it. */
export function pageHasSpeech(source: string, language: VoiceLanguage): boolean {
  return preparePage(source, language).units.length > 0;
}
