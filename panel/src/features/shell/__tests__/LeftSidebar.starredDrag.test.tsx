import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SessionMeta } from "../../terminal/useTerminalSessions";
import type { ProjectKind } from "../../../../server/lib/projects/kind";

/**
 * Starred rows reorder by dragging, with the Projects tree's grip, faded row
 * and drop line. Mockup:
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
import { buildSections } from "../../projects/dashboardSections";
import { preferences } from "../../../preferences/declarations";
import {
  __resetPreferenceStoreForTests,
  readPreference,
  writePreference,
} from "../../../preferences/store";

const ROWS: Row[] = ["metro-bank", "woozle", "workspace", "pavilio"].map((name) => ({
  name,
  repos: [],
  kind: "project" as ProjectKind,
  lastActivity: null,
}));

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
const row = (name: string, within_: HTMLElement) =>
  within(within_).getByTestId(`sidebar-project-row-${name}`);
const namesIn = (el: HTMLElement) =>
  within(el)
    .queryAllByTestId(/^sidebar-project-row-/)
    .map((r) => r.getAttribute("data-testid")!.replace("sidebar-project-row-", ""));

/** Rows are 20px tall at y=0: 2 = top edge, 18 = bottom edge. */
let under: Element | null = null;
let lastY = 0;
function startDrag(el: HTMLElement) {
  fireEvent.pointerDown(el, { button: 0, clientX: 0, clientY: 10, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: 0, clientY: 30, pointerId: 1 });
}
function hover(el: Element, y: number) {
  under = el;
  lastY = y;
  fireEvent.pointerMove(window, { clientX: 0, clientY: y, pointerId: 1 });
}
function drop() {
  fireEvent.pointerUp(window, { clientX: 0, clientY: lastY, pointerId: 1 });
}

beforeEach(() => {
  __resetPreferenceStoreForTests();
  shell.projects = () => ROWS;
  shell.sessions = () => [];
  shell.favorites = new Set(["metro-bank", "woozle", "workspace"]);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    top: 0, height: 20, bottom: 20, left: 0, right: 100, width: 100, x: 0, y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  under = null;
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => under,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  __resetPreferenceStoreForTests();
});

describe("Starred drag", () => {
  it("dropping in Starred reorders and persists without touching sidebar order", () => {
    setup();
    const starred = section("starred");
    const before = readPreference(preferences.sidebarOrder);
    expect(namesIn(starred)).toEqual(["metro-bank", "woozle", "workspace"]);

    const dragged = row("workspace", starred);
    expect(dragged.querySelector("[data-drag-grip]")).not.toBeNull();
    startDrag(dragged);
    expect(dragged.getAttribute("data-dragging")).toBe("true");
    expect(dragged.style.opacity).toBe("0.45");
    const target = row("metro-bank", starred);
    hover(target, 2);
    expect(target.getAttribute("data-drop")).toBe("before");
    expect(target.style.boxShadow).toContain("var(--accent)");
    drop();

    expect(namesIn(section("starred"))).toEqual(["workspace", "metro-bank", "woozle"]);
    expect(readPreference(preferences.starredOrder)).toEqual([
      "workspace",
      "metro-bank",
      "woozle",
    ]);
    expect(readPreference(preferences.sidebarOrder)).toEqual(before);
  });

  it("no drop across Starred and Projects", () => {
    setup();
    const starred = section("starred");
    const projects = section("projects");
    // Starred row over a Projects row.
    startDrag(row("workspace", starred));
    const pavilio = row("pavilio", projects);
    hover(pavilio, 2);
    expect(pavilio.hasAttribute("data-drop")).toBe(false);
    drop();
    expect(readPreference(preferences.starredOrder)).toEqual([]);
    expect(namesIn(section("starred"))).toEqual(["metro-bank", "woozle", "workspace"]);

    // Projects row over a Starred row.
    const orderBefore = JSON.stringify(readPreference(preferences.sidebarOrder));
    startDrag(row("pavilio", section("projects")));
    const woozle = row("woozle", section("starred"));
    hover(woozle, 2);
    expect(woozle.hasAttribute("data-drop")).toBe(false);
    drop();
    expect(readPreference(preferences.starredOrder)).toEqual([]);
    expect(JSON.stringify(readPreference(preferences.sidebarOrder))).toBe(orderBefore);
  });

  it("Favourites on Home follows Starred order", () => {
    writePreference(preferences.starredOrder, ["workspace", "metro-bank", "woozle"]);
    const sections = buildSections({
      projects: ROWS.map((r) => ({ name: r.name, group: null })),
      favorites: shell.favorites,
      starredOrder: readPreference(preferences.starredOrder),
      sidebarOrder: readPreference(preferences.sidebarOrder),
    });
    expect(sections[0].projects.map((p) => p.name)).toEqual([
      "workspace",
      "metro-bank",
      "woozle",
    ]);
    setup();
    expect(namesIn(section("starred"))).toEqual(["workspace", "metro-bank", "woozle"]);
  });
});
