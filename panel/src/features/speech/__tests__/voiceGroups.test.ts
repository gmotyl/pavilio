import { describe, expect, it } from "vitest";
import { listVoices, type VoiceInfo } from "anytts";

import { groupVoices } from "../voiceGroups";

function voice(id: string, locale: string, multilingual = false): VoiceInfo {
  return { id, label: id, locale, gender: "female", multilingual };
}

/** One of every kind, deliberately out of group order. */
const CATALOG: VoiceInfo[] = [
  voice("de-DE-KatjaNeural", "de-DE"),
  voice("en-GB-SoniaNeural", "en-GB"),
  voice("pl-PL-ZofiaNeural", "pl-PL"),
  voice("en-US-AvaMultilingualNeural", "en-US", true),
  voice("en-US-JennyNeural", "en-US"),
  voice("pl-PL-MarekNeural", "pl-PL"),
  voice("fr-FR-VivienneMultilingualNeural", "fr-FR", true),
];

const shape = (groups: ReturnType<typeof groupVoices>) =>
  groups.map((group) => [group.label, group.voices.map((v) => v.id)]);

describe("groupVoices", () => {
  it("puts Multilingual first, then the browser language, English, the rest alphabetically", () => {
    expect(shape(groupVoices(CATALOG, "pl-PL"))).toEqual([
      ["Multilingual", ["en-US-AvaMultilingualNeural", "fr-FR-VivienneMultilingualNeural"]],
      ["Polish", ["pl-PL-ZofiaNeural", "pl-PL-MarekNeural"]],
      ["English", ["en-GB-SoniaNeural", "en-US-JennyNeural"]],
      ["German", ["de-DE-KatjaNeural"]],
    ]);

    // A bare primary subtag is the same browser language.
    expect(shape(groupVoices(CATALOG, "pl"))).toEqual(shape(groupVoices(CATALOG, "pl-PL")));

    // Empty groups are omitted: with no single-language English or German
    // voice, only two groups remain.
    const noEnglish = CATALOG.filter((v) => v.multilingual || v.locale.startsWith("pl"));
    expect(groupVoices(noEnglish, "pl").map((group) => group.label)).toEqual([
      "Multilingual",
      "Polish",
    ]);
  });

  it("an English browser gets one English group (en-US and en-GB together), then Polish", () => {
    expect(shape(groupVoices(CATALOG, "en-US"))).toEqual([
      ["Multilingual", ["en-US-AvaMultilingualNeural", "fr-FR-VivienneMultilingualNeural"]],
      ["English", ["en-GB-SoniaNeural", "en-US-JennyNeural"]],
      ["German", ["de-DE-KatjaNeural"]],
      ["Polish", ["pl-PL-ZofiaNeural", "pl-PL-MarekNeural"]],
    ]);

    const polishOnly = CATALOG.filter((v) => v.multilingual || !v.locale.startsWith("de"));
    expect(groupVoices(polishOnly, "en-GB").map((group) => group.label)).toEqual([
      "Multilingual",
      "English",
      "Polish",
    ]);
  });

  it("a browser language no voice speaks gets no group; English still leads the rest", () => {
    const noGerman = CATALOG.filter((v) => !v.locale.startsWith("de"));
    expect(groupVoices(noGerman, "ja-JP").map((group) => group.label)).toEqual([
      "Multilingual",
      "English",
      "Polish",
    ]);
    expect(groupVoices(CATALOG, "").map((group) => group.label)).toEqual([
      "Multilingual",
      "English",
      "German",
      "Polish",
    ]);
  });

  it("sorts the remaining languages by their English label, not by code", () => {
    // By label: Finnish < German < Spanish; by code it would be de, es, fi.
    const catalog = [
      voice("es-ES-ElviraNeural", "es-ES"),
      voice("de-DE-KatjaNeural", "de-DE"),
      voice("fi-FI-NooraNeural", "fi-FI"),
    ];
    expect(groupVoices(catalog, "en").map((group) => group.label)).toEqual([
      "Finnish",
      "German",
      "Spanish",
    ]);
  });

  it("collects voices with no parseable locale in a final Other voices group", () => {
    const catalog = [voice("blank", ""), ...CATALOG, voice("spaces", "  ")];
    expect(shape(groupVoices(catalog, "pl")).at(-1)).toEqual(["Other voices", ["blank", "spaces"]]);
    expect(groupVoices(CATALOG, "pl").some((group) => group.label === "Other voices")).toBe(false);
  });

  it("puts every catalog voice in exactly one group — the shipped catalog included", () => {
    for (const [catalog, language] of [
      [CATALOG, "pl"],
      [CATALOG, "en-US"],
      [CATALOG, "ja"],
      [listVoices("edge"), "pl-PL"],
      [listVoices("edge"), ""],
    ] as const) {
      const ids = groupVoices([...catalog], language).flatMap((group) => group.voices.map((v) => v.id));
      expect(ids.sort()).toEqual(catalog.map((v) => v.id).sort());
    }
  });
});
