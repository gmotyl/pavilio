import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  act,
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import type { SessionMeta } from "../../terminal/useTerminalSessions";
import {
  dispatchTerminalFocus,
  readTerminalFocus,
  writeTerminalFocus,
} from "../../terminal/useTerminalSessions";
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

vi.mock("../../speech/useSpeechHost", () =>
  // Read through the holder so a test can swap the state before it renders.
  import("./leftSidebar.harness").then((m) => m.mockShellDeps.useSpeechHost((sessionId) => speech.stateFor(sessionId))),
);

import LeftSidebar from "../LeftSidebar";
import { writeLastPath } from "../lastPath";
import ProjectRedirect from "../../projects/ProjectRedirect";
import { TerminalSpeechHost } from "../../terminal/TerminalSpeechHost";
import {
  _applyEventForTests,
  _resetForTests,
} from "../../terminal/useTerminalActivityChannel";
import { preferences } from "../../../preferences/declarations";
import {
  __resetPreferenceStoreForTests,
  readPreference,
  writePreference,
} from "../../../preferences/store";
import { useSidebarState } from "../useSidebarState";
import SidebarHamburger from "../SidebarHamburger";
import { __resetProjectColorsForTests } from "../../terminal/useProjectColors";
import { nameColor } from "../../projects/nameColor";
import { installMatchMedia } from "../../../test-utils";

// "vector" is the current project in most of these tests, matching the sibling
// LeftSidebar.lastTab.test.tsx's mocked project. "atlas" is a second project
// with its own session, so the highlight tests can prove that another
// project's remembered focus never bleeds into the current one.
const sessions: SessionMeta[] = [
  {
    id: "s1",
    project: "vector",
    name: "shell-1",
    cwd: "/repo/vector",
    pid: 4242,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "s2",
    project: "vector",
    name: "shell-2",
    cwd: "/repo/vector",
    pid: 4243,
    createdAt: "2026-01-01T00:00:01.000Z",
  },
  {
    id: "a1",
    project: "atlas",
    name: "atlas-1",
    cwd: "/repo/atlas",
    pid: 4244,
    createdAt: "2026-01-01T00:00:02.000Z",
  },
];

/**
 * The project list and the session list the sidebar is given, in a box so a
 * describe below can pin its own shape without re-mocking the module. The
 * file-level `beforeEach` puts back the default — "vector" and "atlas", and
 * the `sessions` above — before every test.
 */
const shell = vi.hoisted(() => ({
  projects: (): Array<{ name: string; repos: unknown[] }> => [],
  sessions: (): SessionMeta[] => [],
}));

vi.mock("../../projects/useProjects", () =>
  import("./leftSidebar.harness").then((m) => m.mockShellDeps.useProjects(() => shell.projects())),
);
vi.mock("../../terminal/useAllTerminalSessions", () =>
  import("./leftSidebar.harness").then((m) => m.mockShellDeps.useAllTerminalSessions(() => shell.sessions())),
);
vi.mock("../../projects/useArchivedProjects", () =>
  import("./leftSidebar.harness").then((m) => m.mockShellDeps.useArchivedProjects()),
);
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
      <TerminalSpeechHost>
        <LeftSidebar />
      </TerminalSpeechHost>
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

/** Reveals a project's session rows. */
const expand = (project: string) =>
  fireEvent.click(screen.getByTestId(`sidebar-project-expand-${project}`));

/** The inline background of a session row — the highlight under test. */
const rowBackground = (sessionId: string) =>
  screen.getByTestId(`sidebar-session-${sessionId}`).style.background;

const HIGHLIGHTED = "var(--bg-active)";
const PLAIN = "transparent";

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
  shell.projects = () => [
    { name: "vector", repos: [] },
    { name: "atlas", repos: [] },
  ];
  shell.sessions = () => sessions;
});

