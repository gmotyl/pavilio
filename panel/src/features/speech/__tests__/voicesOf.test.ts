import { describe, expect, it } from "vitest";
import { listVoices } from "anytts";
import { OPENAI_CATALOG, OPENAI_VOICE_MAP } from "../openaiVoices";
import { voicesOf } from "../voicesOf";

describe("voicesOf", () => {
  it("voicesOf returns the OmniVoice catalog for openai", () => {
    const voices = voicesOf("openai");
    expect(voices).toEqual(OPENAI_CATALOG);
    expect(voices).toHaveLength(14);
    expect(voices.some((voice) => voice.id === "auto")).toBe(false);
    expect(voices.every((voice) => voice.multilingual === false)).toBe(true);
  });

  it("voicesOf defers to listVoices for other engines", () => {
    expect(voicesOf("edge")).toEqual(listVoices("edge"));
    expect(voicesOf("edge").length).toBeGreaterThan(0);
  });

  it("the OpenAI voice map points into the catalog", () => {
    const ids = OPENAI_CATALOG.map((voice) => voice.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(OPENAI_VOICE_MAP).toEqual({ pl: "cand-pl-f2", en: "cand-en-gb-f2", default: "cand-pl-f2" });
    for (const id of Object.values(OPENAI_VOICE_MAP)) expect(ids).toContain(id);
  });
});
