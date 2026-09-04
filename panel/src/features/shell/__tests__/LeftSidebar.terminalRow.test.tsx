import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import LeftSidebar from "../LeftSidebar";
import ProjectRedirect from "../../projects/ProjectRedirect";
import type { SessionMeta } from "../../terminal/useTerminalSessions";

// One terminal session for project "vector", matching the sibling
// LeftSidebar.lastTab.test.tsx's mocked project.
const sessions: SessionMeta[] = [
  {
    id: "s1",
    project: "vector",
    name: "shell-1",
    cwd: "/repo/vector",
    pid: 4242,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

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
  useAllTerminalSessions: () => ({ sessions, refresh: () => {} }),
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

const createTerminalSession = vi.fn();
vi.mock("../../terminal/createTerminalSession", () => ({
  createTerminalSession: (...args: unknown[]) => createTerminalSession(...args),
}));

// Reads the router's current location so tests can assert on where a click
// navigated to, mirroring the Probe idiom in useTerminalDrawer.test.tsx.
function LocationProbe() {
  const location = useLocation();
  return (
    <span data-testid="location">
      {location.pathname}
      {location.search}
    </span>
  );
}

function setup(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LeftSidebar />
      {/* Mount the real ProjectRedirect at the bare project route, the same
          way App.tsx does, so a navigate to the bare route resolves through
          the Last-open-view bookmark exactly as it does in the real app. */}
      <Routes>
        <Route
          path="/project/:name"
          element={<ProjectRedirect fallback={<div data-testid="project-fallback" />} />}
        />
        <Route path="*" element={null} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

function expandAndClickSession() {
  fireEvent.click(screen.getByTestId("sidebar-project-expand-vector"));
  fireEvent.click(screen.getByTestId("sidebar-session-s1"));
}

describe("LeftSidebar terminal-session row navigation", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    createTerminalSession.mockReset();
  });

  it("clicking a terminal-session row navigates to the project's last-open path instead of forcing iterm", () => {
    sessionStorage.setItem(
      "panel:lastPath:vector",
      "/project/vector/memo?file=x",
    );
    setup();
    expandAndClickSession();
    // Exact-match on textContent — toHaveTextContent does a substring match,
    // which would let "/project/vector/iterm" falsely satisfy an assertion
    // of "/project/vector".
    expect(screen.getByTestId("location").textContent).toBe(
      "/project/vector/memo?file=x",
    );
  });

  it("clicking a terminal-session row falls back to the bare project route when no last-open path is stored", () => {
    setup();
    expandAndClickSession();
    expect(screen.getByTestId("location").textContent).toBe(
      "/project/vector",
    );
  });

  it("clicking a terminal-session row still marks that session focused in localStorage", () => {
    setup();
    expandAndClickSession();
    expect(localStorage.getItem("panel-terminal-focus-vector")).toBe("s1");
  });

  it("the + new-terminal button still navigates straight to iterm (unchanged)", async () => {
    createTerminalSession.mockResolvedValue({
      id: "new1",
      project: "vector",
      name: "vector-2",
      cwd: "/repo/vector",
      pid: 9999,
      createdAt: "2026-01-01T00:00:00.000Z",
    } satisfies SessionMeta);
    setup();
    fireEvent.click(
      screen.getByTestId("sidebar-project-create-terminal-vector"),
    );
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(
        "/project/vector/iterm",
      );
    });
  });
});