describe("LeftSidebar terminal-session row navigation", () => {
  beforeEach(() => {
    createTerminalSession.mockReset();
  });

  it("clicking a terminal-session row navigates to the project's last-open path instead of forcing iterm", () => {
    writeLastPath("vector", "/project/vector/memo?file=x");
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

  it("clicking a terminal-session row still marks that session focused", () => {
    setup();
    expandAndClickSession();
    expect(readTerminalFocus("vector")).toBe("s1");
  });
});

describe("LeftSidebar terminal-session row highlight", () => {

  it("keeps the clicked session highlighted when the bare-route redirect lands back on the same iterm view", async () => {
    // Already reading this project's terminals; the row click bounces through
    // the bare project route and comes straight back here.
    writeLastPath("vector", "/project/vector/iterm");
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
    writeTerminalFocus("vector", "s1");
    setup("/project/vector/iterm");
    fireEvent.click(screen.getByTestId("sidebar-project-expand-vector"));
    expect(screen.getByTestId("sidebar-session-s1").style.background).toBe(
      "var(--bg-active)",
    );
  });

  it("highlights the focused session while a non-terminal section of the project is open", () => {
    // Inverted from the old rule: the Cmd+B drawer renders precisely here, so
    // the section the drawer lives on must show the highlight, not hide it.
    writeTerminalFocus("vector", "s2");
    setup("/project/vector/memo");
    expand("vector");
    expect(rowBackground("s2")).toBe(HIGHLIGHTED);
    expect(rowBackground("s1")).toBe(PLAIN);
  });

  it("still highlights the focused session on the terminal route", () => {
    writeTerminalFocus("vector", "s2");
    setup("/project/vector/iterm");
    expand("vector");
    expect(rowBackground("s2")).toBe(HIGHLIGHTED);
    expect(rowBackground("s1")).toBe(PLAIN);
  });

  it("highlights the focused session on the bare project route", () => {
    writeTerminalFocus("vector", "s2");
    setup("/project/vector");
    expand("vector");
    expect(rowBackground("s2")).toBe(HIGHLIGHTED);
  });

  it("a focus broadcast for the current project moves the highlight without navigating", () => {
    writeTerminalFocus("vector", "s1");
    setup("/project/vector/memo");
    expand("vector");
    expect(rowBackground("s1")).toBe(HIGHLIGHTED);

    act(() => dispatchTerminalFocus("vector", "s2"));

    expect(rowBackground("s2")).toBe(HIGHLIGHTED);
    expect(rowBackground("s1")).toBe(PLAIN);
    expect(screen.getByTestId("location").textContent).toBe(
      "/project/vector/memo",
    );
  });

  it("does not highlight rows of a project that is not the current one", () => {
    writeTerminalFocus("vector", "s2");
    writeTerminalFocus("atlas", "a1");
    setup("/project/vector/memo");
    expand("vector");
    expand("atlas");
    expect(rowBackground("s2")).toBe(HIGHLIGHTED);
    expect(rowBackground("a1")).toBe(PLAIN);
  });

  it("a focus broadcast for another project leaves the highlight alone", () => {
    writeTerminalFocus("vector", "s2");
    setup("/project/vector/memo");
    expand("vector");
    expand("atlas");

    act(() => dispatchTerminalFocus("atlas", "a1"));

    expect(rowBackground("s2")).toBe(HIGHLIGHTED);
    expect(rowBackground("a1")).toBe(PLAIN);
  });

  it("highlights nothing when the route names no project", () => {
    writeTerminalFocus("vector", "s2");
    setup("/terminals");
    expand("vector");
    expect(rowBackground("s1")).toBe(PLAIN);
    expect(rowBackground("s2")).toBe(PLAIN);
  });

  it("a remembered id that names no live session highlights nothing", () => {
    writeTerminalFocus("vector", "ghost");
    setup("/project/vector/iterm");
    expand("vector");
    expect(rowBackground("s1")).toBe(PLAIN);
    expect(rowBackground("s2")).toBe(PLAIN);
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

  it("the collapsed row swaps its dot for the speaker while a session speaks", () => {
    setActivity("s1", "busy");
    setActivity("s2", "attention");
    speech.stateFor = (id) => (id === "s1" ? "speaking" : "empty");

    setup();

    // One slot, one thing in it: the speaker outranks every LED state, even
    // the attention of a different session, for as long as the audio plays.
    expect(
      within(projectRow()).getByTestId("session-speaker-s1"),
    ).toBeInTheDocument();
    expect(projectRow().querySelector(".terminal-led")).toBeNull();
  });
});

/** The stylesheet as text, resolved relative to this file (see SessionIndicator.test.tsx). */
const indexCss = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../index.css"),
  "utf8",
);

/** The declarations of one top-level CSS rule in `index.css`. */
function cssRule(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, "m").exec(indexCss);
  if (!match) throw new Error(`no rule for ${selector} in index.css`);
  return Object.fromEntries(
    match[1]
      .split(";")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const at = line.indexOf(":");
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      }),
  );
}

