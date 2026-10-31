import type { SynthesisRequest, SynthesisResult, Tts } from "anytts";
import type { UsageStore } from "./usage-store.js";

/**
 * Wraps the relay's Tts so keyed-engine and cascade syntheses that reach the
 * network are recorded in `store`, in code points, under the engine that
 * answered (for a cascade, the member — `SynthesisResult.engine`).
 *
 * Not recorded: requests with no engine or engine `edge` (the browser reports
 * Edge itself, on either route), requests already cached before the call (for
 * a cascade, anytts' `isCached` is true when any member's cache answers), and
 * failures, whose rejection propagates unchanged. Recording is fire-and-forget:
 * a store failure is logged and never delays or breaks the result.
 *
 * Every other `Tts` method delegates to `tts`. `prefetch` is not counted: the
 * relay only ever calls `synthesize`, and anytts' prefetch runs its internal
 * synthesize, which this wrapper cannot see.
 */
export function countingTts(tts: Tts, store: UsageStore): Tts {
  async function synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    if (req.engine === undefined || req.engine === "edge") return tts.synthesize(req);
    const cached = tts.isCached(req);
    const result = await tts.synthesize(req);
    if (!cached) record(result.engine, [...req.text].length);
    return result;
  }

  function record(engine: string, chars: number): void {
    try {
      store.record(engine, chars).catch(logFailure);
    } catch (err) {
      // A store that throws synchronously is logged the same way.
      logFailure(err);
    }
  }

  // A Proxy rather than a hand-listed delegate, so a method anytts adds later
  // still reaches the inner instance.
  return new Proxy(tts, {
    get(target, prop) {
      if (prop === "synthesize") return synthesize;
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function logFailure(err: unknown): void {
  console.error("[tts-usage] could not record relay usage:", err instanceof Error ? err.message : err);
}
