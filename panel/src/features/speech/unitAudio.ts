/**
 * One unit's audio for a speech key: a page's (`doc:` key) through the page
 * audio cache, which answers from disk and synthesizes only a miss; an
 * answer's straight from the synthesizer, so answers never touch the page
 * cache. The options — voice, tier, signal — reach `synthesizeSpeech` as they
 * are either way, so a page unit's synthesis queues, promotes and fails
 * exactly as an answer unit's does.
 */
import { isDocSpeechKey } from "./docKey";
import { pageAudio } from "./pageCache";
import { synthesizeSpeech, type SpeechSynthesisOptions } from "./synth";
import type { SpeechUnit } from "./types";

export function unitAudio(
  key: string,
  unit: SpeechUnit,
  options: SpeechSynthesisOptions,
): Promise<ArrayBuffer> {
  return isDocSpeechKey(key) ? pageAudio(key, unit, options) : synthesizeSpeech(unit.text, options);
}
