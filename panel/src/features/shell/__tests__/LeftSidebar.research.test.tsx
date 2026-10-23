import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SessionMeta } from "../../terminal/useTerminalSessions";
import type { ProjectKind } from "../../../../server/lib/projects/kind";

/**
 * The Research section: rows split by kind, the collapsible header with its
 * count, the kind marks, and the age / dimming / archive rules of a research
 * row. Mockup: projects/pavilio/mockups/2026-10-20-research-sidebar-options.html
 * (option A).
 */

type Row = {
  name: string;
  repos: unknown[];
  kind: ProjectKind;
  lastActivity: string | null;
};

const shell = vi.hoisted(() => ({
  projects: (): Row[] => [],
  sessions: (): SessionMeta[] => [],
  favorites: new Set<string>(),
}));

vi.mock("../../speech/useSpeechHost", () =>
  import("./leftSidebar.harness").then((m) => m.mockShellDeps.useSpeechHost()),
);
vi.mock("../../projects/useProjects", () =>
  import("./leftSidebar.harness").then((m) => m.mockShellDeps.useProjects(() => shell.projects())),
);
vi.mock("../../terminal/useAllTerminalSessions", () =>
  import("./leftSidebar.harness").then((m) =>
    m.mockShellDeps.useAllTerminalSessions(() => shell.sessions()),
  ),
);
vi.mock("../../projects/useArchivedProjects", () =>
  import("./leftSidebar.harness").then((m) => m.mockShellDeps.useArchivedProjects()),
);
// Starred rows matter here, so favourites are this file's own: a set the
// tests fill, read on every call.
vi.mock("../../projects/useFavorites", () => ({
  useFavorites: () => ({
    isFavorite: (name: string) => shell.favorites.has(name),
    toggle: () => {},
    favorites: [...shell.favorites],
  }),
}));
vi.mock("../../mobile-access/useMobileAccessStatus", () =>
  import("./leftSidebar.harness").then((m) => m.mockShellDeps.useMobileAccessStatus()),
);
vi.mock("../../auto-sync/useAutoSyncStatus", () =>
  import("./leftSidebar.harness").then((m) => m.mockShellDeps.useAutoSyncStatus()),
);
vi.mock("../../git/useGitStatus", () =>
  import("./leftSidebar.harness").then((m) => m.mockShellDeps.useGitStatus()),
);
vi.mock("../../terminal/createTerminalSession", () => ({
  createTerminalSession: vi.fn(),
}));

import LeftSidebar from "../LeftSidebar";
import { TerminalSpeechHost } from "../../terminal/TerminalSpeechHost";
import { preferences } from "../../../preferences/declarations";
import { __resetPreferenceStoreForTests, readPreference } from "../../../preferences/store";

// "Today" is pinned so the ages below are exact: 2026-10-20 is 3 days ago,
// 2026-09-12 is 41.
const TODAY = new Date(2026, 9, 23, 12, 0, 0);

const ROWS: Row[] = [
  { name: "vector", repos: [], kind: "project", lastActivity: "2026-10-22" },
  { name: "voice-cloning", repos: [], kind: "research", lastActivity: "2026-09-12" },
  { name: "undated", repos: [], kind: "research", lastActivity: null },
  { name: "atlas", repos: [], kind: "project", lastActivity: null },
  { name: "edge-tts", repos: [], kind: "research", lastActivity: "2026-10-20" },
  { name: "knowledge", repos: [], kind: "knowledge", lastActivity: "2026-10-01" },
];

function session(id: string, project: string): SessionMeta {
  return {
    id,
    project,
    name: `${project}-1`,
    cwd: `/repo/${project}`,
    pid: 1,
    createdAt: "2026-10-23T00:00:00.000Z",
  };
}

function setup() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <TerminalSpeechHost>
        <LeftSidebar />
      </TerminalSpeechHost>
    </MemoryRouter>,
  );
}

const section = (name: string) => screen.getByTestId(`sidebar-section-${name}`);
const row = (name: string) => screen.getByTestId(`sidebar-project-row-${name}`);
/** Project names in a section, in render order. */
const namesIn = (el: HTMLElement) =>
  within(el)
    .queryAllByTestId(/^sidebar-project-row-/)
    .map((r) => r.getAttribute("data-testid")!.replace("sidebar-project-row-", ""));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TODAY);
  __resetPreferenceStoreForTests();
  shell.projects = () => ROWS;
  shell.sessions = () => [];
  shell.favorites = new Set();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  __resetPreferenceStoreForTests();
});

