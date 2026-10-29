import { stripFrontmatter } from "../../lib/frontmatter";
import { prepare } from "./prepare";

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

/**
 * Whether a page's source prepares to at least one unit. Language only picks
 * the pronunciation map, which never empties a unit, so the default is asked.
 * Prepared block-bounded, as the host prepares every page.
 */
export function pageHasSpeech(source: string): boolean {
  return prepare(pageSpeechText(source), { blockBounded: true }).units.length > 0;
}
