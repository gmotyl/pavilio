import { afterEach, describe, expect, it } from "vitest";
import type { OmniVoiceInfo } from "../openaiVoices";
import { __resetOpenaiVoicesForTests, reloadOpenaiVoices } from "../useOpenaiVoices";
import { languageOfLocale, voiceLanguageFor } from "../voiceLanguage";
import { jsonResponse, stubFetch } from "../../../test-utils";
import { EN_MALE, OPENAI_VOICES_URL, PL_FEMALE, voicesBody } from "./openaiVoiceFixtures";

/** The twin OmniVoice voices: one speaker, one record per language. */
const BILL_EN: OmniVoiceInfo = { ...EN_MALE, id: "bill-en", label: "Bill (English)", source: "custom" };
const BILL_PL: OmniVoiceInfo = { ...PL_FEMALE, id: "bill-pl", label: "Bill (Polish)", source: "custom" };

async function loadLiveVoices(voices: readonly OmniVoiceInfo[]): Promise<void> {
  stubFetch({ [OPENAI_VOICES_URL]: () => jsonResponse(voicesBody(voices)) });
  await reloadOpenaiVoices();
}

afterEach(() => {
  __resetOpenaiVoicesForTests();
});

describe("voiceLanguage", () => {
  it("pl locales map to Polish, everything else to English", () => {
    expect(languageOfLocale("pl-PL")).toBe("pl");
    expect(languageOfLocale("pl")).toBe("pl");
    expect(languageOfLocale("en-GB")).toBe("en");
    expect(languageOfLocale("it-IT")).toBe("en");
    expect(languageOfLocale("de-DE")).toBe("en");
    expect(languageOfLocale("und")).toBe("en");
    expect(languageOfLocale(undefined)).toBe("en");
  });

  it("the match is on the primary subtag, in any case and with either separator", () => {
    expect(languageOfLocale("PL-pl")).toBe("pl");
    expect(languageOfLocale("pl_PL")).toBe("pl");
    // Another language whose code starts with `pl` is not Polish.
    expect(languageOfLocale("pli")).toBe("en");
    expect(languageOfLocale("plt-MG")).toBe("en");
  });

  it("OmniVoice twins map to their own language", async () => {
    await loadLiveVoices([BILL_EN, BILL_PL]);
    expect(voiceLanguageFor("openai", "bill-en")).toBe("en");
    expect(voiceLanguageFor("openai", "bill-pl")).toBe("pl");
  });

  it("an unknown or missing voice is English", async () => {
    await loadLiveVoices([BILL_PL]);
    expect(voiceLanguageFor("openai", "nobody")).toBe("en");
    expect(voiceLanguageFor("openai", undefined)).toBe("en");
    // A Polish openai voice is not in Edge's catalog.
    expect(voiceLanguageFor("edge", "bill-pl")).toBe("en");
    expect(voiceLanguageFor("edge", "pl-PL-MarekNeural")).toBe("pl");
  });

  it("a multilingual voice in another language is English", () => {
    expect(voiceLanguageFor("edge", "it-IT-GiuseppeMultilingualNeural")).toBe("en");
  });
});