describe("LeftSidebar Research section", () => {
  it("Research section sits after Projects and before footer links", () => {
    setup();
    const projects = section("projects");
    const research = section("research");
    const terminals = screen.getByTestId("sidebar-terminals-link");
    const archive = screen.getByTestId("sidebar-archive-link");
    expect(projects.compareDocumentPosition(research) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(research.compareDocumentPosition(terminals) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(research.compareDocumentPosition(archive) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The footer links are no longer inside either list.
    expect(within(projects).queryByTestId("sidebar-terminals-link")).toBeNull();
    expect(within(research).queryByTestId("sidebar-terminals-link")).toBeNull();
  });

  it("rows split by kind; starred keeps any kind", () => {
    shell.favorites = new Set(["atlas", "edge-tts", "knowledge"]);
    setup();
    expect(namesIn(section("starred")).sort()).toEqual(["atlas", "edge-tts", "knowledge"]);
    expect(namesIn(section("projects"))).toEqual(["vector"]);
    expect(namesIn(section("research"))).toEqual(["voice-cloning", "undated"]);
  });

  it("Research header collapses and persists, shows row count", () => {
    setup();
    const toggle = screen.getByTestId("sidebar-section-research-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(within(toggle).getByText("Research")).toBeTruthy();
    expect(screen.getByTestId("sidebar-section-research-count").textContent).toBe("4");
    expect(namesIn(section("research"))).toHaveLength(4);

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(namesIn(section("research"))).toEqual([]);
    // The count stays visible while collapsed.
    expect(screen.getByTestId("sidebar-section-research-count").textContent).toBe("4");
    expect(readPreference(preferences.researchSectionCollapsed)).toBe(true);
    const doc = (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> }).__PAVILIO_PREFS__;
    expect(doc?.["shell.research.collapsed"]).toBe(true);
    // Projects are untouched by the Research collapse.
    expect(namesIn(section("projects"))).toEqual(["vector", "atlas"]);
  });

  it("Research order: knowledge first, then lastActivity desc", () => {
    setup();
    expect(namesIn(section("research"))).toEqual([
      "knowledge",
      "edge-tts",
      "voice-cloning",
      "undated",
    ]);
  });

  it("research rows carry flask, knowledge carries book, also in Starred", () => {
    shell.favorites = new Set(["edge-tts", "knowledge"]);
    setup();
    const flaskIn = (name: string) =>
      within(row(name)).queryByTestId("project-mark-icon-flask");
    const bookIn = (name: string) =>
      within(row(name)).queryByTestId("project-mark-icon-book");

    // Research section.
    expect(flaskIn("voice-cloning")).toBeTruthy();
    expect(flaskIn("undated")).toBeTruthy();
    // Starred section.
    expect(within(section("starred")).getByTestId("sidebar-project-row-edge-tts")).toBeTruthy();
    expect(flaskIn("edge-tts")).toBeTruthy();
    expect(bookIn("knowledge")).toBeTruthy();
    // A project keeps its own mark.
    expect(flaskIn("vector")).toBeNull();
    expect(bookIn("vector")).toBeNull();
  });

  it("research terminals nest under the research row", () => {
    shell.sessions = () => [session("g1", "edge-tts")];
    setup();
    const research = section("research");
    expect(within(research).getByTestId("sidebar-project-create-terminal-edge-tts")).toBeTruthy();
    expect(within(research).queryByTestId("sidebar-session-g1")).toBeNull();

    fireEvent.click(within(research).getByTestId("sidebar-project-expand-edge-tts"));

    const sessionRow = within(research).getByTestId("sidebar-session-g1");
    expect(sessionRow.textContent).toContain("edge-tts-1");
    // Nested inside the research row's own list item, as under projects.
    expect(row("edge-tts").closest("li")!.contains(sessionRow)).toBe(true);
  });

  it("age label and dimming past 30 days", () => {
    setup();
    expect(screen.getByTestId("sidebar-project-age-edge-tts").textContent).toBe("3d");
    expect(screen.getByTestId("sidebar-project-age-voice-cloning").textContent).toBe("41d");
    expect(row("edge-tts").getAttribute("data-dimmed")).toBe("false");
    expect(row("voice-cloning").getAttribute("data-dimmed")).toBe("true");
    expect(row("voice-cloning").style.opacity).not.toBe("");
    // No date, no age and no dimming.
    expect(screen.queryByTestId("sidebar-project-age-undated")).toBeNull();
    expect(row("undated").getAttribute("data-dimmed")).toBe("false");
    // Project rows carry no age.
    expect(screen.queryByTestId("sidebar-project-age-vector")).toBeNull();
  });

  it("running terminal suppresses dimming", () => {
    shell.sessions = () => [session("v1", "voice-cloning")];
    setup();
    expect(screen.getByTestId("sidebar-project-age-voice-cloning").textContent).toBe("41d");
    expect(row("voice-cloning").getAttribute("data-dimmed")).toBe("false");
    expect(row("voice-cloning").style.opacity).toBe("");
  });

  it("knowledge row: no age, no dim, no archive", () => {
    // Even with a date far in the past, the knowledge row never ages.
    shell.projects = () =>
      ROWS.map((r) => (r.kind === "knowledge" ? { ...r, lastActivity: "2025-01-01" } : r));
    setup();
    expect(screen.queryByTestId("sidebar-project-age-knowledge")).toBeNull();
    expect(row("knowledge").getAttribute("data-dimmed")).toBe("false");
    expect(screen.queryByTestId("sidebar-project-archive-knowledge")).toBeNull();
  });

  it("research row hover shows archive", () => {
    setup();
    const archive = screen.getByTestId("sidebar-project-archive-edge-tts");
    const projectArchive = screen.getByTestId("sidebar-project-archive-vector");
    // Revealed on hover exactly as on a project row: same hover classes,
    // inside a `group` row.
    expect(archive.className).toBe(projectArchive.className);
    expect(archive.className).toContain("group-hover:opacity-100");
    expect(row("edge-tts").className).toContain("group");
    expect(archive.getAttribute("aria-label")).toBe("Archive edge-tts");
  });

  it("Archive link shows no count", () => {
    setup();
    const link = screen.getByTestId("sidebar-archive-link");
    expect(link.textContent).toBe("Archive");
    expect(link.getAttribute("href")).toBe("/archive");
  });
});
