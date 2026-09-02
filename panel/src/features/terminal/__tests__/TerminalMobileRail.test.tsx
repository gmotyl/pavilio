import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ConnectionState } from "../terminalInstances";

// The rail's own dependencies are stubbed: what is under test is where the
// disconnected badge lands in this surface's markup, not activity plumbing.
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

vi.mock("../../favicon/useAggregateActivity", () => ({
  useAggregateActivity: () => "idle",
}));

import { TerminalMobileRail } from "../TerminalMobileRail";
import type { SessionMeta } from "../useTerminalSessions";
import {
  TEST_PROJECT_COLORS,
  installProjectColors,
  rgb,
} from "./projectColors.harness";

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

function renderRail(sessions: SessionMeta[] = [makeSession()]) {
  render(
    <TerminalMobileRail
      sessions={sessions}
      focusedId={sessions[0]?.id ?? null}
      currentProject={sessions[0]?.project ?? "ch"}
      onFocus={vi.fn()}
      onCreate={vi.fn()}
      onOpenDrawer={vi.fn()}
    />,
  );
}

beforeEach(() => {
  conn.state = "connected";
  conn.exited = false;
  installProjectColors();
});

describe("TerminalMobileRail — disconnected badge", () => {
  it("badges a disconnected session's pill", () => {
    conn.state = "disconnected";
    renderRail();

    // Present, and riding on the pill rather than nested inside that button
    // (the pill is itself a <button>, which cannot contain another one).
    const badge = screen.getByTestId("terminal-disconnected-s1");
    const pill = screen.getByTestId("terminal-mobile-rail-session-s1");
    expect(badge).toBeInTheDocument();
    expect(pill.contains(badge)).toBe(false);
    expect(pill.parentElement?.contains(badge)).toBe(true);
  });

  it("shows nothing on a healthy pill", () => {
    renderRail();

    expect(
      screen.queryByTestId("terminal-disconnected-s1"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("terminal-mobile-rail-session-s1"),
    ).toBeInTheDocument();
  });
});

describe("TerminalMobileRail — project colour", () => {
  it("rings the active pill in its project's colour", async () => {
    renderRail([makeSession({ id: "s1", project: "beta" })]);

    const pill = screen.getByTestId("terminal-mobile-rail-session-s1");
    await waitFor(() =>
      expect((pill as HTMLElement).style.borderTopColor).toBe(
        rgb(TEST_PROJECT_COLORS.beta),
      ),
    );
  });
});
