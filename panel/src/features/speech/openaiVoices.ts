/**
 * OmniVoice voices for anytts's `openai` engine. There is no voice list in code: the catalog is
 * whatever the OmniVoice server lists (`GET /v1/voices`), fetched by the panel server's
 * `openaiCatalog`. This module keeps only the default voice map and the record → `VoiceInfo`
 * mapping. Type-only imports from anytts, so the server can import this module too.
 */
import type { EngineConfig, VoiceInfo } from "anytts";

// anytts does not export `VoiceMap` from its entry point; derive it from the engine config.
export type VoiceMap = NonNullable<EngineConfig["voices"]>;

/**
 * The defaults, each checked against the live catalog on the server (`resolveVoiceMap`): a server
 * without `my-voice` speaks with its first voice in the language instead.
 */
export const OPENAI_VOICE_MAP: VoiceMap = { pl: "my-voice", en: "my-voice", default: "my-voice" };

/** Where a voice lives on the server: tracked in its repo, or cloned from Settings. */
export type VoiceSource = "bundled" | "custom";

/**
 * A voice record as omnivoice-server answers it in `GET /v1/voices`. A legacy record (saved before
 * the metadata fields existed) carries them as `null`, or not at all.
 */
export interface OmniVoiceRecord {
  id: string;
  source?: VoiceSource | null;
  language?: string | null;
  locale?: string | null;
  gender?: string | null;
  label?: string | null;
  multilingual?: boolean | null;
  ref_text?: string | null;
  description?: string | null;
}

/** A catalog voice, plus where it lives so the browser can tell bundled from custom. */
export interface OmniVoiceInfo extends VoiceInfo {
  source: VoiceSource;
}

/**
 * The catalog voice for a server record. Missing metadata gets a usable value: the locale falls
 * back to the record's language, the label to its description, then its id. anytts knows only
 * `female` and `male`, so any other gender (`neutral`, unset) is listed as `female`. A record
 * without a source predates custom voices, so it is a bundled one.
 */
export function toVoiceInfo(record: OmniVoiceRecord): OmniVoiceInfo {
  return {
    id: record.id,
    locale: record.locale || record.language || "und",
    gender: record.gender === "male" ? "male" : "female",
    label: record.label || record.description || record.id,
    multilingual: record.multilingual === true,
    source: record.source === "custom" ? "custom" : "bundled",
  };
}

/** The language a locale names: its primary subtag, lowercased (`pl-PL` → `pl`). */
const languageOf = (locale: string): string => locale.split(/[-_]/)[0]!.toLowerCase();

/**
 * The voice map with every entry checked against the catalog. An entry whose voice the server
 * lacks falls back to the first voice in that language — a multilingual voice counts for every
 * language — then to the first voice overall. With an empty catalog there is nothing to pick from,
 * so the map comes back unchanged.
 *
 * The panel server builds its `Tts` with it and the browser its relay client, from the same list,
 * so both name the same voice and neither asks for one the server lacks.
 */
export function resolveVoiceMap(map: VoiceMap, catalog: readonly VoiceInfo[]): VoiceMap {
  if (catalog.length === 0) return map;
  const ids = new Set(catalog.map((voice) => voice.id));
  const resolved: VoiceMap = { ...map };
  for (const [lang, id] of Object.entries(map)) {
    if (ids.has(id)) continue;
    const match = catalog.find((voice) => voice.multilingual || languageOf(voice.locale) === lang);
    resolved[lang] = (match ?? catalog[0]!).id;
  }
  return resolved;
}
