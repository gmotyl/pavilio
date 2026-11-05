/**
 * The engines the panel's anytts instance configures: the ONE engine list.
 *
 * `synth.ts` builds its instance from {@link SPEECH_ENGINES}; the settings
 * boundary (`voices.ts`) and the Engine picker go by {@link speechEngines}.
 * anytts may list more engines than this — any of those reaching
 * `resolveVoice` or `synthesize` would throw RangeError, so they are as
 * unknown here as a typo.
 *
 * A module of its own, below the seam, so the many suites that mock
 * `synth.ts` wholesale still get the real list.
 */
import type { TtsConfig, VoiceInfo } from "anytts";
import {
  DEFAULT_CASCADE_ORDER,
  DEFAULT_SPEECH_VOICE,
  preferences,
  type CascadeEntry,
} from "../../preferences/declarations";
import { readPreference } from "../../preferences/store";
import { KOKORO_FIRST_BYTE_TIMEOUT_MS } from "./kokoro";
import { OPENAI_FIRST_BYTE_TIMEOUT_MS, OPENAI_VOICE_MAP, resolveVoiceMap } from "./openaiVoices";

/** The engine id that walks the others: it has no voices of its own. */
export const CASCADE = "cascade";

/** Max gap between audio chunks before anytts treats the stream as stalled and retries. */
export const SPEECH_STREAM_STALL_TIMEOUT_MS = 15000;

/**
 * Max wait for the first audio byte before anytts gives up and retries.
 *
 * Sized for the relay, not the socket: anytts' relay answers only after the
 * server has synthesized the WHOLE clip, so in relay mode this wait covers the
 * server's own first-byte wait (8s) plus the synthesis. At anytts' 8s default
 * a slow Edge turn (12.7s measured on a short sentence) failed in the browser
 * while the server went on to succeed. Also applies to the direct socket,
 * where it only makes a dead turn take longer to be declared dead.
 */
export const SPEECH_FIRST_BYTE_TIMEOUT_MS = 25000;

/**
 * Max wait for a cascade relay call's first byte. One call walks the members
 * on the server until one speaks, so it covers several members' first-byte
 * waits (a member that times out costs the server's 8s) before the one that
 * answers synthesizes its whole clip. `openai` and `kokoro` lead the cascade
 * and may each hold it for their whole wait, so the minute the other members
 * need comes on top of both.
 */
export const SPEECH_CASCADE_FIRST_BYTE_TIMEOUT_MS =
  OPENAI_FIRST_BYTE_TIMEOUT_MS + KOKORO_FIRST_BYTE_TIMEOUT_MS + 60000;

/**
 * A keyed engine in the browser: a relay client of the panel server, which
 * holds the key. Always the relay, in every browser and on every route — the
 * route is about how EDGE reaches Microsoft.
 */
const KEYED_RELAY = {
  relayUrl: "/api/tts",
  firstByteMs: SPEECH_FIRST_BYTE_TIMEOUT_MS,
  stallMs: SPEECH_STREAM_STALL_TIMEOUT_MS,
};

/**
 * The browser's `openai` relay client for the live list (`useOpenaiVoices`). Its catalog is the
 * OmniVoice server's list, and its map the defaults resolved against that list exactly as the
 * panel server resolves them, so a voice picked from the list is accepted and a default the server
 * lacks is never named.
 *
 * anytts refuses an empty catalog, so before the first load (and with no address) the client gets
 * a placeholder entry per default. Nothing ever sends it: with no live list `synth.ts` turns an
 * `openai` request into a one-member cascade that names no voice, and the panel server picks.
 */
export function openaiEngineConfig(live: readonly VoiceInfo[]): TtsConfig["engines"][string] {
  const catalog: VoiceInfo[] =
    live.length > 0
      ? [...live]
      : [...new Set(Object.values(OPENAI_VOICE_MAP))].map((id) => ({
          id,
          label: id,
          locale: "und",
          gender: "male",
          multilingual: true,
        }));
  return {
    ...KEYED_RELAY,
    // Outlasts the panel server's own wait on the OmniVoice server, so the server's verdict lands.
    firstByteMs: OPENAI_FIRST_BYTE_TIMEOUT_MS + 15000,
    catalog,
    voices: resolveVoiceMap(OPENAI_VOICE_MAP, live),
  };
}

