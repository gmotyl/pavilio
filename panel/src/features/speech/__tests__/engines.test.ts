import { describe, it, expect } from "vitest";
import {
  openaiEngineConfig,
  SPEECH_CASCADE_FIRST_BYTE_TIMEOUT_MS,
  SPEECH_FIRST_BYTE_TIMEOUT_MS,
} from "../engines";
import { OPENAI_FIRST_BYTE_TIMEOUT_MS } from "../openaiVoices";

describe("cascade relay timeout", () => {
  it("leaves the fallback members a full minute after openai, which leads the cascade, gives up", () => {
    expect(SPEECH_CASCADE_FIRST_BYTE_TIMEOUT_MS).toBe(OPENAI_FIRST_BYTE_TIMEOUT_MS + 60000);
  });
});

describe("openai relay timeout", () => {
  it("waits longer than the panel server waits on the OmniVoice server", () => {
    const { firstByteMs } = openaiEngineConfig([]) as { firstByteMs?: number };
    expect(OPENAI_FIRST_BYTE_TIMEOUT_MS).toBeGreaterThan(SPEECH_FIRST_BYTE_TIMEOUT_MS);
    expect(firstByteMs).toBeGreaterThan(OPENAI_FIRST_BYTE_TIMEOUT_MS);
  });
});
