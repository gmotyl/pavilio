import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The unresolved-scope rule, at the one call site that read a preference
 * without it.
 *
 * `storageKey` THROWS on a blank or whitespace scope — deliberately, so a
 * missing project cannot key every project onto the same `key@`. The sidebar's
 * hydration effect reads `shell.project.expanded` per project inside a
 * `setExpandedState` updater, so a project whose name has not resolved would
 * turn that throw into an unhandled render error. The pre-migration code
 * answered `false` and carried on.
 */
vi.mock("../../speech/useSpeechHost", async () => {
  const { INERT_SPEECH_HOST } = await import(
    "../../terminal/__tests__/speech.harness"
  );
  return {
    useSpeechHost: () => INERT_SPEECH_HOST,
    default: () => INERT_SPEECH_HOST,
  };
});

import LeftSidebar from "../LeftSidebar";
import { SpeechHostProvider } from "../../speech/SpeechHostProvider";

vi.mock("../../projects/useProjects", () => ({
  // A blank name is what a project list mid-resolution looks like; the sidebar
  // renders whatever `useProjects` hands it.
  useProjects: () => [{ name: "   ", repos: [] }, { name: "vector", repos: [] }],
}));
vi.mock("../../projects/useArchivedProjects", () => ({
  useArchivedProjects: () => ({ archive: [], archivedNames: new Set() }),
}));
vi.mock("../../projects/useFavorites", () => ({
  useFavorites: () => ({
    isFavorite: () => false,
    toggleFavorite: () => {},
    favorites: [],
  }),
}));
vi.mock("../../terminal/useAllTerminalSessions", () => ({
  useAllTerminalSessions: () => ({ sessions: [], refresh: () => {} }),
}));
vi.mock("../../mobile-access/useMobileAccessStatus", () => ({
  useMobileAccessStatus: () => ({ enabled: false }),
}));
vi.mock("../../auto-sync/useAutoSyncStatus", () => ({
  useAutoSyncStatus: () => ({ status: null }),
}));
vi.mock("../../git/useGitStatus", () => ({
  useGitStatus: () => ({ files: [], suggestion: "", refetch: () => {} }),
}));

describe("LeftSidebar with an unresolved project name", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("renders rather than throwing, and writes nothing for the blank scope", () => {
    const doc = (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> })
      .__PAVILIO_PREFS__!;

    expect(() =>
      render(
        <MemoryRouter initialEntries={["/"]}>
          <SpeechHostProvider>
            <LeftSidebar />
          </SpeechHostProvider>
        </MemoryRouter>,
      ),
    ).not.toThrow();

    expect(screen.getByRole("link", { name: "vector" })).toBeInTheDocument();
    // The blank scope produced no key at all — not `shell.project.expanded@`,
    // and not a bare `shell.project.expanded`.
    expect(Object.keys(doc).filter((k) => k.startsWith("shell.project.expanded"))).toEqual([]);
  });
});
