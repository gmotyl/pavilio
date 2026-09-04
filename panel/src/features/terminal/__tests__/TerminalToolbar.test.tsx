import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { TerminalToolbar } from "../TerminalToolbar";
import type { SessionMeta } from "../useTerminalSessions";
import type { ConnectionState } from "../terminalInstances";
import { reconnectSession } from "../terminalInstances";
import {
  TEST_PROJECT_COLORS,
  installProjectColors,
  rgb,
} from "./projectColors.harness";

// Connection state is per-browser and lives in the terminal instance pool.
// Stub the two leaf reads the disconnected badge makes so a chip can be put
// into the disconnected state without standing up a socket.
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
  };
});

// Discovered OS users and the project → default-user map: the chevron
// dropdown reads both hooks directly, so tests control their return values
// rather than standing up the real fetch-once stores.
const osUsersMock = vi.hoisted(() => ({
  users: [] as { username: string }[],
}));
const defaultTerminalUsersMock = vi.hoisted(() => ({
  defaultUsers: {} as Record<string, string>,
  setDefaultUser: vi.fn(async () => {}),
}));

vi.mock("../useOsUsers", () => ({
  useOsUsers: () => ({ users: osUsersMock.users }),
}));

vi.mock("../useDefaultTerminalUsers", () => ({
  useDefaultTerminalUsers: () => ({
    defaultUsers: defaultTerminalUsersMock.defaultUsers,
    setDefaultUser: defaultTerminalUsersMock.setDefaultUser,
  }),
}));

beforeEach(() => {
  conn.state = "connected";
  conn.exited = false;
  vi.mocked(reconnectSession).mockClear();
  osUsersMock.users = [];
  defaultTerminalUsersMock.defaultUsers = {};
  defaultTerminalUsersMock.setDefaultUser = vi.fn(async () => {});
});

function makeSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: "s1",
    name: "claude-ch",
    project: "ch",
    cwd: "/tmp",
    pid: 1234,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderToolbar(overrides: Partial<Parameters<typeof TerminalToolbar>[0]> = {}) {
  const sessions = overrides.sessions ?? [makeSession()];
  const props = {
    sessions,
    focusedId: sessions[0]?.id ?? null,
    maximized: false,
    currentProject: "ch",
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

describe("TerminalToolbar — layout preset menu", () => {
  it("no longer renders terminal-toolbar-reset-layout, renders LayoutPresetMenu instead", () => {
    renderToolbar();

    expect(screen.queryByTestId("terminal-toolbar-reset-layout")).not.toBeInTheDocument();
    expect(screen.getByTestId("layout-preset-toggle")).toBeInTheDocument();
  });

  it("wires sessions.length and onApplyPreset into LayoutPresetMenu", () => {
    const onApplyPreset = vi.fn();
    const sessions = [makeSession({ id: "s1" }), makeSession({ id: "s2" }), makeSession({ id: "s3" })];
    renderToolbar({ sessions, onApplyPreset });

    fireEvent.click(screen.getByTestId("layout-preset-toggle"));
    fireEvent.click(screen.getByTestId("layout-preset-option-0"));

    expect(onApplyPreset).toHaveBeenCalledTimes(1);
    expect(onApplyPreset).toHaveBeenCalledWith([1, 2]);
  });
});

describe("TerminalToolbar — confirm close flow", () => {
  it("× click opens confirm modal and does NOT call onDelete", () => {
    const onDelete = vi.fn();
    renderToolbar({ onDelete });

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByTitle("Kill session")[0]);

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("× → Close button confirms and calls onDelete with session id", () => {
    const onDelete = vi.fn();
    const session = makeSession({ id: "abc-123", name: "claude-ch" });
    renderToolbar({ sessions: [session], focusedId: session.id, onDelete });

    fireEvent.click(screen.getAllByTitle("Kill session")[0]);
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("abc-123");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("× → Cancel closes modal without calling onDelete", () => {
    const onDelete = vi.fn();
    renderToolbar({ onDelete });

    fireEvent.click(screen.getAllByTitle("Kill session")[0]);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("TerminalToolbar — disconnected badge", () => {
  it("does not focus the session when the badge is activated", () => {
    conn.state = "disconnected";
    const session = makeSession({ id: "abc-123" });
    const { onFocus } = renderToolbar({ sessions: [session], focusedId: null });

    fireEvent.click(screen.getByTestId("terminal-disconnected-abc-123"));

    expect(reconnectSession).toHaveBeenCalledWith("abc-123");
    expect(onFocus).not.toHaveBeenCalled();
  });
});

describe("TerminalToolbar — project colour", () => {
  beforeEach(() => installProjectColors());

  const chipColor = (id: string) =>
    (screen.getByTestId(`terminal-toolbar-chip-${id}`) as HTMLElement).style
      .borderTopColor;

  it("all sessions of one project share its colour", async () => {
    const sessions = [
      makeSession({ id: "s1", project: "alpha" }),
      makeSession({ id: "s2", project: "alpha", name: "claude-alpha-2" }),
    ];
    renderToolbar({ sessions, focusedId: "s1", currentProject: "alpha" });

    await waitFor(() =>
      expect(chipColor("s1")).toBe(rgb(TEST_PROJECT_COLORS.alpha)),
    );
    // The unfocused chip carries the same colour: a global terminals view is
    // scanned by colour, so a chip that only shows one when focused shows none.
    expect(chipColor("s2")).toBe(rgb(TEST_PROJECT_COLORS.alpha));
  });

  it("sessions of different projects differ in colour", async () => {
    const sessions = [
      makeSession({ id: "s1", project: "alpha" }),
      makeSession({ id: "s2", project: "beta", name: "claude-beta" }),
    ];
    renderToolbar({ sessions, focusedId: "s1", currentProject: "alpha" });

    await waitFor(() =>
      expect(chipColor("s1")).toBe(rgb(TEST_PROJECT_COLORS.alpha)),
    );
    expect(chipColor("s2")).toBe(rgb(TEST_PROJECT_COLORS.beta));
    expect(chipColor("s1")).not.toBe(chipColor("s2"));
  });

  it("no longer offers a per-session colour picker", () => {
    const sessions = [makeSession({ id: "s1", project: "alpha" })];
    renderToolbar({ sessions, focusedId: "s1", currentProject: "alpha" });

    expect(screen.queryByTestId("terminal-toolbar-color-s1")).not.toBeInTheDocument();
  });
});

describe("TerminalToolbar — run-as-user dropdown", () => {
  beforeEach(() => {
    osUsersMock.users = [{ username: "greg" }, { username: "greg-ip" }];
    defaultTerminalUsersMock.defaultUsers = {};
    defaultTerminalUsersMock.setDefaultUser = vi.fn(async () => {});
  });

  it("chevron dropdown lists discovered OS users, not projects", () => {
    renderToolbar({ currentProject: "ch" });

    fireEvent.click(screen.getByTestId("terminal-toolbar-new-chevron"));

    expect(screen.getByText("Run new terminal as…")).toBeInTheDocument();
    expect(
      screen.getByTestId("terminal-toolbar-new-user-greg"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("terminal-toolbar-new-user-greg-ip"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("terminal-toolbar-new-project-ch"),
    ).not.toBeInTheDocument();
  });

  it("the project's stored default user's row is marked current", () => {
    defaultTerminalUsersMock.defaultUsers = { ch: "greg-ip" };
    renderToolbar({ currentProject: "ch" });

    fireEvent.click(screen.getByTestId("terminal-toolbar-new-chevron"));

    expect(
      within(screen.getByTestId("terminal-toolbar-new-user-greg-ip")).getByText(
        /default/i,
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("terminal-toolbar-new-user-greg")).queryByText(
        /default/i,
      ),
    ).not.toBeInTheDocument();
  });

  it("no row is marked current when the project has no stored default", () => {
    renderToolbar({ currentProject: "ch" });

    fireEvent.click(screen.getByTestId("terminal-toolbar-new-chevron"));

    expect(screen.queryByText(/default/i)).not.toBeInTheDocument();
  });

  it("clicking a user row sets the default and creates a session with that runAsUser", () => {
    const onCreate = vi.fn();
    renderToolbar({ currentProject: "ch", onCreate });

    fireEvent.click(screen.getByTestId("terminal-toolbar-new-chevron"));
    fireEvent.click(screen.getByTestId("terminal-toolbar-new-user-greg-ip"));

    expect(defaultTerminalUsersMock.setDefaultUser).toHaveBeenCalledWith(
      "ch",
      "greg-ip",
    );
    expect(onCreate).toHaveBeenCalledWith({ runAsUser: "greg-ip" });
    // Dropdown closed after the click.
    expect(
      screen.queryByTestId("terminal-toolbar-new-user-greg-ip"),
    ).not.toBeInTheDocument();
  });

  it("the bare + button creates a session without a runAsUser", () => {
    const onCreate = vi.fn();
    renderToolbar({ currentProject: "ch", onCreate });

    fireEvent.click(screen.getByTestId("terminal-toolbar-new"));

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith();
  });
});
