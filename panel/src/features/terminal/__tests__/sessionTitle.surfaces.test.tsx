import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useRef } from "react";
import { MemoryRouter } from "react-router-dom";
import type { SessionMeta } from "../useTerminalSessions";
import { mobileShortName } from "../useTerminalSessions";
import { __resetProjectColorsForTests } from "../useProjectColors";
import type { ConnectionState } from "../terminalInstances";
import type { TerminalHandle } from "../TerminalView";
import { INERT_SPEECH } from "./speech.harness";

/**
 * Task 4's subject: the wide surfaces label a session by `sessionLabel`, while
 * the name keeps every identity job it already had — the rename editors and the
 * mobile rail's five-character handle.
 *
 * One file, many surfaces, so the stubs below are the union of the per-surface
 * suites' stubs rather than a new harness: the connection/pool pair from the
 * grid's suite, the LED from the drawer's, the LeftSidebar module stubs from
 * `shell/__tests__/LeftSidebar.terminalRow.test.tsx`.
 */

const conn = vi.hoisted(() => ({
  state: "connected" as ConnectionState,
  exited: false,
}));

vi.mock("../useTerminalConnection", () => ({
  useTerminalConnection: () => conn.state,
}));

vi.mock("../terminalInstances", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../terminalInstances")>();
  return {
    ...actual,
    hasExited: () => conn.exited,
    reconnectSession: vi.fn(),
    reconnectOnActivate: vi.fn(),
    reconnectAllDisconnected: vi.fn(() => 0),
    sendDismiss: vi.fn(),
  };
});

// xterm cannot render in jsdom. Both shapes of the import are stubbed:
// the grid imports it by name, QuickTerminalModal by default.
vi.mock("../TerminalView", () => ({
  default: ({ sessionId }: { sessionId: string }) => (
    <div data-testid={`terminal-view-${sessionId}`} />
  ),
  TerminalView: ({ sessionId }: { sessionId: string }) => (
    <div data-testid={`terminal-view-${sessionId}`} />
  ),
}));

vi.mock("../TerminalActivityLed", () => ({
  TerminalActivityLed: ({ title }: { sessionId: string; title?: string }) => (
    <span data-testid="activity-led" title={title} />
  ),
}));

vi.mock("../../favicon/useAggregateActivity", () => ({
  useAggregateActivity: () => "idle",
}));

// LeftSidebar's own module dependencies, mirrored from its suite.
const sidebarSessions = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("../useAllTerminalSessions", () => ({
  useAllTerminalSessions: () => ({
    sessions: sidebarSessions.list,
    refresh: () => {},
  }),
}));
vi.mock("../../projects/useProjects", () => ({
  useProjects: () => [{ name: "pavilio", repos: [] }],
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
vi.mock("../../mobile-access/useMobileAccessStatus", () => ({
  useMobileAccessStatus: () => ({ enabled: false }),
}));
vi.mock("../../auto-sync/useAutoSyncStatus", () => ({
  useAutoSyncStatus: () => ({ status: null }),
}));
vi.mock("../../git/useGitStatus", () => ({
  useGitStatus: () => ({ files: [], suggestion: "", refetch: () => {} }),
}));
vi.mock("../createTerminalSession", () => ({
  createTerminalSession: vi.fn(),
}));
vi.mock("../../speech/useSpeechHost", async () => {
  const { INERT_SPEECH_HOST } = await import("./speech.harness");
  return { useSpeechHost: () => INERT_SPEECH_HOST, default: () => INERT_SPEECH_HOST };
});

import { TerminalLayoutGrid } from "../TerminalLayoutGrid";
import { TerminalToolbar } from "../TerminalToolbar";
import { TerminalMobileRail } from "../TerminalMobileRail";
import { TerminalSpine } from "../TerminalSpine";
import { TerminalSpineDrawer } from "../TerminalSpineDrawer";
import { TerminalsSurface } from "../TerminalsSurface";
import QuickTerminalModal from "../QuickTerminalModal";
import { TerminalDrawerProvider } from "../useTerminalDrawer";
import LeftSidebar from "../../shell/LeftSidebar";
import { SpeechHostProvider } from "../../speech/SpeechHostProvider";

const TITLE = "Pavilio crash after changes";

function auto(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: "s1",
    name: "pavilio-1",
    project: "pavilio",
    cwd: "/tmp",
    pid: 1234,
    createdAt: "2026-01-01T00:00:00.000Z",
    title: TITLE,
    ...overrides,
  };
}

/** Same session, renamed by hand — the title must go invisible everywhere. */
function renamed(): SessionMeta {
  return auto({ name: "deploy" });
}

/** Both fetches every surface here can make, answered from one stub. */
function stubFetch(sessions: SessionMeta[]): void {
  __resetProjectColorsForTests();
  vi.spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/projects/colors")
      return { ok: true, status: 200, json: async () => ({ colors: {} }) } as Response;
    if (url.startsWith("/api/terminal/sessions"))
      return { ok: true, status: 200, json: async () => sessions } as Response;
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  }) as typeof fetch);
}

beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      }),
    });
  }
});

beforeEach(() => {
  conn.state = "connected";
  conn.exited = false;
  localStorage.clear();
  sessionStorage.clear();
  sidebarSessions.list = [];
  stubFetch([auto()]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- renderers

function renderGrid(
  sessions: SessionMeta[],
  overrides: Partial<Parameters<typeof TerminalLayoutGrid>[0]> = {},
) {
  const props = {
    sessions,
    focusedId: sessions[0]?.id ?? null,
    maximized: false,
    onFocus: vi.fn(),
    onExit: vi.fn(),
    onReady: vi.fn(),
    onPlace: vi.fn(),
    onRename: vi.fn(),
    speech: INERT_SPEECH,
    ...overrides,
  };
  render(<TerminalLayoutGrid {...props} />);
  return props;
}

function renderToolbar(
  sessions: SessionMeta[],
  overrides: Partial<Parameters<typeof TerminalToolbar>[0]> = {},
) {
  const props = {
    sessions,
    focusedId: sessions[0]?.id ?? null,
    maximized: false,
    currentProject: "pavilio",
    repos: [],
    onFocus: vi.fn(),
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onToggleMaximize: vi.fn(),
    onReorder: vi.fn(),
    ...overrides,
  };
  render(<TerminalToolbar {...props} />);
  return props;
}

function renderSpine(sessions: SessionMeta[]) {
  render(
    <TerminalSpine
      sessions={sessions}
      focusedId={sessions[0]?.id ?? null}
      onFocus={vi.fn()}
      onOpenDrawer={vi.fn()}
    />,
  );
}

function renderDrawer(sessions: SessionMeta[]) {
  render(
    <MemoryRouter>
      <TerminalSpineDrawer
        sessions={sessions}
        focusedId={sessions[0]?.id ?? null}
        currentProject="pavilio"
        onFocus={vi.fn()}
        onClose={vi.fn()}
      />
    </MemoryRouter>,
  );
}

function renderRail(sessions: SessionMeta[]) {
  render(
    <TerminalMobileRail
      sessions={sessions}
      focusedId={sessions[0]?.id ?? null}
      currentProject="pavilio"
      onFocus={vi.fn()}
      onCreate={vi.fn()}
      onOpenDrawer={vi.fn()}
    />,
  );
}

function renderSidebar(sessions: SessionMeta[]) {
  sidebarSessions.list = sessions;
  render(
    <MemoryRouter initialEntries={["/project/pavilio"]}>
      <SpeechHostProvider>
        <LeftSidebar />
      </SpeechHostProvider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByTestId("sidebar-project-expand-pavilio"));
}

async function renderQuickFinder(sessions: SessionMeta[]) {
  stubFetch(sessions);
  render(
    <MemoryRouter initialEntries={["/project/pavilio"]}>
      <TerminalDrawerProvider>
        <QuickTerminalModal />
      </TerminalDrawerProvider>
    </MemoryRouter>,
  );
  fireEvent.keyDown(window, { key: "o", metaKey: true });
  // Wait for the FETCHED session to be on screen, not merely for the modal:
  // the modal opens one tick before its session list resolves.
  await waitFor(() =>
    expect(
      screen.getByTestId(`terminal-view-${sessions[0]?.id}`),
    ).toBeInTheDocument(),
  );
}

/** The real surface, with its real children — nothing about it is stubbed. */
function renderTerminalsSurface(sessions: SessionMeta[]) {
  function Harness() {
    const ref = useRef<Map<string, TerminalHandle>>(new Map());
    return (
      <TerminalsSurface
        currentProject="pavilio"
        repos={[]}
        sessions={sessions}
        focusedId={sessions[0]?.id ?? null}
        onFocus={() => {}}
        onDeleteSession={() => {}}
        onUpdateSession={() => {}}
        allSessions={sessions}
        maximized={false}
        onToggleMaximize={() => {}}
        drawerOpen={false}
        onSetDrawerOpen={() => {}}
        terminalHandlesRef={ref}
        onCreateTerminal={() => {}}
        onNavTo={() => {}}
        speech={INERT_SPEECH}
      />
    );
  }
  render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
}

/** A one-line label carries the whole string in `title=` and ellipsises. */
function expectTruncatedLabel(el: HTMLElement, text: string) {
  expect(el).toHaveTextContent(text);
  expect(el.className).toContain("truncate");
  expect(el.getAttribute("title") ?? "").toContain(text);
}

// -------------------------------------------------------------------- tests

describe("terminal surfaces label a session by its title", () => {
  it("the cell header shows the title of an auto-named session", () => {
    renderGrid([auto()]);

    const label = screen.getByTitle(`${TITLE} — double-click to rename`);
    expectTruncatedLabel(label, TITLE);
    expect(screen.queryByText("pavilio-1")).not.toBeInTheDocument();
  });

  it("the tab strip shows the title", () => {
    renderToolbar([auto()]);

    const label = screen.getByTitle(`${TITLE} — double-click to rename`);
    expectTruncatedLabel(label, TITLE);
    expect(screen.queryByText("pavilio-1")).not.toBeInTheDocument();
  });

  it("the quick finder shows the title", async () => {
    await renderQuickFinder([auto()]);

    // The `${project} / …` composite in the dropdown button.
    const dropdown = screen.getByTestId("quick-terminal-project-dropdown");
    expect(dropdown).toHaveTextContent(TITLE);
    expectTruncatedLabel(within(dropdown).getByTitle(TITLE), TITLE);

    // The dot's tooltip, current project — the label alone.
    expect(screen.getByTestId("quick-terminal-dot-s1")).toHaveAttribute(
      "title",
      TITLE,
    );

    // The row in the session dropdown.
    fireEvent.click(dropdown);
    const option = await waitFor(() =>
      screen.getByTestId("quick-terminal-option-s1"),
    );
    expectTruncatedLabel(within(option).getByTitle(TITLE), TITLE);
  });

  it("the sidebar session row shows the title", () => {
    renderSidebar([auto()]);

    const row = screen.getByTestId("sidebar-session-s1");
    expectTruncatedLabel(within(row).getByTitle(TITLE), TITLE);
  });

  it("the Cmd+B drawer row shows the title", () => {
    renderDrawer([auto()]);

    const row = screen.getByTestId("terminal-spine-drawer-session-s1");
    expectTruncatedLabel(within(row).getByTitle(TITLE), TITLE);
  });

  it("the spine tooltip carries the title", () => {
    renderSpine([auto()]);

    expect(screen.getByTestId("terminal-spine-session-s1")).toHaveAttribute(
      "title",
      TITLE,
    );
  });

  it("a renamed session shows its name on every surface", async () => {
    const surfaces: Array<[string, () => void | Promise<void>]> = [
      ["cell header", () => renderGrid([renamed()])],
      ["tab strip", () => renderToolbar([renamed()])],
      ["quick finder", () => renderQuickFinder([renamed()])],
      ["sidebar", () => renderSidebar([renamed()])],
      ["drawer", () => renderDrawer([renamed()])],
    ];

    for (const [what, mount] of surfaces) {
      await mount();
      expect(document.body.textContent, what).toContain("deploy");
      // The title appears nowhere in the tree — not as text, not in a tooltip.
      expect(document.body.innerHTML, what).not.toContain(TITLE);
      cleanup();
    }

    // The spine renders no text at all, so its assertion is on the tooltip.
    renderSpine([renamed()]);
    expect(screen.getByTestId("terminal-spine-session-s1")).toHaveAttribute(
      "title",
      "deploy",
    );
    expect(document.body.innerHTML).not.toContain(TITLE);
  });

  it("the rename editor opens prefilled with the name, not the title", () => {
    const grid = renderGrid([auto()]);

    fireEvent.doubleClick(screen.getByTitle(`${TITLE} — double-click to rename`));
    const cellInput = screen.getByTestId(
      "terminal-cell-name-input-s1",
    ) as HTMLInputElement;
    expect(cellInput.value).toBe("pavilio-1");
    expect(cellInput).toHaveAttribute("aria-label", "Rename pavilio-1");
    fireEvent.change(cellInput, { target: { value: "ops-box" } });
    fireEvent.keyDown(cellInput, { key: "Enter" });
    expect(grid.onRename).toHaveBeenCalledWith("s1", "ops-box");

    cleanup();

    const toolbar = renderToolbar([auto()]);
    fireEvent.doubleClick(screen.getByTitle(`${TITLE} — double-click to rename`));
    const tabInput = screen.getByDisplayValue("pavilio-1") as HTMLInputElement;
    fireEvent.blur(tabInput, { target: { value: "ops-box" } });
    expect(toolbar.onRename).toHaveBeenCalledWith("s1", "ops-box");
  });

  it("the mobile rail still abbreviates the name", () => {
    const session = auto();
    renderRail([session]);

    const dot = screen.getByTestId("terminal-mobile-rail-session-s1");
    expect(dot).toHaveTextContent(mobileShortName(session, [session]));
    expect(document.body.innerHTML).not.toContain(TITLE);
  });

  // The global terminals view owns no label of its own: it renders through
  // TerminalLayoutGrid and TerminalToolbar, so it inherits theirs. Asserted by
  // mounting the real surface with its real children rather than by editing it.
  it("the global terminals view inherits the label from its children", () => {
    renderTerminalsSurface([auto()]);

    // Two labels, one per child — the tab strip's and the cell header's.
    expect(
      screen.getAllByTitle(`${TITLE} — double-click to rename`),
    ).toHaveLength(2);
  });
});
