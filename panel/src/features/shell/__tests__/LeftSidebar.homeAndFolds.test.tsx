import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SessionMeta } from "../../terminal/useTerminalSessions";
import type { ProjectKind } from "../../../../server/lib/projects/kind";

/**
 * The sidebar's first row (hamburger slot + Home link) and the foldable
 * Starred / Projects sections. Mockup:
 * projects/pavilio/mockups/2026-11-20-sidebar-home-link-and-actions.html
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


const ROWS: Row[] = [
  { name: "vector", repos: [], kind: "project", lastActivity: null },
  { name: "atlas", repos: [], kind: "project", lastActivity: null },
  { name: "edge-tts", repos: [], kind: "research", lastActivity: null },
];

function setup(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TerminalSpeechHost>
        <LeftSidebar />
      </TerminalSpeechHost>
    </MemoryRouter>,
  );
}

const section = (name: string) => screen.getByTestId(`sidebar-section-${name}`);
const namesIn = (el: HTMLElement) =>
  within(el)
    .queryAllByTestId(/^sidebar-project-row-/)
    .map((r) => r.getAttribute("data-testid")!.replace("sidebar-project-row-", ""));
const prefsDoc = () =>
  (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> }).__PAVILIO_PREFS__;

beforeEach(() => {
  __resetPreferenceStoreForTests();
  shell.projects = () => ROWS;
  shell.sessions = () => [];
  shell.favorites = new Set();
});
afterEach(() => {
  cleanup();
  __resetPreferenceStoreForTests();
});

describe("LeftSidebar Home link and folds", () => {
  it("first row is hamburger + Home link", () => {
    for (const starred of [new Set<string>(), new Set(["atlas"])]) {
      shell.favorites = starred;
      const { unmount } = setup("/project/vector");
      const first = screen.getByTestId("sidebar-first-row");
      expect(first.parentElement?.firstElementChild).toBe(first);
      expect(first.firstElementChild).toHaveClass("sidebar-hamburger-slot");
      expect(document.querySelectorAll(".sidebar-hamburger-slot")).toHaveLength(1);
      const home = screen.getByTestId("sidebar-home-link");
      expect(home.parentElement).toBe(first);
      expect(home.getAttribute("href")).toBe("/");
      // The host pill stands in for the "Home" label (which stays for phones,
      // where the pill is hidden); the link keeps "Home" as its name.
      expect(home).toHaveAccessibleName("Home");
      expect(home.querySelector('[data-testid="host-badge"]')).not.toBeNull();
      unmount();
    }
  });

  it("Home link is active only on /", () => {
    const root = setup("/");
    expect(screen.getByTestId("sidebar-home-link").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("sidebar-home-link").style.boxShadow).toContain("var(--accent)");
    root.unmount();
    setup("/project/vector");
    expect(screen.getByTestId("sidebar-home-link").getAttribute("aria-current")).toBeNull();
    expect(screen.getByTestId("sidebar-home-link").style.boxShadow).not.toContain("accent");
  });

  it("sections are Starred, Projects, Research with no Actions", () => {
    shell.favorites = new Set(["atlas"]);
    setup();
    const order = ["starred", "projects", "research"].map((n) => section(n));
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    const headings = Array.from(document.querySelectorAll("h2")).map((h) => h.textContent);
    expect(headings).toEqual(["Starred", "Projects", "Research", "Git"]);
    expect(screen.queryByText("Actions")).toBeNull();
  });

  it("Starred folds, keeps count, persists", () => {
    shell.favorites = new Set(["atlas", "edge-tts"]);
    const view = setup();
    const toggle = screen.getByTestId("sidebar-section-starred-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(namesIn(section("starred")).sort()).toEqual(["atlas", "edge-tts"]);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(namesIn(section("starred"))).toEqual([]);
    expect(screen.getByTestId("sidebar-section-starred-count").textContent).toBe("2");
    expect(readPreference(preferences.starredCollapsed)).toBe(true);
    expect(prefsDoc()?.["shell.starredCollapsed"]).toBe(true);
    // Projects is untouched by the Starred fold.
    expect(namesIn(section("projects"))).toEqual(["vector"]);
    // Survives a reload: a fresh mount still renders it folded.
    view.unmount();
    setup();
    expect(screen.getByTestId("sidebar-section-starred-toggle").getAttribute("aria-expanded")).toBe("false");
    expect(namesIn(section("starred"))).toEqual([]);
  });

  it("Projects folds, keeps count, persists", () => {
    const view = setup();
    const toggle = screen.getByTestId("sidebar-section-projects-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("sidebar-section-projects-count").textContent).toBe("2");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(namesIn(section("projects"))).toEqual([]);
    expect(screen.queryByTestId("sidebar-projects-tree")).toBeNull();
    expect(screen.getByTestId("sidebar-section-projects-count").textContent).toBe("2");
    // The new button stays reachable on the folded header.
    expect(screen.getByTestId("sidebar-section-projects-new")).toBeTruthy();
    expect(readPreference(preferences.projectsCollapsed)).toBe(true);
    expect(prefsDoc()?.["shell.projectsCollapsed"]).toBe(true);
    // Research is untouched by the Projects fold.
    expect(namesIn(section("research"))).toEqual(["edge-tts"]);
    view.unmount();
    setup();
    expect(screen.getByTestId("sidebar-section-projects-toggle").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("sidebar-projects-tree")).toBeNull();
  });

  it("Research still folds on its own", () => {
    setup();
    const toggle = screen.getByTestId("sidebar-section-research-toggle");
    fireEvent.click(toggle);
    expect(namesIn(section("research"))).toEqual([]);
    expect(screen.getByTestId("sidebar-section-research-count").textContent).toBe("1");
    expect(readPreference(preferences.researchSectionCollapsed)).toBe(true);
  });
});
