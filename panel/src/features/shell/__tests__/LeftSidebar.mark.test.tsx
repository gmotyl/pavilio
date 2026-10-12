import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { preferences } from "../../../preferences/declarations";
import { __resetPreferenceStoreForTests, writePreference } from "../../../preferences/store";
import { __resetProjectColorsForTests } from "../../terminal/useProjectColors";

vi.mock("../../speech/useSpeechHost", async () => {
  const { INERT_SPEECH_HOST } = await import("../../terminal/__tests__/speech.harness");
  const host = { ...INERT_SPEECH_HOST };
  return { useSpeechHost: () => host, default: () => host };
});
vi.mock("../../projects/useProjects", () => ({
  useProjects: () => [
    { name: "vector", repos: [] },
    { name: "atlas", repos: [] },
  ],
}));
vi.mock("../../projects/useArchivedProjects", () => ({
  useArchivedProjects: () => ({ archive: [], archivedNames: new Set() }),
}));
vi.mock("../../projects/useFavorites", () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: () => {}, favorites: [] }),
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

import LeftSidebar from "../LeftSidebar";
import { SpeechHostProvider } from "../../speech/SpeechHostProvider";

afterEach(() => {
  cleanup();
  __resetProjectColorsForTests();
  localStorage.clear();
  __resetPreferenceStoreForTests();
});

function setup() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <SpeechHostProvider>
        <LeftSidebar />
      </SpeechHostProvider>
    </MemoryRouter>,
  );
}

function row(name: string): HTMLElement {
  return screen.getByTestId(`sidebar-project-expand-${name}`).parentElement as HTMLElement;
}

describe("LeftSidebar project mark", () => {
  it("sidebar row leads with the project's mark tile", () => {
    writePreference(preferences.projectMark, "lucide:rocket", "vector");
    writePreference(preferences.projectColor, "#e06c75", "vector");
    setup();
    const r = row("vector");
    const tile = r.querySelector("[data-testid='project-mark']") as HTMLElement;
    expect(tile).toBeTruthy();
    expect(tile.getAttribute("data-color")).toBe("#e06c75");
    expect(tile.querySelector("[data-testid='project-mark-icon-rocket']")).toBeTruthy();
    // Leads: before the project name link.
    const link = screen.getByRole("link", { name: "vector" });
    expect(tile.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sidebar row without a mark shows the folder in the project colour", () => {
    writePreference(preferences.projectColor, "#98c379", "atlas");
    setup();
    const tile = row("atlas").querySelector("[data-testid='project-mark']") as HTMLElement;
    expect(tile.getAttribute("data-color")).toBe("#98c379");
    expect(tile.querySelector("[data-testid='project-mark-icon-folder']")).toBeTruthy();
  });
});
