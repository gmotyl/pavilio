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
  it("groups multilingual, browser language, English, other — in order, empty groups omitted", () => {
    expect(shape(groupVoices(CATALOG, "pl-PL"))).toEqual([
      ["Multilingual", ["en-US-AvaMultilingualNeural", "fr-FR-VivienneMultilingualNeural"]],
      ["Polish", ["pl-PL-ZofiaNeural", "pl-PL-MarekNeural"]],
      ["English", ["en-GB-SoniaNeural", "en-US-JennyNeural"]],
      ["Other voices", ["de-DE-KatjaNeural"]],
    ]);

    // A bare primary subtag is the same browser language.
    expect(shape(groupVoices(CATALOG, "pl"))).toEqual(shape(groupVoices(CATALOG, "pl-PL")));

    // Empty groups are omitted: with no single-language English voice and no
    // "other" voice, only two groups remain.
    const noEnglish = CATALOG.filter((v) => v.multilingual || v.locale.startsWith("pl"));
    expect(groupVoices(noEnglish, "pl").map((group) => group.label)).toEqual([
      "Multilingual",
      "Polish",
    ]);

    // A browser language no voice speaks gets no group of its own.
    expect(groupVoices(CATALOG, "ja-JP").map((group) => group.label)).toEqual([
      "Multilingual",
      "English",
      "Other voices",
    ]);

    // Every catalog voice appears exactly once — the shipped catalog included.
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

  it("merges the browser group into English when the browser language is English", () => {
    expect(shape(groupVoices(CATALOG, "en-US"))).toEqual([
      ["Multilingual", ["en-US-AvaMultilingualNeural", "fr-FR-VivienneMultilingualNeural"]],
      ["English", ["en-GB-SoniaNeural", "en-US-JennyNeural"]],
      ["Other voices", ["de-DE-KatjaNeural", "pl-PL-ZofiaNeural", "pl-PL-MarekNeural"]],
    ]);
  });
});
