import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ConnectionState } from "../terminalInstances";

// The badge is deliberately self-contained: it reads connection state through
// `useTerminalConnection` and exit state / recovery through `terminalInstances`.
// Both are stubbed here so the badge's own rule (`disconnected` AND not exited)
// is the only thing under test — the store's transitions have their own suite.
const stub = vi.hoisted(() => ({
  state: "connected" as ConnectionState,
  exited: false,
}));

vi.mock("../useTerminalConnection", () => ({
  useTerminalConnection: () => stub.state,
}));

vi.mock("../terminalInstances", () => ({
  hasExited: () => stub.exited,
  reconnectSession: vi.fn(),
}));

import { TerminalDisconnectedBadge } from "../TerminalDisconnectedBadge";
import { reconnectSession } from "../terminalInstances";

const reconnectMock = vi.mocked(reconnectSession);

beforeEach(() => {
  stub.state = "connected";
  stub.exited = false;
  reconnectMock.mockClear();
});

describe("TerminalDisconnectedBadge", () => {
  it("renders nothing while connected", () => {
    stub.state = "connected";
    render(<TerminalDisconnectedBadge sessionId="s1" />);

    expect(screen.queryByTestId("terminal-disconnected-s1")).not.toBeInTheDocument();
  });

  it("renders nothing for a session with no terminal in this browser", () => {
    stub.state = "unattached";
    render(<TerminalDisconnectedBadge sessionId="s1" />);

    expect(screen.queryByTestId("terminal-disconnected-s1")).not.toBeInTheDocument();
  });

  it("renders nothing when the process exited normally", () => {
    stub.state = "disconnected";
    stub.exited = true;
    render(<TerminalDisconnectedBadge sessionId="s1" />);

    expect(screen.queryByTestId("terminal-disconnected-s1")).not.toBeInTheDocument();
  });

  it("renders a warning affordance when disconnected", () => {
    stub.state = "disconnected";
    render(<TerminalDisconnectedBadge sessionId="s1" />);

    const badge = screen.getByTestId("terminal-disconnected-s1");
    expect(badge).toBeInTheDocument();
    expect(badge.tagName).toBe("BUTTON");
    expect(badge).toHaveAccessibleName(/disconnected/i);
  });

  it("reconnects the session when activated", () => {
    stub.state = "disconnected";
    render(<TerminalDisconnectedBadge sessionId="abc-123" />);

    fireEvent.click(screen.getByTestId("terminal-disconnected-abc-123"));

    expect(reconnectMock).toHaveBeenCalledTimes(1);
    expect(reconnectMock).toHaveBeenCalledWith("abc-123");
  });

  it("clears without remounting the surrounding surface when the session reconnects", () => {
    stub.state = "disconnected";

    function Host() {
      const [, bump] = useState(0);
      return (
        <div data-testid="host">
          <TerminalDisconnectedBadge sessionId="s1" />
          <button type="button" data-testid="rerender" onClick={() => bump((n) => n + 1)}>
            rerender
          </button>
        </div>
      );
    }

    render(<Host />);
    const host = screen.getByTestId("host");
    expect(screen.getByTestId("terminal-disconnected-s1")).toBeInTheDocument();

    stub.state = "connected";
    fireEvent.click(screen.getByTestId("rerender"));

    expect(screen.queryByTestId("terminal-disconnected-s1")).not.toBeInTheDocument();
    // Same DOM node: the host surface re-rendered, it did not remount.
    expect(screen.getByTestId("host")).toBe(host);
  });
});
