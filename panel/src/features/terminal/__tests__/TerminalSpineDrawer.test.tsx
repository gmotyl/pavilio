import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ConnectionState } from "../terminalInstances";

// Same stubs as the rail's suite: the drawer's row markup is what is pinned
// here, not the store behind the badge.
const conn = vi.hoisted(() => ({
  state: "connected" as ConnectionState,
  exited: false,
}));

vi.mock("../useTerminalConnection", () => ({
  useTerminalConnection: () => conn.state,
}));

vi.mock("../terminalInstances", () => ({
  hasExited: () => conn.exited,
  reconnectSession: vi.fn(),
}));

vi.mock("../TerminalActivityLed", () => ({
  TerminalActivityLed: () => <span data-testid="activity-led" />,
}));

import { TerminalSpineDrawer } from "../TerminalSpineDrawer";
import type { SessionMeta } from "../useTerminalSessions";

function makeSession(): SessionMeta {
  return {
    id: "s1",
    name: "claude-ch",
    project: "ch",
    cwd: "/tmp",
    pid: 1234,
    createdAt: new Date().toISOString(),
  };
}

function renderDrawer() {
  render(
    <MemoryRouter>
      <TerminalSpineDrawer
        sessions={[makeSession()]}
        focusedId="s1"
        currentProject="ch"
        onFocus={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  conn.state = "connected";
  conn.exited = false;
});

describe("TerminalSpineDrawer — disconnected badge", () => {
  it("badges a disconnected session's row", () => {
    conn.state = "disconnected";
    renderDrawer();

    // Beside the row button, not inside it (the row is itself a <button>),
    // and both are children of the same row.
    const badge = screen.getByTestId("terminal-disconnected-s1");
    const row = screen.getByTestId("terminal-spine-drawer-session-s1");
    expect(badge).toBeInTheDocument();
    expect(row.contains(badge)).toBe(false);
    expect(badge.parentElement).toBe(row.parentElement);
  });

  it("shows nothing on a healthy row", () => {
    renderDrawer();

    expect(
      screen.queryByTestId("terminal-disconnected-s1"),
    ).not.toBeInTheDocument();
    // ...and the row is then the only child, so it keeps the full width.
    const row = screen.getByTestId("terminal-spine-drawer-session-s1");
    expect(row.parentElement?.childElementCount).toBe(1);
  });
});
