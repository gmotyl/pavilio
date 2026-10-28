/**
 * The cascade engine's preferences: one voice per engine (globally and per
 * project), the cascade order and per-engine pronunciation — and how the old
 * single-voice values read under the new shape.
 */
import { describe, expect, it } from "vitest";
import { listVoices } from "anytts";

import ttsHolderSource from "../../../../server/lib/speech/ttsHolder.ts?raw";
import { preferences } from "../../../preferences/declarations";
import { readPreference } from "../../../preferences/store";
import { storageKey } from "../../../preferences/types";
import {
  DEFAULT_SPEECH_VOICE,
  catalogDefaultVoice,
  getCascadeOrder,
  getPronunciationByEngine,
  getProjectVoices,
  getStoredVoices,
  resolveStoredVoice,
  setEngineVoice,
  setProjectEngineVoice,
  setStoredEngine,
  voiceFor,
  voiceForDocKey,
  voiceForProject,
} from "../voices";
import { cascadeVoicesOf } from "../engines";

type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

const VOICE_KEY = storageKey(preferences.speechVoice);
const BY_PROJECT_KEY = storageKey(preferences.speechVoiceByProject);

const ANDREW = "en-US-AndrewMultilingualNeural";
const EMMA = "en-US-EmmaMultilingualNeural";
const [GEORGE, SARAH, BRIAN] = listVoices("elevenlabs").map((voice) => voice.id);

