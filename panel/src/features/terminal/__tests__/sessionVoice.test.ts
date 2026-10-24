/**
 * `voiceForSession` resolves a cell's voice through the project its session
 * belongs to; a session the tab cannot place speaks with the default voice.
 * A page's `doc:<projects-relative path>` key resolves through the project its
 * path starts with.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { setProjectVoice } from "../../speech/voices";
import { refreshSessions } from "../sessionStore";
import { voiceForSession } from "../sessionVoice";
import type { SessionMeta } from "../useTerminalSessions";

const VIVIENNE = "fr-FR-VivienneMultilingualNeural";
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
});
