import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import type { SessionMeta } from "../../terminal/useTerminalSessions";
import type { CellSpeechState } from "../../speech/types";

/**
 * The sidebar now reads the speech host, so every render here needs a real
 * `SpeechHostProvider` above it. The HOST is stubbed rather than
 * `usePanelSpeech`: mounting the real provider is what keeps these tests honest
 * about the sidebar being inside one, which is the guarantee `SessionIndicator`
 * leans on when it throws instead of reporting silence.
 */
const speech = vi.hoisted(() => ({
  stateFor: (_sessionId: string) => "empty" as CellSpeechState,
}));

vi.mock("../../speech/useSpeechHost", async () => {
  const { INERT_SPEECH_HOST } = await import(
    "../../terminal/__tests__/speech.harness"
  );
  const host = {
    ...INERT_SPEECH_HOST,
    // Read through the holder so a test can swap the state before it renders.
    stateFor: (sessionId: string) => speech.stateFor(sessionId),
  };
  return { useSpeechHost: () => host, default: () => host };
});

import LeftSidebar from "../LeftSidebar";
import ProjectRedirect from "../../projects/ProjectRedirect";
import { SpeechHostProvider } from "../../speech/SpeechHostProvider";
import {
  _applyEventForTests,
  _resetForTests,
} from "../../terminal/useTerminalActivityChannel";

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
      <SpeechHostProvider>
        <LeftSidebar />
      </SpeechHostProvider>
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

/**
 * File-level, not per-describe: the activity channel and the stubbed speech
 * state are module singletons, so a test that sets either leaks into every
 * later test in the file. Resetting inside the speech describe alone was safe
 * only because that block happens to be last — a describe added below it would
 * have inherited a `speaking` session it never asked for.
 */
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  _resetForTests();
  speech.stateFor = () => "empty";
});

describe("LeftSidebar terminal-session row navigation", () => {
  beforeEach(() => {
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

describe("LeftSidebar terminal-session row highlight", () => {

  it("keeps the clicked session highlighted when the bare-route redirect lands back on the same iterm view", async () => {
    // Already reading this project's terminals; the row click bounces through
    // the bare project route and comes straight back here.
    sessionStorage.setItem("panel:lastPath:vector", "/project/vector/iterm");
    setup("/project/vector/iterm");
    expandAndClickSession();
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(
        "/project/vector/iterm",
      );
    });
    expect(screen.getByTestId("sidebar-session-s1").style.background).toBe(
      "var(--bg-active)",
    );
  });

  it("highlights the stored session when arriving on an iterm view without a focus broadcast", async () => {
    localStorage.setItem("panel-terminal-focus-vector", "s1");
    setup("/project/vector/iterm");
    fireEvent.click(screen.getByTestId("sidebar-project-expand-vector"));
    expect(screen.getByTestId("sidebar-session-s1").style.background).toBe(
      "var(--bg-active)",
    );
  });

  it("highlights nothing while a non-terminal section of the project is open", () => {
    localStorage.setItem("panel-terminal-focus-vector", "s1");
    setup("/project/vector/memo");
    fireEvent.click(screen.getByTestId("sidebar-project-expand-vector"));
    expect(screen.getByTestId("sidebar-session-s1").style.background).toBe(
      "transparent",
    );
  });
});

/** Publishes a terminal-activity event the way the server's stream would. */
const setActivity = (
  sessionId: string,
  state: "idle" | "busy" | "attention",
) =>
  _applyEventForTests({
    sessionId,
    state,
    at: 1,
    attentionSinceAt: state === "attention" ? 1 : undefined,
  });

/** The project row is the flex box the expand chevron sits in. */
const projectRow = () =>
  screen.getByTestId("sidebar-project-expand-vector").parentElement!;

describe("LeftSidebar speech indicator", () => {

  it("a speaking session row shows the speaker", () => {
    setActivity("s1", "busy");
    speech.stateFor = (id) => (id === "s1" ? "speaking" : "empty");

    setup();
    fireEvent.click(screen.getByTestId("sidebar-project-expand-vector"));

    const row = screen.getByTestId("sidebar-session-s1");
    expect(within(row).getByTestId("session-speaker-s1")).toBeInTheDocument();
    expect(row.querySelector(".terminal-led")).toBeNull();
  });

  it("quiet rows keep the activity LED", () => {
    setActivity("s1", "busy");

    setup();

    // Collapsed project row: the aggregate dot, unchanged.
    expect(
      projectRow().querySelector('.terminal-led[data-state="busy"]'),
    ).not.toBeNull();
    expect(screen.queryByTestId("session-speaker-s1")).toBeNull();

    fireEvent.click(screen.getByTestId("sidebar-project-expand-vector"));

    const row = screen.getByTestId("sidebar-session-s1");
    expect(
      row.querySelector('.terminal-led[data-state="busy"]'),
    ).not.toBeNull();
    expect(within(row).queryByTestId("session-speaker-s1")).toBeNull();
  });

  it("the collapsed row keeps its dots while a session speaks", () => {
    setActivity("s1", "busy");
    speech.stateFor = (id) => (id === "s1" ? "speaking" : "empty");

    setup();

    // The speaker joins the aggregate group as one more status; the busy dot
    // (and, for another session, the attention dot) stays put, so the row
    // never trades a pending signal for the audio it is playing.
    expect(
      within(projectRow()).getByTestId("session-speaker-s1"),
    ).toBeInTheDocument();
    expect(
      projectRow().querySelector('.terminal-led[data-state="busy"]'),
    ).not.toBeNull();
  });
});