describe("per-engine voices and cascade preferences", () => {
  it("old single voices migrate to edge", () => {
    globals.__PAVILIO_PREFS__![VOICE_KEY] = ANDREW;
    globals.__PAVILIO_PREFS__![BY_PROJECT_KEY] = { p: EMMA, q: { elevenlabs: GEORGE } };

    expect(readPreference(preferences.speechVoice)).toEqual({ edge: ANDREW });
    expect(readPreference(preferences.speechVoiceByProject)).toEqual({
      p: { edge: EMMA },
      q: { elevenlabs: GEORGE },
    });
    expect(getStoredVoices()).toEqual({ edge: ANDREW });
    expect(getProjectVoices("p")).toEqual({ edge: EMMA });
    expect(voiceForProject("p")).toBe(EMMA);
    expect(voiceForProject("r")).toBe(ANDREW);

    // The first write stores the new shape; the old string is not kept.
    setEngineVoice("edge", EMMA);
    expect(globals.__PAVILIO_PREFS__![VOICE_KEY]).toEqual({ edge: EMMA });
  });

  it("project voice per engine wins over the default", () => {
    setEngineVoice("edge", ANDREW);
    setEngineVoice("elevenlabs", GEORGE);
    setProjectEngineVoice("p", "elevenlabs", SARAH);

    expect(globals.__PAVILIO_PREFS__![VOICE_KEY]).toEqual({ edge: ANDREW, elevenlabs: GEORGE });
    expect(globals.__PAVILIO_PREFS__![BY_PROJECT_KEY]).toEqual({ p: { elevenlabs: SARAH } });

    expect(voiceFor("elevenlabs", "p")).toBe(SARAH);
    expect(voiceFor("elevenlabs", "q")).toBe(GEORGE);
    expect(voiceFor("elevenlabs")).toBe(GEORGE);
    // The project chose an ElevenLabs voice only: Edge follows the default.
    expect(voiceFor("edge", "p")).toBe(ANDREW);

    // Per engine, per project: setting one engine leaves the other alone, and
    // clearing the last engine deletes the project's entry.
    setProjectEngineVoice("p", "edge", EMMA);
    expect(voiceFor("edge", "p")).toBe(EMMA);
    expect(voiceFor("elevenlabs", "p")).toBe(SARAH);
    setProjectEngineVoice("p", "elevenlabs", null);
    setProjectEngineVoice("p", "edge", null);
    expect(globals.__PAVILIO_PREFS__![BY_PROJECT_KEY]).toEqual({});

    // A voice of another engine's catalog is not a voice of this one.
    setEngineVoice("elevenlabs", ANDREW);
    setProjectEngineVoice("q", "elevenlabs", EMMA);
    expect(voiceFor("elevenlabs", "q")).toBe(GEORGE);
    expect(getProjectVoices("q")).toEqual({});
  });

  it("a stale voice falls back to the catalog default", () => {
    globals.__PAVILIO_PREFS__![VOICE_KEY] = { edge: "xx-XX-NobodyNeural", elevenlabs: BRIAN };
    globals.__PAVILIO_PREFS__![BY_PROJECT_KEY] = {
      p: { edge: "xx-XX-NobodyNeural", elevenlabs: "not-a-voice" },
    };

    // Stale ids are dropped on the way out.
    expect(getStoredVoices()).toEqual({ elevenlabs: BRIAN });
    expect(getProjectVoices("p")).toEqual({});

    expect(catalogDefaultVoice("edge")).toBe(DEFAULT_SPEECH_VOICE);
    expect(voiceFor("edge")).toBe(DEFAULT_SPEECH_VOICE);
    expect(voiceFor("edge", "p")).toBe(DEFAULT_SPEECH_VOICE);
    // A stale project voice falls through to the engine's default voice, not the catalog's.
    expect(voiceFor("elevenlabs", "p")).toBe(BRIAN);
    // `cascade` has no voices of its own.
    expect(catalogDefaultVoice("cascade")).toBeUndefined();
    expect(voiceFor("cascade")).toBeUndefined();
  });

  it("cascade order defaults to all engines on", () => {
    expect(getCascadeOrder()).toEqual([
      { id: "elevenlabs", on: true },
      { id: "cartesia", on: true },
      { id: "speechify", on: true },
      { id: "azure", on: true },
      { id: "edge", on: true },
    ]);
    // The server's default order, which the client cannot import: kept equal by hand.
    const server = /CASCADE_ORDER\s*=\s*(\[[^\]]*\])/.exec(ttsHolderSource);
    expect(server, "CASCADE_ORDER in ttsHolder.ts").not.toBeNull();
    expect(getCascadeOrder().map((entry) => entry.id)).toEqual(JSON.parse(server![1]!));

    // Nothing written: anytts' own pronunciation defaults apply.
    expect(getPronunciationByEngine()).toEqual({});

    for (const def of [
      preferences.speechVoice,
      preferences.speechVoiceByProject,
      preferences.speechCascadeOrder,
      preferences.speechPronunciationByEngine,
    ]) {
      expect({ key: def.key, portable: def.portable, scope: def.scope }).toEqual({
        key: def.key,
        portable: true,
        scope: "global",
      });
    }
    expect(preferences.speechCascadeOrder.key).toBe("speech.cascadeOrder");
    expect(preferences.speechPronunciationByEngine.key).toBe("speech.pronunciationByEngine");
  });

  it("cascade as the engine resolves no single voice", () => {
    // anytts throws asking `cascade` for a voice: every reader must stay clear of it.
    setEngineVoice("edge", ANDREW);
    setEngineVoice("elevenlabs", GEORGE);
    expect(setStoredEngine("cascade")).toBe("cascade");
    const before = readPreference(preferences.speechVoice);

    expect(resolveStoredVoice(before)).toEqual({ voice: "", fellBack: false });
    expect(readPreference(preferences.speechVoice)).toEqual(before);
    expect(catalogDefaultVoice("cascade")).toBeUndefined();

    // The session's voice is the members' voices, as one key the seam opens.
    setProjectEngineVoice("p", "elevenlabs", SARAH);
    const voices = cascadeVoicesOf(voiceForProject("p"));
    expect(voices).toMatchObject({ elevenlabs: SARAH, edge: ANDREW });
    expect(Object.keys(voices ?? {}).sort()).toEqual(["azure", "cartesia", "edge", "elevenlabs", "speechify"]);
    expect(cascadeVoicesOf(voiceForProject(undefined))).toMatchObject({ elevenlabs: GEORGE });
    expect(voiceForDocKey("doc:p/notes.md")).toBe(voiceForProject("p"));
  });
});
