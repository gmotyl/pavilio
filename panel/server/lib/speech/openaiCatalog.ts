import type { VoiceInfo } from "anytts";
import {
  toVoiceInfo,
  type OmniVoiceInfo,
  type OmniVoiceRecord,
  type VoiceMap,
} from "../../../src/features/speech/openaiVoices";

/**
 * The OpenAI-compatible engine's live catalog: the voices the OmniVoice server lists at
 * `GET /v1/voices`, minus its model-chosen `auto` voice. The server `Tts` is built from it
 * (`ttsHolder`), so `onChange` — called only when a refresh changed the list — is where the holder
 * gets rebuilt.
 *
 * A failed refresh (connection refused, timeout, a non-2xx answer, a body that is not a voice
 * listing) keeps the last good list and marks the catalog unreachable; the cascade already skips
 * `openai` on a network error. With no address set there is nothing to ask, so the list is empty.
 */
export interface OpenaiCatalog {
  /** The last good list, `auto` dropped. */
  current(): readonly OmniVoiceInfo[];
  /** Whether the last refresh failed to get a list from the server. */
  unreachable(): boolean;
  /** Fetches the list again; never rejects. */
  refresh(): Promise<{ changed: boolean }>;
}

export interface OpenaiCatalogOptions {
  /** The server address as it is now, or undefined when none (or no usable one) is set. */
  baseUrl: () => string | undefined;
  /** Default: the global `fetch`; tests inject a fake server. */
  fetch?: typeof fetch;
  /** Called after a refresh that changed the list. */
  onChange: () => void;
  /** How long one refresh may take. Default 3 s. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 3000;

/** omnivoice-server's built-in voice: the model picks a voice per call, so it is not a catalog voice. */
const AUTO_VOICE = "auto";

/** The catalog voices in a `GET /v1/voices` body: `auto`, ids that are not strings and repeats dropped. */
function voicesFrom(body: unknown): OmniVoiceInfo[] | undefined {
  const records = (body as { voices?: unknown } | null)?.voices;
  if (!Array.isArray(records)) return undefined;
  const seen = new Set<string>();
  const voices: OmniVoiceInfo[] = [];
  for (const entry of records as unknown[]) {
    const id = (entry as { id?: unknown } | null)?.id;
    // anytts rejects a catalog with a repeated id, so a repeat is dropped rather than passed on.
    if (typeof id !== "string" || !id || id === AUTO_VOICE || seen.has(id)) continue;
    seen.add(id);
    voices.push(toVoiceInfo(entry as OmniVoiceRecord));
  }
  return voices;
}

export function createOpenaiCatalog(options: OpenaiCatalogOptions): OpenaiCatalog {
  const { baseUrl, fetch: fetchImpl = fetch, onChange, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  let voices: readonly OmniVoiceInfo[] = [];
  let key = JSON.stringify(voices);
  let isUnreachable = false;
  // Refreshes can overlap (boot, a key write, Settings opening); only the latest one may land,
  // so a slow earlier answer never overwrites a newer list.
  let generation = 0;

  /** Replaces the list; true when it differs from the one it replaces. */
  function apply(next: readonly OmniVoiceInfo[]): boolean {
    const nextKey = JSON.stringify(next);
    if (nextKey === key) return false;
    voices = next;
    key = nextKey;
    return true;
  }

  async function fetchVoices(address: string): Promise<OmniVoiceInfo[] | undefined> {
    try {
      const url = `${address.replace(/\/+$/, "")}/v1/voices`;
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return undefined;
      return voicesFrom(await res.json());
    } catch {
      return undefined;
    }
  }

  return {
    current: () => voices,
    unreachable: () => isUnreachable,
    async refresh() {
      const mine = ++generation;
      const address = baseUrl();
      let next: readonly OmniVoiceInfo[] | undefined = [];
      if (address) next = await fetchVoices(address);
      if (mine !== generation) return { changed: false };

      if (!next) {
        isUnreachable = true;
        return { changed: false };
      }
      isUnreachable = false;
      const changed = apply(next);
      if (changed) onChange();
      return { changed };
    },
  };
}

/** The language a locale names: its primary subtag, lowercased (`pl-PL` → `pl`). */
const languageOf = (locale: string): string => locale.split(/[-_]/)[0]!.toLowerCase();

/**
 * The voice map with every entry checked against the catalog. An entry whose voice the server
 * lacks falls back to the first voice in that language — a multilingual voice counts for every
 * language — then to the first voice overall. With an empty catalog there is nothing to pick from,
 * so the map comes back unchanged.
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
