import { describe, expect, it } from "vitest";
import { listVoices } from "anytts";
import { OPENAI_VOICE_MAP } from "../openaiVoices";
import { voicesOf } from "../voicesOf";

describe("voicesOf", () => {
  it("voicesOf lists no openai voices until the browser reads the server's catalog", () => {
    // The catalog lives on the OmniVoice server now; there is no voice list in code.
    expect(voicesOf("openai")).toEqual([]);
  });

  it("voicesOf defers to listVoices for other engines", () => {
    expect(voicesOf("edge")).toEqual(listVoices("edge"));
    expect(voicesOf("edge").length).toBeGreaterThan(0);
  });

  it("the OpenAI voice map defaults every language to my-voice", () => {
    expect(OPENAI_VOICE_MAP).toEqual({ pl: "my-voice", en: "my-voice", default: "my-voice" });
  });
});
