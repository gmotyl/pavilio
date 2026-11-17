import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SessionMeta } from "../../terminal/useTerminalSessions";
import type { ProjectKind } from "../../../../server/lib/projects/kind";

/**
 * Project group rows in the sidebar's Projects tree. Mockup:
 * projects/pavilio/mockups/2026-11-17-project-groups-sidebar-and-menus.html
 * (section 1, checks 1–4).
 */

type Row = { name: string; repos: unknown[]; kind?: ProjectKind; group?: string | null };

const shell = vi.hoisted(() => ({
  projects: (): Row[] => [],
  sessions: (): SessionMeta[] => [],
  archived: new Set<string>(),
}));

vi.mock("../../speech/useSpeechHost", () =>
  import("./leftSidebar.harness").then((m) => m.mockShellDeps.useSpeechHost()),
);
vi.mock("../../projects/useProjects", () =>
  import("./leftSidebar.harness").then((m) =>
    m.mockShellDeps.useProjects(() => shell.projects() as never),
  ),
);
vi.mock("../../terminal/useAllTerminalSessions", () =>
  import("./leftSidebar.harness").then((m) =>
    m.mockShellDeps.useAllTerminalSessions(() => shell.sessions()),
  ),
);
vi.mock("../../projects/useArchivedProjects", () => ({
  useArchivedProjects: () => ({
    archive: () => {},
    restore: () => {},
    archivedNames: shell.archived,
  }),
}));
vi.mock("../../projects/useFavorites", () =>
  import("./leftSidebar.harness").then((m) => m.mockShellDeps.useFavorites()),
);
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
import { _applyEventForTests, _resetForTests } from "../../terminal/useTerminalActivityChannel";
import { preferences } from "../../../preferences/declarations";
import {
  __resetPreferenceStoreForTests,
  readPreference,
  writePreference,
} from "../../../preferences/store";
import { installMatchMedia } from "../../../test-utils";

const ROWS: Row[] = [
  { name: "motyl", repos: [], group: "Motyl OSS" },
  { name: "anytts", repos: [], group: "Motyl OSS" },
  { name: "pavilio", repos: [], group: null },
  { name: "infopoly", repos: [], group: "InfoPoly" },
  { name: "woozle", repos: [], group: "InfoPoly" },
];

