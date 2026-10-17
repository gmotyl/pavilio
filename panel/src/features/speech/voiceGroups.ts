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
 * 2. one group per language for the single-language voices, keyed by the
 *    locale's primary subtag (so `en-US` and `en-GB` share `English`) and
 *    labelled with the language's English name: the browser's language first,
 *    then English, then the remaining languages alphabetically by label;
 * 3. `Other voices` — only voices whose locale has no language subtag.
 *
 * Every voice lands in exactly one group, and each group keeps the catalog's
 * own order.
 */
export function groupVoices(voices: VoiceInfo[], browserLanguage: string): VoiceGroup[] {
  const browser = primaryLanguage(browserLanguage);
  const multilingual: VoiceInfo[] = [];
  const byLanguage = new Map<string, VoiceInfo[]>();
  const other: VoiceInfo[] = [];

  for (const voice of voices) {
    const language = primaryLanguage(voice.locale);
    if (voice.multilingual) multilingual.push(voice);
    else if (language === "") other.push(voice);
    else byLanguage.set(language, [...(byLanguage.get(language) ?? []), voice]);
  }

  const rank = (code: string) => (code === browser ? 0 : code === "en" ? 1 : 2);
  const languages = [...byLanguage.entries()]
    .map(([code, group]) => ({ code, label: languageName(code), voices: group }))
    .sort((a, b) => rank(a.code) - rank(b.code) || a.label.localeCompare(b.label, "en"));

  const groups: VoiceGroup[] = [
    { label: "Multilingual", voices: multilingual },
    ...languages.map(({ label, voices: group }) => ({ label, voices: group })),
    { label: "Other voices", voices: other },
  ];
  return groups.filter((group) => group.voices.length > 0);
}
