import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { useState } from "react";
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

// Per-session activity for the minimised aggregate. The real flags hook is
// replaced so a test can say "this minimised session needs attention" without
// driving the activity channel.
const activityOf = vi.hoisted(() => new Map<string, "idle" | "busy" | "attention">());

vi.mock("../useTerminalActivityChannel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../useTerminalActivityChannel")>()),
  useAggregateActivityFlags: (ids: readonly string[]) => ({
    hasBusy: ids.some((id) => activityOf.get(id) === "busy"),
    hasAttention: ids.some((id) => activityOf.get(id) === "attention"),
    hasAny: ids.length > 0,
    attentionSinceAt: null,
  }),
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

function renderRail(
  sessions: SessionMeta[] = [makeSession()],
  focusedId: string | null = sessions[0]?.id ?? null,
) {
  render(
    <TerminalMobileRail
      sessions={sessions}
      focusedId={focusedId}
      currentProject={sessions[0]?.project ?? "ch"}
      onFocus={vi.fn()}
      onCreate={vi.fn()}
    />,
  );
}

beforeEach(() => {
  activityOf.clear();
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

  it("rings an unselected dot in its project's colour", async () => {
    renderRail(
      [
        makeSession({ id: "s1", project: "alpha" }),
        makeSession({ id: "s2", project: "beta", name: "claude-beta" }),
        makeSession({ id: "s3", project: "alpha", name: "claude-alpha-2" }),
      ],
      "s1",
    );

    const dot = (id: string) =>
      screen.getByTestId(`terminal-mobile-rail-session-${id}`) as HTMLElement;

    await waitFor(() =>
      expect(dot("s2").style.borderTopColor).toBe(rgb(TEST_PROJECT_COLORS.beta)),
    );
    expect(dot("s3").style.borderTopColor).toBe(rgb(TEST_PROJECT_COLORS.alpha));
    expect(dot("s2").style.borderTopColor).not.toBe(dot("s3").style.borderTopColor);

    // Thickness is the point: at 28px a 1px ring of two nearby presets is
    // indistinguishable, so the unselected ring is deliberately heavier.
    expect(dot("s2").style.borderTopWidth).toBe("2px");
    expect(dot("s3").style.borderTopWidth).toBe("2px");

    // The ring says which project; the LED still says what the session is
    // doing. They stay orthogonal.
    expect(dot("s2").querySelector('[data-testid="activity-led"]')).toBeTruthy();
    expect(dot("s3").querySelector('[data-testid="activity-led"]')).toBeTruthy();
  });
});

