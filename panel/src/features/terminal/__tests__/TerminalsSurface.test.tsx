import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { useRef } from "react";
import { TerminalsSurface } from "../TerminalsSurface";
import type { TerminalHandle } from "../TerminalView";

const gridProps = vi.fn();
vi.mock("../TerminalToolbar", () => ({ TerminalToolbar: () => <div /> }));
vi.mock("../TerminalMobileRail", () => ({ TerminalMobileRail: () => <div /> }));
vi.mock("../TerminalSpine", () => ({ TerminalSpine: () => <div /> }));
vi.mock("../TerminalLayoutGrid", () => ({
  TerminalLayoutGrid: (props: Record<string, unknown>) => {
    gridProps(props);
    return <div data-testid="grid" />;
  },
}));
vi.mock("../TerminalShortcutBar", () => ({ TerminalShortcutBar: () => <div /> }));
vi.mock("../TerminalSpineDrawer", () => ({ TerminalSpineDrawer: () => <div /> }));

function Harness({
  columnSizes,
  onJoinColumn,
  onSplitColumn,
  onSwap,
}: {
  columnSizes?: number[];
  onJoinColumn?: (sessionId: string, targetId: string) => void;
  onSplitColumn?: (sessionId: string, gutterIndex: number) => void;
  onSwap?: (idA: string, idB: string) => void;
}) {
  const ref = useRef<Map<string, TerminalHandle>>(new Map());
  return (
    <TerminalsSurface
      currentProject="vector"
      projects={[]}
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
      onSwap={onSwap}
      columnSizes={columnSizes}
      onJoinColumn={onJoinColumn}
      onSplitColumn={onSplitColumn}
    />
  );
}

describe("TerminalsSurface", () => {
  it("passes columnSizes and join/split callbacks through to TerminalLayoutGrid", () => {
    const columnSizes = [1, 2];
    const onJoinColumn = vi.fn();
    const onSplitColumn = vi.fn();
    const onSwap = vi.fn();

    render(
      <Harness
        columnSizes={columnSizes}
        onJoinColumn={onJoinColumn}
        onSplitColumn={onSplitColumn}
        onSwap={onSwap}
      />,
    );

    const props = gridProps.mock.calls.at(-1)?.[0];
    expect(props.columnSizes).toBe(columnSizes);
    expect(props.onJoinColumn).toBe(onJoinColumn);
    expect(props.onSplitColumn).toBe(onSplitColumn);
    expect(props.onSwap).toBe(onSwap);
  });
});
