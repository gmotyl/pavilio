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
  it("group row has no grip and no stacked marks", () => {
    setup();
    const row = groupRow("Motyl OSS");
    expect(within(row).queryByTestId("sidebar-group-grip-Motyl OSS")).toBeNull();
    expect(within(row).queryByTestId("sidebar-group-marks-Motyl OSS")).toBeNull();
    expect(within(row).getByTestId("sidebar-group-toggle-Motyl OSS")).toBeTruthy();
    expect(within(row).getByTestId("sidebar-group-slot-Motyl OSS")).toBeTruthy();
    expect(within(row).getAllByTestId("project-mark")).toHaveLength(1);
    const name = within(row).getByTestId("sidebar-group-name-Motyl OSS");
    expect(name.textContent).toBe("Motyl OSS");
    expect(name.tagName).toBe("STRONG");
    expect(within(row).getByTestId("sidebar-group-count-Motyl OSS").textContent).toBe("2");
  });

  const iconColor = (g: string) =>
    within(within(groupRow(g)).getByTestId(`sidebar-group-icon-${g}`))
      .getByTestId("project-mark")
      .getAttribute("data-color");
  const memberColor = (g: string, project: string) =>
    within(within(screen.getByTestId(`sidebar-group-members-${g}`)).getByTestId(
      `sidebar-project-row-${project}`,
    )).getAllByTestId("project-mark")[0]!.getAttribute("data-color");

  it("group icon is the first member's mark with the deck marker", () => {
    writePreference(preferences.sidebarOrder, {
      top: ["g:Motyl OSS"],
      groups: { "Motyl OSS": ["anytts", "motyl"] },
    });
    setup();
    const icon = within(groupRow("Motyl OSS")).getByTestId("sidebar-group-icon-Motyl OSS");
    expect(icon.getAttribute("data-deck")).toBe("true");
    const mark = within(icon).getByTestId("project-mark");
    expect(mark.style.boxShadow).toBe(
      [
        "3px -2px 0 -1px var(--bg-surface, var(--bg-base))",
        "3px -2px 0 0 var(--border-subtle)",
        "5px -4px 0 -2px var(--bg-surface, var(--bg-base))",
        "5px -4px 0 -1px var(--border-subtle)",
      ].join(", "),
    );
    expect(mark.style.width).toBe("22px");
    expect(iconColor("Motyl OSS")).toBe(memberColor("Motyl OSS", "anytts"));
  });

  it("group icon follows member order", () => {
    writePreference(preferences.sidebarOrder, {
      top: ["g:Motyl OSS"],
      groups: { "Motyl OSS": ["motyl", "anytts"] },
    });
    setup();
    expect(iconColor("Motyl OSS")).toBe(memberColor("Motyl OSS", "motyl"));
    expect(memberColor("Motyl OSS", "motyl")).not.toBe(memberColor("Motyl OSS", "anytts"));
  });

  it("clicking the group name toggles the group", () => {
    setup();
    fireEvent.click(screen.getByTestId("sidebar-group-name-Motyl OSS"));
    expect(screen.queryByTestId("sidebar-group-members-Motyl OSS")).toBeNull();
    expect(readPreference(preferences.groupCollapsed)).toEqual({ "Motyl OSS": true });
  });

  it("clicking the member count toggles the group", () => {
    setup();
    fireEvent.click(screen.getByTestId("sidebar-group-count-Motyl OSS"));
    expect(screen.queryByTestId("sidebar-group-members-Motyl OSS")).toBeNull();
    expect(readPreference(preferences.groupCollapsed)).toEqual({ "Motyl OSS": true });
  });

  it("Enter and Space on the focused row toggle the group", () => {
    setup();
    const row = groupRow("Motyl OSS");
    expect(row.getAttribute("role")).toBe("button");
    expect(row.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(screen.queryByTestId("sidebar-group-members-Motyl OSS")).toBeNull();
    fireEvent.keyDown(groupRow("Motyl OSS"), { key: " " });
    expect(screen.getByTestId("sidebar-group-members-Motyl OSS")).toBeTruthy();
  });

  it("aria-expanded and chevron follow collapsed", () => {
    setup();
    const chevron = () => screen.getByTestId("sidebar-group-toggle-Motyl OSS");
    expect(groupRow("Motyl OSS").getAttribute("aria-expanded")).toBe("true");
    expect(groupRow("Motyl OSS").getAttribute("aria-label")).toBe("Collapse Motyl OSS");
    expect(chevron().getAttribute("aria-hidden")).toBe("true");
    expect(chevron().tagName).toBe("SPAN");
    expect(chevron().querySelector(".lucide-chevron-down")).toBeTruthy();
    fireEvent.click(groupRow("Motyl OSS"));
    expect(groupRow("Motyl OSS").getAttribute("aria-expanded")).toBe("false");
    expect(groupRow("Motyl OSS").getAttribute("aria-label")).toBe("Expand Motyl OSS");
    expect(chevron().querySelector(".lucide-chevron-right")).toBeTruthy();
  });

  it("group row has a pointer cursor", () => {
    setup();
    const row = groupRow("Motyl OSS");
    expect(row.style.cursor).toBe("pointer");
    expect(row.className).toContain("hover:bg-[var(--bg-hover)]");
  });

  it("right-click opens the menu without toggling", () => {
    setup();
    // fireEvent returns false when a handler called preventDefault (the menu opened).
    const notPrevented = fireEvent.contextMenu(groupRow("Motyl OSS"));
    expect(notPrevented).toBe(false);
    expect(screen.getByTestId("sidebar-group-members-Motyl OSS")).toBeTruthy();
    expect(readPreference(preferences.groupCollapsed)["Motyl OSS"]).toBeFalsy();
  });

  /**
   * jsdom has no layout, so getBoundingClientRect is all zeros here. The name's
   * left offset is the sum of the leading flex items' widths and gaps, so compare
   * those items directly: chevron box, activity slot, mark box, in order.
   * `display: contents` wrappers and the deck's icon wrapper add no box.
   */
  const leading = (row: HTMLElement) => {
    const items: HTMLElement[] = [];
    const walk = (el: Element) => {
      for (const c of Array.from(el.children) as HTMLElement[]) {
        if (c.className.includes("flex-1")) return true; // the name: stop
        if (c.className.includes("contents") || c.hasAttribute("data-deck")) {
          if (walk(c)) return true;
        } else items.push(c);
      }
      return false;
    };
    walk(row);
    return items.map((el) => {
      const tid = el.getAttribute("data-testid") ?? "";
      const kind = tid.startsWith("project-mark")
        ? "mark"
        : tid === "project-activity-slot"
          ? "slot"
          : "chevron";
      if (kind === "mark") return { kind, width: el.style.width, height: el.style.height };
      return { kind, cls: el.className.split(/\s+/).filter((c) => /^(w|h)-\d|shrink-0$/.test(c)).sort() };
    });
  };

  it.each([
    ["desktop", false, "22px"],
    ["mobile", true, "24px"],
  ])("group name aligns with a project name on %s", (_label, mobile, tile) => {
    installMatchMedia({ mobile });
    setup();
    const group = groupRow("Motyl OSS");
    const project = screen.getByTestId("sidebar-project-row-pavilio");
    const g = leading(group);
    expect(g.map((i) => i.kind)).toEqual(["chevron", "slot", "mark"]);
    expect(g).toEqual(leading(project));
    expect(g[2]).toMatchObject({ width: tile, height: tile });
    // Same row padding and gap, so identical leading boxes mean identical offsets.
    for (const cls of ["px-1", "gap-1", "py-0.5"]) {
      expect(group.className).toContain(cls);
      expect(project.className).toContain(cls);
    }
    // The deck wrapper must not shift the mark.
    const wrapper = within(group).getByTestId("sidebar-group-icon-Motyl OSS");
    expect(wrapper.style.margin).toBe("");
    expect(wrapper.style.padding).toBe("");
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

  it("collapsed group exposes its aggregate status as the accessible description", () => {
    writePreference(preferences.groupCollapsed, { InfoPoly: true });
    shell.sessions = () => [session("a", "infopoly"), session("b", "woozle")];
    setup();
    act(() => {
      _applyEventForTests({ sessionId: "b", state: "attention", at: 1, attentionSinceAt: 1 });
    });
    const row = groupRow("InfoPoly");
    // The explicit aria-label stays the contract name.
    expect(row.getAttribute("aria-label")).toBe("Expand InfoPoly");
    const id = row.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    const target = document.getElementById(id!);
    expect(target).toBe(screen.getByTestId("sidebar-group-slot-InfoPoly"));
    expect(target!.querySelector("[aria-label]")!.getAttribute("aria-label")).toBe(
      "Needs attention",
    );
    // Each group gets its own id.
    expect(groupRow("Motyl OSS").getAttribute("aria-describedby")).not.toBe(id);
  });

  it("expanded group's description target is empty", () => {
    shell.sessions = () => [session("a", "infopoly")];
    setup();
    const id = groupRow("InfoPoly").getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)!.querySelector("[aria-label]")).toBeNull();
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

  const METRO: Row[] = [
    { name: "metro", repos: [], group: "metro" },
    { name: "metro-bank", repos: [], group: "metro" },
    { name: "metro-wiki", repos: [], kind: "knowledge", group: "metro" },
  ];
  const membersOf = (g: string) =>
    within(screen.getByTestId(`sidebar-group-members-${g}`))
      .queryAllByTestId(/^sidebar-project-row-/)
      .map((r) => r.getAttribute("data-testid")!.replace("sidebar-project-row-", ""));

  it("group wiki is pinned first and excluded from icon and count", () => {
    shell.projects = () => [...ROWS, ...METRO];
    writePreference(preferences.sidebarOrder, {
      top: ["g:metro"],
      groups: { metro: ["metro", "metro-bank", "metro-wiki"] },
    });
    setup();
    expect(membersOf("metro")).toEqual(["metro-wiki", "metro", "metro-bank"]);
    const wikiRow = screen.getByTestId("sidebar-project-row-metro-wiki");
    expect(within(wikiRow).getByTestId("project-mark-icon-book")).toBeTruthy();
    expect(wikiRow.hasAttribute("data-drag-key")).toBe(false);
    expect(screen.getByTestId("sidebar-group-count-metro").textContent).toBe("2");
    expect(iconColor("metro")).toBe(memberColor("metro", "metro"));
    expect(
      within(screen.getByTestId("sidebar-group-icon-metro")).queryByTestId(
        "project-mark-icon-book",
      ),
    ).toBeNull();
    expect(
      within(screen.getByTestId("sidebar-section-research")).queryByTestId(
        "sidebar-project-row-metro-wiki",
      ),
    ).toBeNull();
  });

  it("drag to top of a group lands below the group wiki", () => {
    shell.projects = () => [...ROWS, ...METRO];
    writePreference(preferences.sidebarOrder, {
      top: ["g:metro"],
      groups: { metro: ["metro", "metro-bank", "metro-wiki"] },
    });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      top: 0, height: 20, bottom: 20, left: 0, right: 100, width: 100, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    let under: Element | null = null;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => under,
    });
    try {
      setup();
      const row = (n: string) => screen.getByTestId(`sidebar-project-row-${n}`);
      fireEvent.pointerDown(row("metro-bank"), { button: 0, clientX: 0, clientY: 10, pointerId: 1 });
      fireEvent.pointerMove(window, { clientX: 0, clientY: 30, pointerId: 1 });
      // The wiki row is no drop target: nothing lands above it.
      under = row("metro-wiki");
      fireEvent.pointerMove(window, { clientX: 0, clientY: 2, pointerId: 1 });
      expect(row("metro-wiki").hasAttribute("data-drop")).toBe(false);
      // The top drop slot is above the first draggable member.
      under = row("metro");
      fireEvent.pointerMove(window, { clientX: 0, clientY: 2, pointerId: 1 });
      expect(row("metro").getAttribute("data-drop")).toBe("before");
      fireEvent.pointerUp(window, { clientX: 0, clientY: 2, pointerId: 1 });
      expect(membersOf("metro")).toEqual(["metro-wiki", "metro-bank", "metro"]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("group with only its wiki shows count 0", () => {
    shell.projects = () => [
      ...ROWS,
      { name: "metro-wiki", repos: [], kind: "knowledge", group: "metro" },
    ];
    setup();
    expect(screen.getByTestId("sidebar-group-row-metro")).toBeTruthy();
    expect(screen.getByTestId("sidebar-group-count-metro").textContent).toBe("0");
    expect(membersOf("metro")).toEqual(["metro-wiki"]);
    expect(
      within(screen.getByTestId("sidebar-group-icon-metro")).queryByTestId("project-mark"),
    ).toBeNull();
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