describe("LeftSidebar activity slot", () => {
  /** The slot inside one project row. */
  const slotsIn = (project: string) =>
    Array.from(
      screen
        .getByTestId(`sidebar-project-row-${project}`)
        .querySelectorAll<HTMLElement>('[data-testid="project-activity-slot"]'),
    );

  it("expanded project row keeps an empty activity slot", () => {
    setActivity("s1", "busy");
    setActivity("s2", "attention");

    setup();
    expand("vector");

    // Present, so the mark tile does not jump left when the row opens, and
    // empty, because the session rows below now carry each state themselves.
    const slots = slotsIn("vector");
    expect(slots).toHaveLength(1);
    expect(slots[0].childElementCount).toBe(0);
  });

  it("activity slot has a fixed width on every project row", () => {
    shell.projects = () =>
      ["p-att", "p-busy", "p-idle", "p-speak", "p-none"].map((name) => ({
        name,
        repos: [],
      }));
    const meta = (id: string, project: string): SessionMeta => ({
      id,
      project,
      name: id,
      cwd: `/repo/${project}`,
      pid: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    shell.sessions = () => [
      meta("att", "p-att"),
      meta("busy", "p-busy"),
      meta("idle", "p-idle"),
      meta("speak", "p-speak"),
    ];
    setActivity("att", "attention");
    setActivity("busy", "busy");
    setActivity("idle", "idle");
    setActivity("speak", "busy");
    speech.stateFor = (id) => (id === "speak" ? "speaking" : "empty");

    setup();

    const contents: Record<string, string> = {};
    for (const project of ["p-att", "p-busy", "p-idle", "p-speak", "p-none"]) {
      const slots = slotsIn(project);
      expect(slots).toHaveLength(1);
      const slot = slots[0];
      // The width comes from the class alone, never from an inline override
      // that could differ per row.
      expect(slot).toHaveClass("project-activity-slot");
      expect(slot.style.width).toBe("");
      expect(slot.style.minWidth).toBe("");
      // The slot sits directly before the mark tile, so a constant slot
      // width means a constant tile offset.
      expect(slot.nextElementSibling).toHaveAttribute(
        "data-testid",
        "project-mark",
      );
      contents[project] = slot.firstElementChild
        ? (slot.firstElementChild.getAttribute("data-state") ??
          slot.firstElementChild.getAttribute("data-testid")!)
        : "";
    }
    expect(contents).toEqual({
      "p-att": "attention",
      "p-busy": "busy",
      "p-idle": "idle",
      "p-speak": "session-speaker-speak",
      "p-none": "",
    });

    // 0 or 1 lit dot, same box: fixed width, never shrunk by a long name.
    const rule = cssRule(".project-activity-slot");
    expect(rule.width).toBe("10px");
    expect(rule["flex-shrink"]).toBe("0");
  });
});

describe("LeftSidebar.mark", () => {
  beforeEach(() => {
    shell.sessions = () => [];
    // Project colours and the preference store are module singletons the
    // describes above already resolved; start from the state a file of its
    // own would.
    __resetProjectColorsForTests();
    __resetPreferenceStoreForTests();
  });

  afterEach(() => {
    cleanup();
    __resetProjectColorsForTests();
    localStorage.clear();
    __resetPreferenceStoreForTests();
  });

  function setup() {
    return render(
      <MemoryRouter initialEntries={["/"]}>
        <TerminalSpeechHost>
          <LeftSidebar />
        </TerminalSpeechHost>
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
});

/**
 * Mockup N: each project name in its own colour (mixed toward black on a light
 * theme), the current row bold on the active background, a 22px tile (24px on a
 * phone, mockup S) and session rows indented to sit under the name.
 */
describe("LeftSidebar.identity", () => {
  const nativeMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

  beforeEach(() => {
    __resetProjectColorsForTests();
    __resetPreferenceStoreForTests();
    writePreference(preferences.projectColor, "#e06c75", "vector");
    writePreference(preferences.projectColor, "#98c379", "atlas");
  });

  afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.theme;
    if (nativeMatchMedia)
      Object.defineProperty(window, "matchMedia", nativeMatchMedia);
    else delete (window as { matchMedia?: unknown }).matchMedia;
    __resetProjectColorsForTests();
    localStorage.clear();
    __resetPreferenceStoreForTests();
  });

  function setupAt(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <TerminalSpeechHost>
          <LeftSidebar />
        </TerminalSpeechHost>
      </MemoryRouter>,
    );
  }

  /** A CSS colour as jsdom serialises it, so a hex and its rgb() compare equal. */
  function normalised(color: string): string {
    const probe = document.createElement("span");
    probe.style.color = color;
    return probe.style.color;
  }

  const nameLink = (project: string) =>
    screen.getByRole("link", { name: project });
  const tileOf = (project: string) =>
    screen
      .getByTestId(`sidebar-project-row-${project}`)
      .querySelector("[data-testid='project-mark']") as HTMLElement;

  it("sidebar project names use the project colour", () => {
    setupAt("/");
    expect(nameLink("vector").style.color).toBe(normalised(nameColor("#e06c75", "dark")));
    expect(nameLink("atlas").style.color).toBe(normalised(nameColor("#98c379", "dark")));

    // Light theme: the 72%-toward-black mix keeps contrast on pale surfaces.
    cleanup();
    document.documentElement.dataset.theme = "light";
    setupAt("/");
    expect(nameLink("vector").style.color).toBe(
      normalised("color-mix(in srgb, #e06c75 72%, black)"),
    );
  });

  it("current project name is bold on the active background", () => {
    setupAt("/project/vector/notes");
    expect(screen.getByTestId("sidebar-project-row-vector").style.background).toBe(
      "var(--bg-active)",
    );
    expect(nameLink("vector").style.fontWeight).toBe("600");
    // The current row keeps its project colour; only the weight marks it.
    expect(nameLink("vector").style.color).toBe(normalised("#e06c75"));
    expect(screen.getByTestId("sidebar-project-row-atlas").style.background).toBe(
      "transparent",
    );
    expect(nameLink("atlas").style.fontWeight).not.toBe("600");
  });

  it("sidebar mark tile is 22px on desktop and 24px on mobile", () => {
    installMatchMedia();
    setupAt("/");
    expect(tileOf("vector").style.width).toBe("22px");
    expect(tileOf("vector").style.height).toBe("22px");
    // Session rows start under the name: row inset (4) + chevron (16) + gap (4)
    // + activity slot (10) + gap (4) + tile + gap (4), less the list's 1px
    // guide border and the session button's 6px padding.
    expand("vector");
    const list = screen.getByTestId("sidebar-session-s1").closest("ul") as HTMLElement;
    expect(list.style.marginLeft).toBe(`${42 + 22 - 7}px`);

    cleanup();
    installMatchMedia({ mobile: true });
    setupAt("/");
    expect(tileOf("vector").style.width).toBe("24px");
    // The expanded state may carry over from the first render; open it if not.
    if (screen.queryByTestId("sidebar-session-s1") === null) expand("vector");
    const mobileList = screen.getByTestId("sidebar-session-s1").closest("ul") as HTMLElement;
    expect(mobileList.style.marginLeft).toBe(`${42 + 24 - 7}px`);
  });

  it("sidebar expand control uses lucide chevrons", () => {
    setupAt("/");
    const control = screen.getByTestId("sidebar-project-expand-vector");
    expect(control.querySelector("svg")?.getAttribute("class")).toContain(
      "lucide-chevron-right",
    );
    fireEvent.click(control);
    expect(control.querySelector("svg")?.getAttribute("class")).toContain(
      "lucide-chevron-down",
    );
  });
});

/**
 * The unresolved-scope rule, at the one call site that read a preference
 * without it.
 *
 * `storageKey` THROWS on a blank or whitespace scope — deliberately, so a
 * missing project cannot key every project onto the same `key@`. The sidebar's
 * hydration effect reads `shell.project.expanded` per project inside a
 * `setExpandedState` updater, so a project whose name has not resolved would
 * turn that throw into an unhandled render error. The pre-migration code
 * answered `false` and carried on.
 */
describe("LeftSidebar.blankProject", () => {
  beforeEach(() => {
    // A blank name is what a project list mid-resolution looks like; the sidebar
    // renders whatever `useProjects` hands it.
    shell.projects = () => [{ name: "   ", repos: [] }, { name: "vector", repos: [] }];
    shell.sessions = () => [];
  });

  describe("LeftSidebar with an unresolved project name", () => {
    beforeEach(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    it("renders rather than throwing, and writes nothing for the blank scope", () => {
      const doc = (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> })
        .__PAVILIO_PREFS__!;

      expect(() =>
        render(
          <MemoryRouter initialEntries={["/"]}>
            <TerminalSpeechHost>
              <LeftSidebar />
            </TerminalSpeechHost>
          </MemoryRouter>,
        ),
      ).not.toThrow();

      expect(screen.getByRole("link", { name: "vector" })).toBeInTheDocument();
      // The blank scope produced no key at all — not `shell.project.expanded@`,
      // and not a bare `shell.project.expanded`.
      expect(Object.keys(doc).filter((k) => k.startsWith("shell.project.expanded"))).toEqual([]);
    });
  });
});

/**
 * The same unresolved-scope rule as `LeftSidebar.blankProject` above, one
 * step further out: a name that is `undefined` at runtime rather than blank.
 *
 * `LeftSidebar` guarded both of its scope sites with a bare `.trim()`, which
 * throws a TypeError on `undefined` — during render in the hydration effect's
 * `setExpandedState` updater, and inside the click handler on the way out.
 * TypeScript types both as `string`, so only a test says otherwise. The rest
 * of this change spells the guard `typeof x === "string" && x.trim() !== ""`;
 * these two sites are the last to be brought into line.
 *
 * A describe of its own rather than a second case in `blankProject`, because
 * each pins one shape of unresolved name in the `useProjects` box.
 */
describe("LeftSidebar.unresolvedProject", () => {
  beforeEach(() => {
    // `undefined` is what a route param that never resolved looks like once it
    // has been through a `name ?? ""` chain the compiler believes.
    shell.projects = () => [
      { name: undefined as unknown as string, repos: [] },
      { name: "vector", repos: [] },
    ];
    shell.sessions = () => [];
  });

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
          <TerminalSpeechHost>
            <LeftSidebar />
          </TerminalSpeechHost>
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
});

/**
 * Mockup S: on a phone the global corner ☰ is the one menu. Opened on a
 * project's page, the sidebar shows that project already expanded with its
 * sessions and the focused one highlighted. The expansion is transient like
 * the phone's open state: the stored per-project expand preference is never
 * written. A desktop sidebar is the stored preference and nothing else.
 */
describe("LeftSidebar.mobileMenu", () => {
  const nativeMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

  beforeEach(() => {
    __resetPreferenceStoreForTests();
    writeTerminalFocus("vector", "s2");
  });

  afterEach(() => {
    cleanup();
    if (nativeMatchMedia)
      Object.defineProperty(window, "matchMedia", nativeMatchMedia);
    else delete (window as { matchMedia?: unknown }).matchMedia;
    localStorage.clear();
    __resetPreferenceStoreForTests();
  });

  /** The global ☰, wired to the left sidebar's state the way `Layout` wires it. */
  function GlobalHamburger() {
    const left = useSidebarState("leftSidebar");
    return <SidebarHamburger expanded={left.expanded} onToggle={left.toggle} />;
  }

  function setupAt(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <GlobalHamburger />
        <TerminalSpeechHost>
          <LeftSidebar />
        </TerminalSpeechHost>
      </MemoryRouter>,
    );
  }

  const openMenu = () => fireEvent.click(screen.getByTestId("sidebar-hamburger"));
  const tileOf = (project: string) =>
    screen
      .getByTestId(`sidebar-project-row-${project}`)
      .querySelector("[data-testid='project-mark']") as HTMLElement;
  const storedExpandKeys = () =>
    Object.keys(
      (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> })
        .__PAVILIO_PREFS__ ?? {},
    ).filter((k) => k.startsWith("shell.project.expanded"));

  it("opening the sidebar on mobile expands the current project", () => {
    installMatchMedia({ mobile: true });
    setupAt("/project/vector/iterm");
    expect(screen.queryByTestId("sidebar-session-s1")).not.toBeInTheDocument();

    openMenu();

    // The current project's sessions are listed, the focused one highlighted.
    expect(screen.getByTestId("sidebar-session-s1")).toBeInTheDocument();
    expect(rowBackground("s2")).toBe(HIGHLIGHTED);
    expect(rowBackground("s1")).toBe(PLAIN);
    // Only the current project opens; the mobile tile is 24px.
    expect(screen.queryByTestId("sidebar-session-a1")).not.toBeInTheDocument();
    expect(tileOf("vector").style.width).toBe("24px");
  });

  it("mobile auto-expand does not write the expand preference", () => {
    installMatchMedia({ mobile: true });
    setupAt("/project/vector/iterm");

    openMenu();
    expect(screen.getByTestId("sidebar-session-s1")).toBeInTheDocument();

    expect(readPreference(preferences.projectExpanded, "vector")).toBe(false);
    expect(storedExpandKeys()).toEqual([]);

    // Control: a user's own toggle is still what writes it.
    expand("vector");
    expand("vector");
    expect(readPreference(preferences.projectExpanded, "vector")).toBe(true);
  });

  it("desktop sidebar does not auto-expand", () => {
    installMatchMedia({ mobile: false });
    setupAt("/project/vector/iterm");
    expect(screen.queryByTestId("sidebar-session-s1")).not.toBeInTheDocument();

    // Desktop starts open (stored default); close and reopen it.
    openMenu();
    openMenu();

    expect(screen.queryByTestId("sidebar-session-s1")).not.toBeInTheDocument();
    expect(readPreference(preferences.projectExpanded, "vector")).toBe(false);
  });
});
