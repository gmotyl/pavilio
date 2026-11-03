import { describe, it, expect } from "vitest";
import { openaiEngineConfig, SPEECH_FIRST_BYTE_TIMEOUT_MS } from "../engines";
import { OPENAI_FIRST_BYTE_TIMEOUT_MS } from "../openaiVoices";

describe("openai relay timeout", () => {
  it("waits longer than the panel server waits on the OmniVoice server", () => {
    const { firstByteMs } = openaiEngineConfig([]) as { firstByteMs?: number };
    expect(OPENAI_FIRST_BYTE_TIMEOUT_MS).toBeGreaterThan(SPEECH_FIRST_BYTE_TIMEOUT_MS);
    expect(firstByteMs).toBeGreaterThan(OPENAI_FIRST_BYTE_TIMEOUT_MS);
  });
});
