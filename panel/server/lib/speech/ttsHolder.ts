import type { EdgeEngineOptions, EngineStatus, Tts, TtsConfig, VoiceInfo } from "anytts";
import { createTts as createServerTts } from "anytts/server";
import {
  OPENAI_FIRST_BYTE_TIMEOUT_MS,
  OPENAI_VOICE_MAP,
} from "../../../src/features/speech/openaiVoices";
import { KOKORO_FIRST_BYTE_TIMEOUT_MS } from "../../../src/features/speech/kokoro";
import { resolveVoiceMap } from "./openaiCatalog.js";
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

export { KOKORO_FIRST_BYTE_TIMEOUT_MS };

export type KeyedEngineId = keyof typeof KEYED_ENGINES;

/**
 * The cascade's default member order; the browser sends its own order per request anyway.
 * The local engines lead: `openai` and `kokoro` are configured only when their address
 * (`OPENAI_TTS_BASE_URL`, `KOKORO_TTS_BASE_URL`) is set, so the order handed to `createTts` is
 * narrowed to the engines actually configured.
 */
export const CASCADE_ORDER = ["openai", "kokoro", "elevenlabs", "cartesia", "speechify", "azure", "edge"];

/** The Azure engine's own region check: with a key, anything else makes `createTts` throw. */
const AZURE_REGION = /^[a-z0-9]+$/;

/** The local engines' (`openai`, `kokoro`) address check: anything but an http(s) URL makes `createTts` throw. */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export interface TtsHolderOptions {
  /** Builds the instance; tests inject fakes. Default: `createTts` from `anytts/server`. */
  createTts?: (config: TtsConfig) => Tts;
  /** Where the keys come from. Default: the secrets store (`process.env`, then `secrets.env`). */
  resolveKey?: typeof resolveSecret;
  /** Read-aloud WebSocket factory for the instance's `edge`; route tests inject a fake one. */
  transport?: EdgeEngineOptions["transport"];
  /**
   * The OpenAI-compatible engine's live catalog (`openaiCatalog`), read on every build. Default:
   * none, so `openai` stays out until the server wires its catalog in.
   */
  catalog?: { current(): readonly VoiceInfo[] };
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
  catalog: readonly VoiceInfo[],
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
  const regionOk = !!region && AZURE_REGION.test(region);
  if (azureKey && !regionOk) {
    // Names the variable only: neither the key nor the region value is logged.
    console.warn(
      `[speech] ${KEYED_ENGINES.azure} is set but AZURE_SPEECH_REGION is missing or not a ` +
        `region id (e.g. "westeurope"): Azure stays off until it is fixed.`,
    );
  }
  const azure = azureKey && regionOk ? { apiKey: azureKey, region } : {};

  // `openai` has no keyless form: without a usable address it is left out altogether.
  const baseUrl = key("OPENAI_TTS_BASE_URL");
  const baseUrlOk = !!baseUrl && isHttpUrl(baseUrl);
  if (baseUrl && !baseUrlOk) {
    // Names the variable only, like the Azure warning: the value is not logged.
    console.warn(
      `[speech] OPENAI_TTS_BASE_URL is set but is not an http(s) URL ` +
        `(e.g. "http://127.0.0.1:8890"): the openai engine stays off until it is fixed.`,
    );
  }
  // `kokoro` likewise has no keyless form; its catalog ships with anytts, so no fetch gates it.
  const kokoroUrl = key("KOKORO_TTS_BASE_URL");
  const kokoroUrlOk = !!kokoroUrl && isHttpUrl(kokoroUrl);
  if (kokoroUrl && !kokoroUrlOk) {
    // Names the variable only: the value is not logged.
    console.warn(
      `[speech] KOKORO_TTS_BASE_URL is set but is not an http(s) URL ` +
        `(e.g. "http://127.0.0.1:8880"): the kokoro engine stays off until it is fixed.`,
    );
  }
  const members: TtsConfig["engines"] = {
    elevenlabs: keyed(KEYED_ENGINES.elevenlabs),
    cartesia: keyed(KEYED_ENGINES.cartesia),
    speechify: keyed(KEYED_ENGINES.speechify),
    azure,
    edge: transport ? { transport } : {},
  };
  // anytts needs at least one voice: until the first refresh brings the server's list (or while
  // a server that was down at boot stays down) `openai` is left out, and the refresh that brings
  // voices rebuilds the holder.
  if (baseUrl && baseUrlOk && catalog.length > 0) {
    members.openai = {
      baseUrl,
      // anytts takes a mutable array; the live catalog stays read-only.
      catalog: [...catalog],
      // Defaults the server lacks fall back to a voice it has, never an unknown-voice error.
      voices: resolveVoiceMap(OPENAI_VOICE_MAP, catalog),
      languageField: "language",
      firstByteMs: OPENAI_FIRST_BYTE_TIMEOUT_MS,
      // A retry re-spends the whole wait on a server that synthesizes one clip at a time.
      retries: 0,
    };
  }

  if (kokoroUrl && kokoroUrlOk) {
    members.kokoro = { baseUrl: kokoroUrl, firstByteMs: KOKORO_FIRST_BYTE_TIMEOUT_MS };
  }

  return {
    engines: {
      ...members,
      // anytts rejects a cascade member that is not a configured engine.
      cascade: { order: CASCADE_ORDER.filter((id) => Object.hasOwn(members, id)) },
    },
    defaultEngine: "edge",
    // The relay passes no tier, so every request lands in the first one.
    scheduler: { concurrency: 4, tiers: [{ name: "relay" }] },
  };
}

export function createTtsHolder(options: TtsHolderOptions = {}): TtsHolder {
  const { createTts = createServerTts, resolveKey = resolveSecret, transport, catalog } = options;
  const build = (): Tts => createTts(configFrom(resolveKey, transport, catalog?.current() ?? []));
  let instance = build();
  return {
    current: () => instance,
    rebuild: () => (instance = build()),
    engineStatus: (id) => instance.engineStatus(id),
  };
}
