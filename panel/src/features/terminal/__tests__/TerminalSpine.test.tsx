import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { TerminalSpine } from "../TerminalSpine";
import type { SessionMeta } from "../useTerminalSessions";
import {
  TEST_PROJECT_COLORS,
  installProjectColors,
  rgb,
} from "./projectColors.harness";

function makeSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: "s1",
    name: "claude-alpha",
    project: "alpha",
    cwd: "/tmp",
    pid: 1234,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function barColor(id: string): string {
  return (screen.getByTestId(`terminal-spine-session-${id}`) as HTMLElement).style
    .background;
}

describe("TerminalSpine — project colour", () => {
  beforeEach(() => installProjectColors());

  it("all sessions of one project share its colour", async () => {
    const sessions = [
      makeSession({ id: "s1" }),
      makeSession({ id: "s2", name: "claude-alpha-2" }),
      makeSession({ id: "s3", name: "claude-alpha-3" }),
    ];
    render(
      <TerminalSpine
        sessions={sessions}
        focusedId="s1"
        onFocus={() => {}}
        onOpenDrawer={() => {}}
      />,
    );

    await waitFor(() => expect(barColor("s1")).toBe(rgb(TEST_PROJECT_COLORS.alpha)));
    expect(barColor("s2")).toBe(rgb(TEST_PROJECT_COLORS.alpha));
    expect(barColor("s3")).toBe(rgb(TEST_PROJECT_COLORS.alpha));
  });

  it("sessions of different projects differ in colour", async () => {
    const sessions = [
      makeSession({ id: "s1", project: "alpha" }),
      makeSession({ id: "s2", project: "beta" }),
    ];
    render(
      <TerminalSpine
        sessions={sessions}
        focusedId="s1"
        onFocus={() => {}}
        onOpenDrawer={() => {}}
      />,
    );

    await waitFor(() => expect(barColor("s1")).toBe(rgb(TEST_PROJECT_COLORS.alpha)));
    expect(barColor("s2")).toBe(rgb(TEST_PROJECT_COLORS.beta));
    expect(barColor("s1")).not.toBe(barColor("s2"));
  });
});
