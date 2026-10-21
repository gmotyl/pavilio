/**
 * The modules every `LeftSidebar` render needs stubbed, as `vi.mock` factories.
 *
 * `vi.mock` is hoisted, so this module cannot call it for its importers. Each
 * test file keeps one line per module and hands it the factory from here:
 *
 *   vi.mock("../../projects/useArchivedProjects", () =>
 *     import("./leftSidebar.harness").then((m) => m.mockShellDeps.useArchivedProjects()),
 *   );
 *
 * The ones a file has an opinion about (`useProjects`, `useAllTerminalSessions`,
 * the speech host's `stateFor`) take a getter, read on every call, so a file
 * can keep the value in a `vi.hoisted` box and swap it per test. Holds no
 * `describe`/`it`.
 */
import type { CellSpeechState } from "../../speech/types";
import type { SessionMeta } from "../../terminal/useTerminalSessions";

type Project = { name: string; repos: unknown[] };

export const mockShellDeps = {
  useProjects: (projects: () => Project[]) => ({
    useProjects: () => projects(),
  }),
  useAllTerminalSessions: (sessions: () => SessionMeta[] = () => []) => ({
    useAllTerminalSessions: () => ({ sessions: sessions(), refresh: () => {} }),
  }),
  useArchivedProjects: () => ({
    useArchivedProjects: () => ({ archive: [], archivedNames: new Set() }),
  }),
  useFavorites: () => ({
    useFavorites: () => ({
      isFavorite: () => false,
      toggleFavorite: () => {},
      favorites: [],
    }),
  }),
  useMobileAccessStatus: () => ({
    useMobileAccessStatus: () => ({ enabled: false }),
  }),
  useAutoSyncStatus: () => ({
    useAutoSyncStatus: () => ({ status: null }),
  }),
  useGitStatus: () => ({
    useGitStatus: () => ({ files: [], refetch: () => {} }),
  }),
  /**
   * The sidebar reads the speech host, so every render needs a real
   * `SpeechHostProvider` above it; only the HOST is stubbed — inert, unless a
   * `stateFor` is given, which is read through on every call.
   */
  useSpeechHost: async (stateFor?: (sessionId: string) => CellSpeechState) => {
    const { INERT_SPEECH_HOST } = await import("../../terminal/__tests__/speech.harness");
    const host = stateFor
      ? { ...INERT_SPEECH_HOST, stateFor: (sessionId: string) => stateFor(sessionId) }
      : INERT_SPEECH_HOST;
    return { useSpeechHost: () => host, default: () => host };
  },
};