function session(id: string, project: string): SessionMeta {
  return {
    id,
    project,
    name: `${project}-1`,
    cwd: `/repo/${project}`,
    pid: 1,
    createdAt: "2026-11-17T00:00:00.000Z",
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

const groupRow = (g: string) => screen.getByTestId(`sidebar-group-row-${g}`);
const projectsSection = () => screen.getByTestId("sidebar-section-projects");
/** Top-level entries of the Projects tree, in render order: `g:` groups, `p:` projects. */
const topLevel = () => {
  const list = within(projectsSection()).getByTestId("sidebar-projects-tree");
  return [...list.children].map((li) => {
    const g = li.getAttribute("data-group");
    if (g) return `g:${g}`;
    const r = li.querySelector("[data-testid^='sidebar-project-row-']");
    return `p:${r!.getAttribute("data-testid")!.replace("sidebar-project-row-", "")}`;
  });
};

beforeEach(() => {
  __resetPreferenceStoreForTests();
  _resetForTests();
  installMatchMedia();
  shell.projects = () => ROWS;
  shell.sessions = () => [];
  shell.archived = new Set();
});

afterEach(() => {
  cleanup();
  __resetPreferenceStoreForTests();
});

describe("SidebarGroupRow", () => {
  it("group row shows grip chevron slot marks name count", () => {
    setup();
    const row = groupRow("Motyl OSS");
    expect(within(row).getByTestId("sidebar-group-grip-Motyl OSS")).toBeTruthy();
    expect(within(row).getByTestId("sidebar-group-toggle-Motyl OSS")).toBeTruthy();
    expect(within(row).getByTestId("sidebar-group-slot-Motyl OSS")).toBeTruthy();
    const marks = within(row).getByTestId("sidebar-group-marks-Motyl OSS");
    expect(within(marks).getAllByTestId("project-mark")).toHaveLength(2);
    const name = within(row).getByTestId("sidebar-group-name-Motyl OSS");
    expect(name.textContent).toBe("Motyl OSS");
    expect(name.tagName).toBe("STRONG");
    expect(within(row).getByTestId("sidebar-group-count-Motyl OSS").textContent).toBe("2");
  });

  it("members are indented under the group rule", () => {
    shell.sessions = () => [session("s1", "motyl")];
    setup();
    const members = screen.getByTestId("sidebar-group-members-Motyl OSS");
    expect(members.getAttribute("data-rule")).toBe("true");
    expect(within(members).getByTestId("sidebar-project-row-motyl")).toBeTruthy();
    expect(within(members).getByTestId("sidebar-project-row-anytts")).toBeTruthy();
    fireEvent.click(screen.getByTestId("sidebar-project-expand-motyl"));
    expect(within(members).getByTestId("sidebar-session-s1")).toBeTruthy();
  });

  it("collapsed group shows the most urgent member state", () => {
    writePreference(preferences.groupCollapsed, { InfoPoly: true });
    shell.sessions = () => [session("a", "infopoly"), session("b", "woozle")];
    setup();
    expect(screen.queryByTestId("sidebar-group-members-InfoPoly")).toBeNull();
    const slot = screen.getByTestId("sidebar-group-slot-InfoPoly");
    act(() => {
      _applyEventForTests({ sessionId: "a", state: "busy", at: 1 });
      _applyEventForTests({ sessionId: "b", state: "attention", at: 1, attentionSinceAt: 1 });
    });
    expect(slot.querySelector("[data-state]")!.getAttribute("data-state")).toBe("attention");
    // Expanded, the slot stays empty: member rows carry their own state.
    expect(
      screen.getByTestId("sidebar-group-slot-Motyl OSS").querySelector("[data-state='attention']"),
    ).toBeNull();
  });

  it("groups and projects interleave in saved order with links last", () => {
    writePreference(preferences.sidebarOrder, {
      top: ["g:InfoPoly", "p:pavilio", "g:Motyl OSS"],
      groups: { "Motyl OSS": ["motyl", "anytts"] },
    });
    setup();
    expect(topLevel()).toEqual(["g:InfoPoly", "p:pavilio", "g:Motyl OSS"]);
    const members = screen.getByTestId("sidebar-group-members-Motyl OSS");
    expect(
      within(members)
        .getAllByTestId(/^sidebar-project-row-/)
        .map((r) => r.getAttribute("data-testid")),
    ).toEqual(["sidebar-project-row-motyl", "sidebar-project-row-anytts"]);
    const follows = (a: Element, b: Element) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const terminals = screen.getByTestId("sidebar-terminals-link");
    const archive = screen.getByTestId("sidebar-archive-link");
    expect(follows(projectsSection(), terminals)).toBe(true);
    expect(follows(screen.getByTestId("sidebar-section-research"), terminals)).toBe(true);
    expect(follows(terminals, archive)).toBe(true);
  });

  it("all-archived group is hidden", () => {
    shell.archived = new Set(["infopoly", "woozle"]);
    setup();
    expect(screen.queryByTestId("sidebar-group-row-InfoPoly")).toBeNull();
    expect(screen.getByTestId("sidebar-group-row-Motyl OSS")).toBeTruthy();
  });

  it("research projects ignore group", () => {
    shell.projects = () => [
      ...ROWS,
      { name: "tts-study", repos: [], kind: "research", group: "Motyl OSS" },
    ];
    setup();
    const research = screen.getByTestId("sidebar-section-research");
    expect(within(research).getByTestId("sidebar-project-row-tts-study")).toBeTruthy();
    expect(
      within(screen.getByTestId("sidebar-group-members-Motyl OSS")).queryByTestId(
        "sidebar-project-row-tts-study",
      ),
    ).toBeNull();
    expect(screen.getByTestId("sidebar-group-count-Motyl OSS").textContent).toBe("2");
  });

  it("collapse toggles and persists", () => {
    setup();
    fireEvent.click(screen.getByTestId("sidebar-group-toggle-Motyl OSS"));
    expect(screen.queryByTestId("sidebar-group-members-Motyl OSS")).toBeNull();
    expect(readPreference(preferences.groupCollapsed)).toEqual({ "Motyl OSS": true });
    cleanup();
    setup();
    expect(screen.queryByTestId("sidebar-group-members-Motyl OSS")).toBeNull();
    fireEvent.click(screen.getByTestId("sidebar-group-toggle-Motyl OSS"));
    expect(screen.getByTestId("sidebar-group-members-Motyl OSS")).toBeTruthy();
    expect(readPreference(preferences.groupCollapsed)["Motyl OSS"]).toBeFalsy();
  });

  it("mobile renders groups without grip", () => {
    installMatchMedia({ mobile: true });
    setup();
    expect(groupRow("Motyl OSS")).toBeTruthy();
    expect(screen.queryByTestId("sidebar-group-grip-Motyl OSS")).toBeNull();
    fireEvent.click(screen.getByTestId("sidebar-group-toggle-Motyl OSS"));
    expect(screen.queryByTestId("sidebar-group-members-Motyl OSS")).toBeNull();
  });
});
