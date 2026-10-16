import type { VoiceInfo } from "anytts";

/** One `<optgroup>` of a voice picker. */
export interface VoiceGroup {
  label: string;
  voices: VoiceInfo[];
}

/** `pl-PL` → `pl`; a blank tag has no language. */
function primaryLanguage(tag: string): string {
  return tag.trim().split(/[-_]/)[0]!.toLowerCase();
}

/** The language's English name (`pl` → `Polish`), or the code when the runtime has none. */
function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Splits an engine's catalog into the picker's groups, in this order and with
 * empty groups omitted:
 *
 * 1. `Multilingual` — voices that read both Polish and English;
 * 2. the browser's language — single-language voices whose locale shares its
 *    primary subtag with `browserLanguage`;
 * 3. `English` — single-language `en-*` voices (one group with 2. when the
 *    browser language is English);
 * 4. `Other voices`.
 *
 * Every voice lands in exactly one group, and each group keeps the catalog's
 * own order.
 */
export function groupVoices(voices: VoiceInfo[], browserLanguage: string): VoiceGroup[] {
  const browser = primaryLanguage(browserLanguage);
  const multilingual: VoiceInfo[] = [];
  const local: VoiceInfo[] = [];
  const english: VoiceInfo[] = [];
  const other: VoiceInfo[] = [];

  for (const voice of voices) {
    const language = primaryLanguage(voice.locale);
    if (voice.multilingual) multilingual.push(voice);
    else if (language === "en") english.push(voice);
    else if (browser !== "" && language === browser) local.push(voice);
    else other.push(voice);
  }

  // An English browser's own group IS the English group, so `local` stays
  // empty for it and needs no merge.
  const groups: VoiceGroup[] = [
    { label: "Multilingual", voices: multilingual },
    { label: languageName(browser), voices: local },
    { label: "English", voices: english },
    { label: "Other voices", voices: other },
  ];
  return groups.filter((group) => group.voices.length > 0);
}
