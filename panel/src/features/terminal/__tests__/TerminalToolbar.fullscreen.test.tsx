import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TerminalToolbar } from "../TerminalToolbar";
import type { SessionMeta } from "../useTerminalSessions";

vi.mock("../useTerminalConnection", () => ({
  useTerminalConnection: () => "connected",
}));
vi.mock("../useOsUsers", () => ({ useOsUsers: () => ({ users: [] }) }));
vi.mock("../useDefaultTerminalUsers", () => ({
  useDefaultTerminalUsers: () => ({ defaultUsers: {}, setDefaultUser: async () => {} }),
}));

const session: SessionMeta = {
  id: "t1",
  name: "dev",
  project: "vector",
  cwd: "/tmp",
  pid: 1,
  createdAt: "2026-11-14T00:00:00Z",
};

function renderToolbar(props: Partial<Parameters<typeof TerminalToolbar>[0]> = {}) {
  return render(
    <TerminalToolbar
      sessions={[session]}
      focusedId={session.id}
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

describe("TerminalToolbar — fullscreen control", () => {
  it("toolbar order is reconnect, fullscreen, maximise", () => {
    const onToggleFullscreen = vi.fn();
    renderToolbar({ onToggleFullscreen });

    const reconnect = screen.getByTestId("terminal-toolbar-reconnect");
    const group = Array.from(reconnect.parentElement!.children) as HTMLElement[];
    const at = group.indexOf(reconnect);
    // Adjacent, in this order (mockup check 5): ⟳ · ⛶ · ⤢/▦.
    expect(group.slice(at, at + 3).map((el) => el.dataset.testid)).toEqual([
      "terminal-toolbar-reconnect",
      "terminal-toolbar-fullscreen",
      "terminal-toolbar-maximize",
    ]);

    const fullscreen = screen.getByTestId("terminal-toolbar-fullscreen");
    expect(fullscreen).toHaveAccessibleName("Fullscreen terminal");
    expect(fullscreen).toHaveAttribute("aria-pressed", "false");
    // ⛶ — the corner brackets, not the maximise arrows.
    expect(fullscreen.querySelector("svg.lucide-maximize")).not.toBeNull();
    fireEvent.click(fullscreen);
    expect(onToggleFullscreen).toHaveBeenCalledTimes(1);
  });

  it("renders no fullscreen control when the surface offers none", () => {
    renderToolbar({ onToggleFullscreen: undefined });
    expect(screen.queryByTestId("terminal-toolbar-fullscreen")).toBeNull();
  });
});