describe("TerminalMobileRail — minimised aggregate", () => {
  const three = () => [
    makeSession({ id: "s1", project: "alpha", name: "claude-alpha" }),
    makeSession({ id: "s2", project: "beta", name: "claude-beta" }),
    makeSession({ id: "s3", project: "alpha", name: "claude-alpha-2" }),
  ];

  /** The rail with live minimised state: restoring removes the id, as TerminalsSurface does. */
  function StatefulRail({
    sessions,
    initial,
    onRestore,
  }: {
    sessions: SessionMeta[];
    initial: string[];
    onRestore: (id: string) => void;
  }) {
    const [minimised, setMinimised] = useState(initial);
    const [focused, setFocused] = useState(sessions[0].id);
    return (
      <TerminalMobileRail
        sessions={sessions}
        focusedId={focused}
        currentProject="alpha"
        onFocus={vi.fn()}
        onCreate={vi.fn()}
        onReconnect={vi.fn()}
        minimisedIds={minimised}
        onRestore={(id) => {
          onRestore(id);
          setMinimised((m) => m.filter((x) => x !== id));
          setFocused(id);
        }}
      />
    );
  }

  /** testids of the rail's direct-ish items, in DOM order. */
  function railOrder(): string[] {
    const rail = screen.getByTestId("terminal-mobile-rail");
    return Array.from(rail.querySelectorAll("[data-testid]"))
      .map((el) => el.getAttribute("data-testid")!)
      .filter(
        (id) => id.startsWith("terminal-mobile-rail-") && !id.endsWith("-led"),
      );
  }

  it("minimised sessions leave the rail dots for the aggregate", () => {
    render(
      <StatefulRail sessions={three()} initial={["s2", "s3"]} onRestore={vi.fn()} />,
    );

    // Visible sessions only: the current chip stays, minimised dots are gone.
    expect(screen.getByTestId("terminal-mobile-rail-session-s1")).toBeInTheDocument();
    expect(screen.queryByTestId("terminal-mobile-rail-session-s2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("terminal-mobile-rail-session-s3")).not.toBeInTheDocument();

    const agg = screen.getByTestId("terminal-mobile-rail-minimised");
    expect(agg).toHaveTextContent("▁ 2");
    expect(agg).toHaveAccessibleName(/2 minimised terminals/i);

    // Mockup order: chip and dots, "+", then the aggregate and Reconnect.
    expect(railOrder()).toEqual([
      "terminal-mobile-rail-session-s1",
      "terminal-mobile-rail-new",
      "terminal-mobile-rail-minimised",
      "terminal-mobile-rail-reconnect",
    ]);
  });

  // Mockup S: the rail without its ☰ — the global corner ☰ is the one menu.
  it("mobile rail has no menu button", () => {
    render(
      <StatefulRail sessions={three()} initial={["s3"]} onRestore={vi.fn()} />,
    );

    // Pills and dots, the minimised aggregate and the new-terminal button stay.
    expect(screen.getByTestId("terminal-mobile-rail-session-s1")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-mobile-rail-session-s2")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-mobile-rail-minimised")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-mobile-rail-new")).toBeInTheDocument();

    // No menu button of any kind.
    const rail = screen.getByTestId("terminal-mobile-rail");
    expect(screen.queryByTestId("terminal-mobile-rail-drawer")).not.toBeInTheDocument();
    expect(within(rail).queryByTitle("All terminals")).not.toBeInTheDocument();
    expect(rail.querySelector("svg.lucide-menu")).toBeNull();
  });

  it("no aggregate when nothing is minimised", () => {
    render(<StatefulRail sessions={three()} initial={[]} onRestore={vi.fn()} />);

    expect(screen.queryByTestId("terminal-mobile-rail-minimised")).not.toBeInTheDocument();
    expect(screen.queryByText(/▁/)).not.toBeInTheDocument();
    for (const id of ["s1", "s2", "s3"]) {
      expect(screen.getByTestId(`terminal-mobile-rail-session-${id}`)).toBeInTheDocument();
    }
  });

  it("choosing a session in the aggregate restores and shows it", () => {
    const onRestore = vi.fn();
    render(
      <StatefulRail sessions={three()} initial={["s2", "s3"]} onRestore={onRestore} />,
    );

    fireEvent.click(screen.getByTestId("terminal-mobile-rail-minimised"));
    const menu = screen.getByRole("menu", { name: /minimised terminals/i });
    const items = within(menu).getAllByRole("menuitem");
    expect(items).toHaveLength(2);

    // Each entry carries the project mark, the activity LED and the label.
    const beta = within(menu).getByRole("menuitem", { name: /claude-beta/ });
    expect(within(beta).getByTestId("project-mark")).toBeInTheDocument();
    expect(within(beta).getByTestId("activity-led")).toBeInTheDocument();

    fireEvent.click(beta);
    expect(onRestore).toHaveBeenCalledWith("s2");

    // The session is back on the rail as the visible chip; the menu closed.
    const pill = screen.getByTestId("terminal-mobile-rail-session-s2");
    expect(pill).toHaveTextContent(/beta/);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByTestId("terminal-mobile-rail-minimised")).toHaveTextContent("▁ 1");
  });

  it("visible session's state does not leak into the aggregate", () => {
    // The loudest state on the visible chip; every minimised session is idle.
    activityOf.set("s1", "attention");
    activityOf.set("s2", "idle");
    activityOf.set("s3", "idle");
    render(
      <StatefulRail sessions={three()} initial={["s2", "s3"]} onRestore={vi.fn()} />,
    );

    expect(screen.getByTestId("terminal-mobile-rail-minimised-led")).toHaveAttribute(
      "data-state",
      "idle",
    );
  });

  it("aggregate dot shows attention from a minimised session", () => {
    activityOf.set("s2", "busy");
    activityOf.set("s3", "attention");
    const { unmount } = render(
      <StatefulRail sessions={three()} initial={["s2", "s3"]} onRestore={vi.fn()} />,
    );

    const dot = screen.getByTestId("terminal-mobile-rail-minimised-led");
    expect(dot).toHaveAttribute("data-state", "attention");
    unmount();

    // Busy beats idle when nobody needs attention.
    activityOf.set("s3", "idle");
    render(
      <StatefulRail sessions={three()} initial={["s2", "s3"]} onRestore={vi.fn()} />,
    );
    expect(screen.getByTestId("terminal-mobile-rail-minimised-led")).toHaveAttribute(
      "data-state",
      "busy",
    );
  });
});
