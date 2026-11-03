import { listVoices, type VoiceInfo } from "anytts";

/**
 * The OpenAI-compatible engine's voices in the browser. The catalog now lives on the OmniVoice
 * server (the panel server holds it in `openaiCatalog`), and the browser does not read it yet, so
 * it lists none for now: no openai voice can be picked, every stored one reads as stale, and the
 * server speaks with its default voice resolved against the live catalog.
 */
const NO_OPENAI_VOICES: readonly VoiceInfo[] = [];

/** The voices an engine offers: none yet for `openai` (see above), anytts's list otherwise. */
export function voicesOf(engine: string): readonly VoiceInfo[] {
  return engine === "openai" ? NO_OPENAI_VOICES : listVoices(engine);
}
