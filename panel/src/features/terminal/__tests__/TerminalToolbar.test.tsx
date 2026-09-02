import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TerminalToolbar } from "../TerminalToolbar";
import type { SessionMeta } from "../useTerminalSessions";
import type { ConnectionState } from "../terminalInstances";
import { reconnectSession } from "../terminalInstances";

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

beforeEach(() => {
  conn.state = "connected";
  conn.exited = false;
  vi.mocked(reconnectSession).mockClear();
});

function makeSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: "s1",
    name: "claude-ch",
    color: null,
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
    projects: [{ name: "ch" }],
    repos: [],
    onFocus: vi.fn(),
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    onColorChange: vi.fn(),
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
