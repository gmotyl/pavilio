/**
 * Icon families for the two window toggles: fullscreen is the corner-bracket
 * pair (Maximize ↔ Minimize), maximise is arrows ↔ grid (Maximize2 ↔
 * LayoutGrid). Active toggles carry `is-active` (tinted background).
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { TerminalToolbar } from "../TerminalToolbar";
import { TerminalLayoutGrid } from "../TerminalLayoutGrid";
import type { SessionMeta } from "../useTerminalSessions";
import { INERT_SPEECH } from "./speech.harness";
import { installMatchMedia } from "../../../test-utils";

vi.mock("../useTerminalConnection", () => ({
  useTerminalConnection: () => "connected",
}));
vi.mock("../TerminalActivityLed", () => ({
  TerminalActivityLed: () => <span data-testid="activity-led" />,
}));
vi.mock("../TerminalView", () => ({
  TerminalView: ({ sessionId }: { sessionId: string }) => (
    <div data-testid={`terminal-view-${sessionId}`} />
  ),
}));
vi.mock("../useOsUsers", () => ({ useOsUsers: () => ({ users: [] }) }));
vi.mock("../useDefaultTerminalUsers", () => ({
  useDefaultTerminalUsers: () => ({ defaultUsers: {}, setDefaultUser: async () => {} }),
}));

beforeAll(() => installMatchMedia());

function makeSession(id: string): SessionMeta {
  return { id, name: id, project: "vector", cwd: "/tmp", pid: 1, createdAt: "2026-11-14T00:00:00Z" };
}

function renderToolbar(props: Partial<Parameters<typeof TerminalToolbar>[0]> = {}) {
  const s = makeSession("t1");
  return render(
    <TerminalToolbar
      sessions={[s]}
      focusedId={s.id}
      maximized={false}
      currentProject="vector"
      onFocus={vi.fn()}
      onCreate={vi.fn()}
      onDelete={vi.fn()}
      onRename={vi.fn()}
      onToggleMaximize={vi.fn()}
      onReorder={vi.fn()}
      onToggleFullscreen={vi.fn()}
      {...props}
    />,
  );
}

const icon = (el: HTMLElement, name: string) => el.querySelector(`svg.lucide-${name}`);

describe("TerminalToolbar — icon families", () => {
  it("toolbar fullscreen uses corner-bracket icons in both states", () => {
    const { rerender, unmount } = renderToolbar({ fullscreen: false });
    let btn = screen.getByTestId("terminal-toolbar-fullscreen");
    expect(icon(btn, "maximize")).not.toBeNull();
    unmount();
    renderToolbar({ fullscreen: true });
    btn = screen.getByTestId("terminal-toolbar-fullscreen");
    expect(icon(btn, "minimize")).not.toBeNull();
    expect(icon(btn, "minimize-2")).toBeNull();
    void rerender;
  });

  it("toolbar maximise uses arrows off and grid on", () => {
    const { unmount } = renderToolbar({ maximized: false });
    expect(icon(screen.getByTestId("terminal-toolbar-maximize"), "maximize-2")).not.toBeNull();
    unmount();
    renderToolbar({ maximized: true });
    expect(icon(screen.getByTestId("terminal-toolbar-maximize"), "layout-grid")).not.toBeNull();
  });

  it("active toggles carry is-active", () => {
    const { unmount } = renderToolbar({ maximized: false, fullscreen: false });
    expect(screen.getByTestId("terminal-toolbar-fullscreen")).not.toHaveClass("is-active");
    expect(screen.getByTestId("terminal-toolbar-maximize")).not.toHaveClass("is-active");
    unmount();
    renderToolbar({ maximized: true, fullscreen: true });
    expect(screen.getByTestId("terminal-toolbar-fullscreen")).toHaveClass("is-active");
    expect(screen.getByTestId("terminal-toolbar-maximize")).toHaveClass("is-active");
  });

  it("both on shows brackets and grid, never two arrow icons", () => {
    renderToolbar({ maximized: true, fullscreen: true });
    const fs = screen.getByTestId("terminal-toolbar-fullscreen");
    const mx = screen.getByTestId("terminal-toolbar-maximize");
    expect(icon(fs, "minimize")).not.toBeNull();
    expect(icon(mx, "layout-grid")).not.toBeNull();
    const arrows = [fs, mx].flatMap((b) =>
      Array.from(b.querySelectorAll("svg.lucide-maximize-2, svg.lucide-minimize-2")),
    );
    expect(arrows).toHaveLength(0);
  });

  it("cell header uses the same icon families", () => {
    const sessions = [makeSession("c-a"), makeSession("c-b")];
    const grid = (maximized: boolean, fullscreenCellId: string | null) => (
      <TerminalLayoutGrid
        sessions={sessions}
        focusedId="c-a"
        maximized={maximized}
        onFocus={vi.fn()}
        onExit={vi.fn()}
        speech={INERT_SPEECH}
        fullscreenCellId={fullscreenCellId}
        onToggleCellFullscreen={vi.fn()}
      />
    );
    const { unmount } = render(grid(false, null));
    let fs = screen.getByTestId("terminal-cell-fullscreen-c-a");
    let mx = screen.getByTestId("terminal-cell-maximise-c-a");
    expect(icon(fs, "maximize")).not.toBeNull();
    expect(icon(mx, "maximize-2")).not.toBeNull();
    expect(fs).not.toHaveClass("is-active");
    expect(mx).not.toHaveClass("is-active");
    unmount();

    render(grid(true, "c-a"));
    fs = screen.getByTestId("terminal-cell-fullscreen-c-a");
    mx = screen.getByTestId("terminal-cell-maximise-c-a");
    expect(icon(fs, "minimize")).not.toBeNull();
    expect(icon(fs, "minimize-2")).toBeNull();
    expect(icon(mx, "layout-grid")).not.toBeNull();
    expect(fs).toHaveClass("is-active");
    expect(mx).toHaveClass("is-active");
  });
});
