/**
 * The per-project voice: `speech.voiceByProject` overrides the default voice
 * for one project, and `voiceForSession` resolves a cell's voice through the
 * project its session belongs to.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { preferences } from "../../../preferences/declarations";
import { storageKey } from "../../../preferences/types";
import { refreshSessions } from "../../terminal/sessionStore";
import type { SessionMeta } from "../../terminal/useTerminalSessions";
import {
  DEFAULT_SPEECH_VOICE,
  getProjectVoice,
  getStoredVoice,
  setProjectVoice,
  setStoredVoice,
  voiceForProject,
  voiceForSession,
} from "../voices";

type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

const VOICE_KEY = storageKey(preferences.speechVoice);
const BY_PROJECT_KEY = storageKey(preferences.speechVoiceByProject);

const VIVIENNE = "fr-FR-VivienneMultilingualNeural";
const ANDREW = "en-US-AndrewMultilingualNeural";
const EMMA = "en-US-EmmaMultilingualNeural";

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
});

describe("project voice", () => {
  it("the shipped default voice is Vivienne", () => {
    expect(DEFAULT_SPEECH_VOICE).toBe(VIVIENNE);
    expect(getStoredVoice()).toBe(VIVIENNE);
    expect(voiceForProject("p")).toBe(VIVIENNE);
  });

  it("an explicit default voice is kept", () => {
    globals.__PAVILIO_PREFS__![VOICE_KEY] = ANDREW;

    expect(getStoredVoice()).toBe(ANDREW);
    expect(voiceForProject("p")).toBe(ANDREW);
  });

  it("a project voice overrides the default for that project only", () => {
    setProjectVoice("p", EMMA);

    expect(getProjectVoice("p")).toBe(EMMA);
    expect(voiceForProject("p")).toBe(EMMA);
    expect(getProjectVoice("q")).toBeNull();
    expect(voiceForProject("q")).toBe(VIVIENNE);
    expect(voiceForProject(undefined)).toBe(VIVIENNE);
  });

  it("a stale project voice falls back to the default", () => {
    globals.__PAVILIO_PREFS__![BY_PROJECT_KEY] = { p: "pl-PL-MarekNeural" };

    expect(getProjectVoice("p")).toBeNull();
    expect(voiceForProject("p")).toBe(VIVIENNE);
  });

  it("clearing a project voice deletes its entry", () => {
    setProjectVoice("p", EMMA);
    setProjectVoice("q", ANDREW);
    setProjectVoice("p", null);

    expect(globals.__PAVILIO_PREFS__![BY_PROJECT_KEY]).toEqual({ q: ANDREW });
    expect(getProjectVoice("p")).toBeNull();
  });

  it("an unknown session gets the default voice", async () => {
    setProjectVoice("p", EMMA);
    await seedSessions([session("sess-p", "p")]);

    expect(voiceForSession("sess-p")).toBe(EMMA);
    expect(voiceForSession("sess-unknown")).toBe(VIVIENNE);
  });

  it("projects without an override follow a changed default", () => {
    setProjectVoice("p", EMMA);
    setStoredVoice(ANDREW);

    expect(voiceForProject("q")).toBe(ANDREW);
    expect(voiceForProject("p")).toBe(EMMA);
  });
});
