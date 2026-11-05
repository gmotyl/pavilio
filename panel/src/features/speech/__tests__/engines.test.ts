import { describe, it, expect } from "vitest";
import {
  openaiEngineConfig,
  SPEECH_ENGINES,
  SPEECH_CASCADE_FIRST_BYTE_TIMEOUT_MS,
  SPEECH_FIRST_BYTE_TIMEOUT_MS,
} from "../engines";
import { KOKORO_FIRST_BYTE_TIMEOUT_MS } from "../kokoro";
import { OPENAI_FIRST_BYTE_TIMEOUT_MS } from "../openaiVoices";

describe("cascade relay timeout", () => {
  it("leaves the fallback members a full minute after openai and kokoro, which lead the cascade, give up", () => {
    expect(SPEECH_CASCADE_FIRST_BYTE_TIMEOUT_MS).toBe(
      OPENAI_FIRST_BYTE_TIMEOUT_MS + KOKORO_FIRST_BYTE_TIMEOUT_MS + 60000,
    );
    // Both local servers hanging, then four keyed members timing out once at the server's 8 s.
    // With anytts' default retry each would cost 16 s (64 s > the 60 s margin): accepted, since
    // four keyed engines all hanging on both attempts is rare and the relay just fails over.
    expect(SPEECH_CASCADE_FIRST_BYTE_TIMEOUT_MS).toBeGreaterThan(
      OPENAI_FIRST_BYTE_TIMEOUT_MS + KOKORO_FIRST_BYTE_TIMEOUT_MS + 4 * 8000,
    );
  });
});

describe("openai relay timeout", () => {
  it("waits longer than the panel server waits on the OmniVoice server", () => {
    const { firstByteMs } = openaiEngineConfig([]) as { firstByteMs?: number };
    expect(OPENAI_FIRST_BYTE_TIMEOUT_MS).toBeGreaterThan(SPEECH_FIRST_BYTE_TIMEOUT_MS);
    expect(firstByteMs).toBeGreaterThan(OPENAI_FIRST_BYTE_TIMEOUT_MS);
  });
});

describe("kokoro relay client", () => {
  it("kokoro is a relay client that outlasts the server wait", () => {
    expect(SPEECH_ENGINES.kokoro).toMatchObject({
      relayUrl: "/api/tts",
      firstByteMs: KOKORO_FIRST_BYTE_TIMEOUT_MS + 15000,
    });
    expect(SPEECH_ENGINES.kokoro?.firstByteMs).toBe(45000);
  });
});
