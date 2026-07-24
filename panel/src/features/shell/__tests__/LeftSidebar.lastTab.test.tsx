import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LeftSidebar from "../LeftSidebar";

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
        <LeftSidebar />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "vector" });
    expect(link).toHaveAttribute("href", "/project/vector");
  });
});
