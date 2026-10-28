import type { EdgeEngineOptions, EngineStatus, Tts, TtsConfig } from "anytts";
import { createTts as createServerTts } from "anytts/server";
import { resolveKey as resolveSecret, type KeyVar } from "./secrets.js";

/**
 * The server's one anytts `Tts`: every keyed engine with its key from the
 * secrets store, `edge`, and `cascade` over them. `/api/tts` serves keyed and
 * cascade requests from it, and the engine routes read `engineStatus` from it.
 * A key write calls `rebuild()`; the old instance is dropped, not closed, so a
 * request already running on it still finishes there.
 */

/** Keyed engine id → the variable holding its API key. */
export const KEYED_ENGINES = {
  elevenlabs: "ELEVENLABS_API_KEY",
  cartesia: "CARTESIA_API_KEY",
  speechify: "SPEECHIFY_API_KEY",
  azure: "AZURE_SPEECH_KEY",
} as const satisfies Record<string, KeyVar>;

export type KeyedEngineId = keyof typeof KEYED_ENGINES;

/** The cascade's default member order; the browser sends its own order per request anyway. */
export const CASCADE_ORDER = ["elevenlabs", "cartesia", "speechify", "azure", "edge"];

/** The Azure engine's own region check: with a key, anything else makes `createTts` throw. */
const AZURE_REGION = /^[a-z0-9]+$/;

export interface TtsHolderOptions {
  /** Builds the instance; tests inject fakes. Default: `createTts` from `anytts/server`. */
  createTts?: (config: TtsConfig) => Tts;
  /** Where the keys come from. Default: the secrets store (`process.env`, then `secrets.env`). */
  resolveKey?: typeof resolveSecret;
  /** Read-aloud WebSocket factory for the instance's `edge`; route tests inject a fake one. */
  transport?: EdgeEngineOptions["transport"];
}

export interface TtsHolder {
  /** The instance new requests should use. */
  current(): Tts;
  /** Builds a fresh instance from the keys as they are now (skip windows start over) and returns it. */
  rebuild(): Tts;
  /** `current().engineStatus(id)`; throws RangeError for an id that is not a configured engine. */
  engineStatus(id: string): EngineStatus;
}

function configFrom(
  resolveKey: typeof resolveSecret,
  transport: EdgeEngineOptions["transport"] | undefined,
): TtsConfig {
  const key = (name: KeyVar): string | undefined => resolveKey(name).value;
  const keyed = (name: KeyVar) => {
    const apiKey = key(name);
    return apiKey ? { apiKey } : {};
  };

  // A key without a usable region would make createTts throw and take the
  // server down with it: configure Azure keyless instead (status `no-key`).
  const region = key("AZURE_SPEECH_REGION")?.toLowerCase();
  const azureKey = key(KEYED_ENGINES.azure);
  const azure = azureKey && region && AZURE_REGION.test(region) ? { apiKey: azureKey, region } : {};

  return {
    engines: {
      elevenlabs: keyed(KEYED_ENGINES.elevenlabs),
      cartesia: keyed(KEYED_ENGINES.cartesia),
      speechify: keyed(KEYED_ENGINES.speechify),
      azure,
      edge: transport ? { transport } : {},
      cascade: { order: CASCADE_ORDER },
    },
    defaultEngine: "edge",
    // The relay passes no tier, so every request lands in the first one.
    scheduler: { concurrency: 4, tiers: [{ name: "relay" }] },
  };
}

export function createTtsHolder(options: TtsHolderOptions = {}): TtsHolder {
  const { createTts = createServerTts, resolveKey = resolveSecret, transport } = options;
  const build = (): Tts => createTts(configFrom(resolveKey, transport));
  let instance = build();
  return {
    current: () => instance,
    rebuild: () => (instance = build()),
    engineStatus: (id) => instance.engineStatus(id),
  };
}