export const SPEECH_ENGINES: TtsConfig["engines"] = {
  edge: {
    voices: { default: DEFAULT_SPEECH_VOICE },
    // The panel server mounts anytts' relay here for browsers that cannot
    // open the Edge socket themselves.
    relayUrl: "/api/tts",
    firstByteMs: SPEECH_FIRST_BYTE_TIMEOUT_MS,
    stallMs: SPEECH_STREAM_STALL_TIMEOUT_MS,
  },
  // One relay call walks the members on the server, in the order each request names.
  [CASCADE]: {
    relayUrl: "/api/tts",
    firstByteMs: SPEECH_CASCADE_FIRST_BYTE_TIMEOUT_MS,
    stallMs: SPEECH_STREAM_STALL_TIMEOUT_MS,
  },
  elevenlabs: KEYED_RELAY,
  cartesia: KEYED_RELAY,
  speechify: KEYED_RELAY,
  azure: KEYED_RELAY,
  // The local OpenAI-compatible server, reached through the relay like the
  // keyed engines. Always configured here: the browser cannot tell whether the
  // server has the address, and the server drops `openai` when it has not.
  // `synth.ts` swaps in the live list (`openaiEngineConfig`) once it is loaded.
  openai: openaiEngineConfig([]),
  // A local Kokoro-FastAPI server, same relay. Its catalog ships with anytts, so no live list.
  // Outlasts the panel server's wait on Kokoro (a cold model load), so the server's verdict lands.
  kokoro: { ...KEYED_RELAY, firstByteMs: KOKORO_FIRST_BYTE_TIMEOUT_MS + 15000 },
};

/** The configured engine ids. */
export function speechEngines(): string[] {
  return Object.keys(SPEECH_ENGINES);
}

/**
 * The cascade order in effect: the stored entries for engines the cascade can
 * hold, in their stored order (an unknown id or a repeat dropped), then any
 * member engine the record does not name, on — so an engine added to the list
 * later joins the cascade instead of vanishing from it.
 */
export function getCascadeOrder(): CascadeEntry[] {
  const seen = new Set<string>();
  const order: CascadeEntry[] = [];
  for (const entry of readPreference(preferences.speechCascadeOrder)) {
    if (!DEFAULT_CASCADE_ORDER.includes(entry.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    order.push({ id: entry.id, on: entry.on });
  }
  for (const id of DEFAULT_CASCADE_ORDER) if (!seen.has(id)) order.push({ id, on: true });
  return order;
}

/**
 * The cascade's "voice": one voice per member, as one string.
 *
 * Everything above the seam carries a session's voice as a string — the
 * player, the host's warms and preloads and the cache peeks all key on voice +
 * text — so under the cascade the session's voice is this key, and only the
 * seam opens it ({@link cascadeVoicesOf}) into the request's `voices`. Members
 * sorted, so the same voices are always the same key.
 */
const CASCADE_VOICES_PREFIX = "cascade:";

export function cascadeVoiceKey(voices: Readonly<Record<string, string>>): string {
  const members = Object.keys(voices).sort();
  return CASCADE_VOICES_PREFIX + JSON.stringify(members.map((id) => [id, voices[id]]));
}

/** Whether `voice` is a {@link cascadeVoiceKey} rather than one engine's voice id. */
export function isCascadeVoiceKey(voice: string | undefined): voice is string {
  return voice !== undefined && voice.startsWith(CASCADE_VOICES_PREFIX);
}

/** The member voices a {@link cascadeVoiceKey} names; `undefined` for anything else. */
export function cascadeVoicesOf(voice: string | undefined): Record<string, string> | undefined {
  if (!isCascadeVoiceKey(voice)) return undefined;
  try {
    const pairs: unknown = JSON.parse(voice.slice(CASCADE_VOICES_PREFIX.length));
    if (!Array.isArray(pairs)) return undefined;
    const valid = pairs.filter(
      (pair): pair is [string, string] =>
        Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string",
    );
    return Object.fromEntries(valid);
  } catch {
    return undefined;
  }
}
