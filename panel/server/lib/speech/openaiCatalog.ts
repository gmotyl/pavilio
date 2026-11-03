import {
  toVoiceInfo,
  type OmniVoiceInfo,
  type OmniVoiceRecord,
} from "../../../src/features/speech/openaiVoices";

// The map check is shared with the browser, which resolves its own openai map the same way.
export { resolveVoiceMap } from "../../../src/features/speech/openaiVoices";

/**
 * The OpenAI-compatible engine's live catalog: the voices the OmniVoice server lists at
 * `GET /v1/voices`, minus its model-chosen `auto` voice. The server `Tts` is built from it
 * (`ttsHolder`), so `onChange` — called only when a refresh changed the list — is where the holder
 * gets rebuilt.
 *
 * A failed refresh (connection refused, timeout, a non-2xx answer, a body that is not a voice
 * listing) keeps the last good list and marks the catalog unreachable; the cascade already skips
 * `openai` on a network error. The last good list is kept only for the address that produced it:
 * a failed refresh at a different address drops it, so one server's voice ids are never sent to
 * another. With no address set there is nothing to ask, so the list is empty.
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
  // The address the current list came from: a failed refresh keeps the list only for it.
  let source: string | undefined;
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
        if (address === source) return { changed: false };
        // Another server's list: drop it rather than offer its voice ids to this one.
        source = address;
        const dropped = apply([]);
        if (dropped) onChange();
        return { changed: dropped };
      }
      isUnreachable = false;
      source = address;
      const changed = apply(next);
      if (changed) onChange();
      return { changed };
    },
  };
}
