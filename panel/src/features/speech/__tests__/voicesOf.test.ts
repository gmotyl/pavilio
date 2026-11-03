import { afterEach, describe, expect, it } from "vitest";
import { listVoices } from "anytts";
import { OPENAI_VOICE_MAP } from "../openaiVoices";
import { __resetOpenaiVoicesForTests, reloadOpenaiVoices } from "../useOpenaiVoices";
import { voicesOf } from "../voicesOf";
import { jsonResponse, stubFetch } from "../../../test-utils";
import { LIVE_VOICES, OPENAI_VOICES_URL, voicesBody } from "./openaiVoiceFixtures";

afterEach(() => {
  __resetOpenaiVoicesForTests();
});

describe("voicesOf", () => {
  it("voicesOf returns the live list for openai and anytts for others", () => {
    expect(voicesOf("openai", LIVE_VOICES)).toBe(LIVE_VOICES);
    expect(voicesOf("edge", LIVE_VOICES)).toEqual(listVoices("edge"));
    expect(voicesOf("edge").length).toBeGreaterThan(0);
  });

  it("voicesOf reads the last loaded list when none is passed", async () => {
    expect(voicesOf("openai")).toEqual([]);
    stubFetch({ [OPENAI_VOICES_URL]: () => jsonResponse(voicesBody()) });
    await reloadOpenaiVoices();
    expect(voicesOf("openai")).toEqual(LIVE_VOICES);
  });

  it("the OpenAI voice map defaults every language to my-voice", () => {
    expect(OPENAI_VOICE_MAP).toEqual({ pl: "my-voice", en: "my-voice", default: "my-voice" });
  });
});
