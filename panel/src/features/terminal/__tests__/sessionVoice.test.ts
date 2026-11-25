/**
 * `voiceForSession` resolves a cell's voice through the project its session
 * belongs to; a session the tab cannot place speaks with the default voice.
 * A page's `doc:<projects-relative path>` key resolves through the project its
 * path starts with.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { preferences } from "../../../preferences/declarations";
import { readPreference, writePreference } from "../../../preferences/store";
import { jsonResponse, stubFetch } from "../../../test-utils";
import { __resetOpenaiVoicesForTests, reloadOpenaiVoices } from "../../speech/useOpenaiVoices";
import type { OmniVoiceInfo } from "../../speech/openaiVoices";
import {
  setCascadeOrder,
  setEngineVoice,
  setProjectEngineVoice,
  setProjectVoice,
  setStoredEngine,
} from "../../speech/voices";
import {
  EN_MALE,
  LIVE_VOICES,
  OPENAI_VOICES_URL,
  PL_FEMALE,
  voicesBody,
} from "../../speech/__tests__/openaiVoiceFixtures";
import { refreshSessions } from "../sessionStore";
import { languageForSession, useVoiceForSession, voiceForSession } from "../sessionVoice";
import type { SessionMeta } from "../useTerminalSessions";

const VIVIENNE = "fr-FR-VivienneMultilingualNeural";
const EMMA = "en-US-EmmaMultilingualNeural";
const MAREK = "pl-PL-MarekNeural";

/** The twin OmniVoice voices: one speaker, one record per language. */
const BILL_EN: OmniVoiceInfo = { ...EN_MALE, id: "bill-en", label: "Bill (English)", source: "custom" };
const BILL_PL: OmniVoiceInfo = { ...PL_FEMALE, id: "bill-pl", label: "Bill (Polish)", source: "custom" };

/** Loads the live OmniVoice list, so the openai picks below are catalog voices. */
async function loadLiveVoices(voices: readonly OmniVoiceInfo[] = [BILL_EN, BILL_PL]): Promise<void> {
  stubFetch({ [OPENAI_VOICES_URL]: () => jsonResponse(voicesBody(voices)) });
  await reloadOpenaiVoices();
}

function session(id: string, project: string): SessionMeta {
  return {
    id,
    name: id,
    project,
    cwd: `/srv/git/${project}`,
    pid: 4242,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Loads a session list through the store's own fetch, as the panel does. */
async function seedSessions(sessions: SessionMeta[]): Promise<void> {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(sessions),
        }) as unknown as Promise<Response>,
    ),
  );
  await refreshSessions();
}

afterEach(() => {
  vi.unstubAllGlobals();
  __resetOpenaiVoicesForTests();
});

describe("session voice", () => {
  it("a session's voice is its project's, else the default", async () => {
    setProjectVoice("p", EMMA);
    await seedSessions([session("sess-p", "p")]);

    expect(voiceForSession("sess-p")).toBe(EMMA);
    expect(voiceForSession("sess-unknown")).toBe(VIVIENNE);
  });

  it("doc key uses its project's voice", () => {
    setProjectVoice("pavilio", EMMA);

    expect(voiceForSession("doc:pavilio/wiki/index.md")).toBe(EMMA);
  });

  it("doc key without override or project falls back to the default", () => {
    expect(voiceForSession("doc:quiet/wiki/index.md")).toBe(VIVIENNE);
    expect(voiceForSession("doc:AGENTS.md")).toBe(VIVIENNE);
  });

  it("a doc key outside projects falls back to the default", () => {
    // `..` is a path step, not a project: an override filed under it must not
    // reach a file that lives beside the projects directory.
    setProjectVoice("..", EMMA);

    expect(voiceForSession("doc:../repo/x.md")).toBe(VIVIENNE);
  });

  it("terminal session voice is unchanged", async () => {
    setProjectVoice("t", EMMA);
    await seedSessions([session("sess-t", "t")]);

    expect(voiceForSession("sess-t")).toBe(EMMA);
    expect(voiceForSession("doc-sess")).toBe(VIVIENNE);
  });

  it("a render-time reader re-reads the saved openai voice once the live list lands", async () => {
    writePreference(preferences.speechEngine, "openai");
    writePreference(preferences.speechVoice, { openai: PL_FEMALE.id });
    stubFetch({ [OPENAI_VOICES_URL]: () => jsonResponse(voicesBody(LIVE_VOICES)) });

    const { result } = renderHook(() => useVoiceForSession("sess-reload"));
    // Before the list lands the saved voice cannot be checked, but reading it loses nothing.
    expect(readPreference(preferences.speechVoice)).toEqual({ openai: PL_FEMALE.id });

    await act(() => reloadOpenaiVoices());
    expect(result.current).toBe(PL_FEMALE.id);
    expect(readPreference(preferences.speechVoice)).toEqual({ openai: PL_FEMALE.id });
  });
});

describe("session language", () => {
  it("single engine: the project's voice decides", async () => {
    await loadLiveVoices();
    setStoredEngine("openai");
    setEngineVoice("openai", "bill-en");
    setProjectEngineVoice("p", "openai", "bill-pl");
    await seedSessions([session("sess-p", "p"), session("sess-q", "q")]);

    expect(languageForSession("sess-p")).toBe("pl");
    expect(languageForSession("sess-q")).toBe("en");
  });

  it("cascade: the first enabled member's voice decides", async () => {
    await loadLiveVoices();
    setStoredEngine("cascade");
    setProjectEngineVoice("p", "openai", "bill-en");
    setProjectEngineVoice("p", "edge", MAREK);
    await seedSessions([session("sess-p", "p")]);

    expect(languageForSession("sess-p")).toBe("en");
  });

  it("cascade: a disabled first member is skipped", async () => {
    await loadLiveVoices();
    setStoredEngine("cascade");
    setCascadeOrder([
      { id: "openai", on: false },
      { id: "edge", on: true },
    ]);
    setProjectEngineVoice("p", "openai", "bill-en");
    setProjectEngineVoice("p", "edge", MAREK);
    await seedSessions([session("sess-p", "p")]);

    expect(languageForSession("sess-p")).toBe("pl");
  });

  it("cascade: no enabled member with a voice gives English", async () => {
    // No live OmniVoice list: openai has no voice, and every other member is off.
    setStoredEngine("cascade");
    setCascadeOrder([
      { id: "openai", on: true },
      { id: "kokoro", on: false },
      { id: "elevenlabs", on: false },
      { id: "cartesia", on: false },
      { id: "speechify", on: false },
      { id: "azure", on: false },
      { id: "edge", on: false },
    ]);
    setProjectEngineVoice("p", "edge", MAREK);
    await seedSessions([session("sess-p", "p")]);

    expect(languageForSession("sess-p")).toBe("en");
  });

  it("a page key follows its project's voice", async () => {
    await loadLiveVoices();
    setStoredEngine("openai");
    setEngineVoice("openai", "bill-en");
    setProjectEngineVoice("pavilio", "openai", "bill-pl");
    setProjectEngineVoice("..", "openai", "bill-pl");

    expect(languageForSession("doc:pavilio/wiki/index.md")).toBe("pl");
    expect(languageForSession("doc:quiet/wiki/index.md")).toBe("en");
    // A file outside projects speaks with the default voice.
    expect(languageForSession("doc:../repo/x.md")).toBe("en");
  });
});
