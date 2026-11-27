import { afterEach, describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { listVoices } from "anytts";

import { jsonResponse, stubFetch } from "../../../test-utils";
import { voiceLanguageFor } from "../voiceLanguage";
import {
  __resetPocketVoicesForTests,
  currentPocketCustomVoices,
  reloadPocketVoices,
  usePocketVoices,
} from "../usePocketVoices";
import { voicesOf } from "../voicesOf";

const POCKET_VOICES_URL = "/api/speech/pocket/voices";
const PIOTR = { id: "piotr", label: "Piotr", gender: "male", version: 3 };

afterEach(() => {
  __resetPocketVoicesForTests();
});

describe("pocket voice lists", () => {
  it("pocket lists presets plus workspace voices in en-US", async () => {
    stubFetch({ [POCKET_VOICES_URL]: () => jsonResponse({ voices: [PIOTR], cloning: true }) });
    const { result } = renderHook(() => usePocketVoices());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    const presets = listVoices("pocket");
    expect(presets).toHaveLength(27);
    const voices = voicesOf("pocket");
    expect(voices).toHaveLength(28);
    expect(voices.slice(0, 27)).toEqual(presets);
    expect(voices[27]).toMatchObject({ id: "piotr", label: "Piotr", locale: "en-US", gender: "male" });
  });

  it("pocket-pl lists shefowl plus workspace voices in pl-PL", async () => {
    stubFetch({ [POCKET_VOICES_URL]: () => jsonResponse({ voices: [PIOTR], cloning: true }) });
    await reloadPocketVoices();
    const voices = voicesOf("pocket-pl");
    expect(voices.map((voice) => voice.id)).toEqual(["shefowl", "piotr"]);
    expect(voices[1]).toMatchObject({ locale: "pl-PL" });
  });

  it("cloning off leaves pocket with presets only", async () => {
    stubFetch({ [POCKET_VOICES_URL]: () => jsonResponse({ voices: [PIOTR], cloning: false }) });
    await reloadPocketVoices();
    expect(voicesOf("pocket")).toEqual(listVoices("pocket"));
    expect(voicesOf("pocket-pl").map((voice) => voice.id)).toEqual(["shefowl", "piotr"]);
  });

  it("with cloning off the pocket instance gets no custom voices, pocket-pl still does", async () => {
    stubFetch({ [POCKET_VOICES_URL]: () => jsonResponse({ voices: [PIOTR], cloning: false }) });
    await reloadPocketVoices();
    expect(currentPocketCustomVoices("pocket")).toEqual([]);
    expect(currentPocketCustomVoices("pocket-pl").map((voice) => voice.id)).toEqual(["piotr"]);
  });

  it("a failed list falls back to presets", async () => {
    stubFetch({ [POCKET_VOICES_URL]: () => jsonResponse({ error: "boom" }, { status: 500 }) });
    await expect(reloadPocketVoices()).resolves.toBeUndefined();
    expect(voicesOf("pocket")).toEqual(listVoices("pocket"));
    expect(voicesOf("pocket-pl")).toEqual(listVoices("pocket-pl"));

    stubFetch({ [POCKET_VOICES_URL]: () => Promise.reject(new Error("offline")) });
    await expect(reloadPocketVoices()).resolves.toBeUndefined();
    expect(voicesOf("pocket")).toEqual(listVoices("pocket"));
  });

  it("a workspace voice on pocket-pl is Polish", async () => {
    stubFetch({ [POCKET_VOICES_URL]: () => jsonResponse({ voices: [PIOTR], cloning: true }) });
    await reloadPocketVoices();
    expect(voiceLanguageFor("pocket-pl", "piotr")).toBe("pl");
    expect(voiceLanguageFor("pocket", "piotr")).toBe("en");
  });
});
