/**
 * The voice language: the language a spoken text is prepared in, read from the locale of the voice
 * meant to speak it. A `pl` locale gives Polish; every other locale (a multilingual voice in a third
 * language, OmniVoice's `und`, an unknown voice) gives English.
 */
import { voicesOf } from "./voicesOf";

export type VoiceLanguage = "pl" | "en";

/** Polish when the locale's primary subtag is `pl` (`pl`, `pl-PL`), otherwise English. */
export function languageOfLocale(locale: string | undefined): VoiceLanguage {
  return locale?.split(/[-_]/)[0]?.toLowerCase() === "pl" ? "pl" : "en";
}

/**
 * The language of `voice` in `engine`'s catalog: the same list the voice pickers show, so for
 * `openai` the last loaded OmniVoice list. A voice the catalog lacks (or none) is English.
 */
export function voiceLanguageFor(engine: string, voice: string | undefined): VoiceLanguage {
  // Every voice of the Polish Pocket engine is Polish, workspace voices too: one not listed yet
  // (the list loads after a page reload) still reads Polish.
  if (engine === "pocket-pl") return "pl";
  if (voice === undefined) return "en";
  return languageOfLocale(voicesOf(engine).find((info) => info.id === voice)?.locale);
}
