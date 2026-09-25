// The client half of the knob: one accessor, with the default baked in.
//
// The value arrives on `GET /api/preferences.js` (see
// server/routes/__tests__/preferences.config.test.ts for the serving half), and
// a browser can meet a document that predates the key — an older panel behind a
// newer bundle, a page whose request for that script was refused. Those cases
// must read as "3000", never as NaN or a zero-length debounce, which is why the
// default lives here as well as in `panel.config.ts`.

import { describe, it, expect, afterEach } from "vitest";
import {
  DEFAULT_ANSWER_WAVE_DEBOUNCE_MS,
  answerWaveDebounceMs,
} from "../answerWaveDebounce";

type Tuning = { answerWaveDebounceMs?: unknown } | undefined;
const globals = globalThis as { __PAVILIO_TUNING__?: Tuning };

afterEach(() => {
  delete globals.__PAVILIO_TUNING__;
});

describe("answerWaveDebounceMs", () => {
  it("falls back to the default when the boot document omits the key", () => {
    // Three shapes of "the key is not there", and they are not the same event:
    // no document at all is a page that never ran the script, an empty document
    // is an older panel, and an explicit `undefined` is a config that served
    // nothing. All three read as the default.
    expect(answerWaveDebounceMs()).toBe(DEFAULT_ANSWER_WAVE_DEBOUNCE_MS);

    globals.__PAVILIO_TUNING__ = {};
    expect(answerWaveDebounceMs()).toBe(DEFAULT_ANSWER_WAVE_DEBOUNCE_MS);

    globals.__PAVILIO_TUNING__ = { answerWaveDebounceMs: undefined };
    expect(answerWaveDebounceMs()).toBe(DEFAULT_ANSWER_WAVE_DEBOUNCE_MS);
  });

  it("takes the value the boot document carries", () => {
    globals.__PAVILIO_TUNING__ = { answerWaveDebounceMs: 500 };
    expect(answerWaveDebounceMs()).toBe(500);
  });

  it("falls back to the default for a value the document should never carry", () => {
    // The server guards this already; the accessor guards it again because a
    // stale or hand-edited document is reachable and a zero here would silently
    // disable the debounce rather than fail loudly.
    for (const bad of [0, -1, NaN, Infinity, "500", null]) {
      globals.__PAVILIO_TUNING__ = { answerWaveDebounceMs: bad };
      expect(answerWaveDebounceMs()).toBe(DEFAULT_ANSWER_WAVE_DEBOUNCE_MS);
    }
  });

  it("the default is three seconds", () => {
    expect(DEFAULT_ANSWER_WAVE_DEBOUNCE_MS).toBe(3000);
  });
});
