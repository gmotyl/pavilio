import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { useRef } from "react";
import { TerminalsSurface } from "../TerminalsSurface";
import type { TerminalHandle } from "../TerminalView";

vi.mock("../TerminalToolbar", () => ({ TerminalToolbar: () => <div /> }));
vi.mock("../TerminalMobileRail", () => ({ TerminalMobileRail: () => <div /> }));
vi.mock("../TerminalSpine", () => ({ TerminalSpine: () => <div /> }));
vi.mock("../TerminalLayoutGrid", () => ({ TerminalLayoutGrid: () => <div data-testid="grid" /> }));
vi.mock("../TerminalShortcutBar", () => ({ TerminalShortcutBar: () => <div /> }));
vi.mock("../TerminalSpineDrawer", () => ({ TerminalSpineDrawer: () => <div /> }));

function Harness({ fill }: { fill?: boolean }) {
  const ref = useRef<Map<string, TerminalHandle>>(new Map());
  return (
    <TerminalsSurface
      currentProject="vector"
      repos={[]}
      sessions={[]}
      focusedId={null}
      onFocus={() => {}}
      onDeleteSession={() => {}}
      onUpdateSession={() => {}}
      allSessions={[]}
      maximized={false}
      onToggleMaximize={() => {}}
      drawerOpen={false}
      onSetDrawerOpen={() => {}}
      terminalHandlesRef={ref}
      onCreateTerminal={() => {}}
      onNavTo={() => {}}
      fill={fill}
    />
  );
}

describe("TerminalsSurface fill mode", () => {
  it("uses h-full (not a viewport calc) when fill is set", () => {
    const { container } = render(<Harness fill />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("h-full");
    expect(root.className).not.toContain("100dvh");
  });

  it("keeps the viewport calc height when fill is not set", () => {
    const { container } = render(<Harness />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("100dvh");
  });
});
