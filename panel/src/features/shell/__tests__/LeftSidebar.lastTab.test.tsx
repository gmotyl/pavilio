import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The sidebar reads the speech host, so it needs a real `SpeechHostProvider`
 * above it. Only the host is stubbed — an inert one, since this suite's subject
 * is the project link, not speech.
 */
vi.mock("../../speech/useSpeechHost", async () => {
  const { INERT_SPEECH } = await import(
    "../../terminal/__tests__/speech.harness"
  );
  const host = {
    ...INERT_SPEECH,
    speakingSessionId: null,
    pausedSessionId: null,
    onSeekBackward: () => {},
    preparingSessionIds: new Set<string>(),
  };
  return { useSpeechHost: () => host, default: () => host };
});

import LeftSidebar from "../LeftSidebar";
import { SpeechHostProvider } from "../../speech/SpeechHostProvider";

vi.mock("../../projects/useProjects", () => ({
  useProjects: () => [{ name: "vector", repos: [] }],
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

describe("LeftSidebar project link", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("links the project name to the bare /project/:name route (not /iterm)", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <SpeechHostProvider>
          <LeftSidebar />
        </SpeechHostProvider>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "vector" });
    expect(link).toHaveAttribute("href", "/project/vector");
  });
});
