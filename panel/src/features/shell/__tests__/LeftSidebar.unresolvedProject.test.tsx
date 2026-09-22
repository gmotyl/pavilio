import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The same unresolved-scope rule as `LeftSidebar.blankProject.test.tsx`, one
 * step further out: a name that is `undefined` at runtime rather than blank.
 *
 * `LeftSidebar` guarded both of its scope sites with a bare `.trim()`, which
 * throws a TypeError on `undefined` — during render in the hydration effect's
 * `setExpandedState` updater, and inside the click handler on the way out.
 * TypeScript types both as `string`, so only a test says otherwise. The rest
 * of this change spells the guard `typeof x === "string" && x.trim() !== ""`;
 * these two sites are the last to be brought into line.
 *
 * A separate file rather than a second case in `blankProject`, because
 * `useProjects` is mocked at module scope and each file pins one shape of
 * unresolved name.
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
  // `undefined` is what a route param that never resolved looks like once it
  // has been through a `name ?? ""` chain the compiler believes.
  useProjects: () => [
    { name: undefined as unknown as string, repos: [] },
    { name: "vector", repos: [] },
  ],
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

function prefsDoc(): Record<string, unknown> {
  return (
    (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> })
      .__PAVILIO_PREFS__ ?? {}
  );
}

function expandedKeys(): string[] {
  return Object.keys(prefsDoc()).filter((k) =>
    k.startsWith("shell.project.expanded"),
  );
}

describe("LeftSidebar with an undefined project name", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    // React's list-key warning: `key={project.name}` is `undefined` for the
    // fixture above. Expected, and not what these tests are about.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mount(): void {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <SpeechHostProvider>
          <LeftSidebar />
        </SpeechHostProvider>
      </MemoryRouter>,
    );
  }

  it("hydrates rather than throwing, and writes nothing for the undefined scope", () => {
    // The READ site: the hydration effect's `setExpandedState` updater.
    expect(() => mount()).not.toThrow();

    expect(screen.getByRole("link", { name: "vector" })).toBeInTheDocument();
    expect(expandedKeys()).toEqual([]);
  });

  it("toggling the undefined project's row writes nothing and does not throw", () => {
    // The WRITE site: `setExpanded`, reached from the row's chevron.
    mount();

    const toggle = screen.getByTestId("sidebar-project-expand-undefined");
    expect(() => fireEvent.click(toggle)).not.toThrow();

    expect(expandedKeys()).toEqual([]);
  });
});
