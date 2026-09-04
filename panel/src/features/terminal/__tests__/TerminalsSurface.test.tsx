import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { useRef } from "react";
import { TerminalsSurface } from "../TerminalsSurface";
import type { TerminalHandle } from "../TerminalView";

const gridProps = vi.fn();
const toolbarProps = vi.fn();
vi.mock("../TerminalToolbar", () => ({
  TerminalToolbar: (props: Record<string, unknown>) => {
    toolbarProps(props);
    return <div />;
  },
}));
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
  columnLayout,
  onMergeColumn,
  onJoinColumn,
  onSplitColumn,
  onSwap,
  onApplyPreset,
}: {
  columnLayout?: { sessionId: string; weight: number }[][];
  onMergeColumn?: (sessionId: string, targetId: string) => void;
  onJoinColumn?: (sessionId: string, targetId: string) => void;
  onSplitColumn?: (sessionId: string, gutterIndex: number) => void;
  onSwap?: (idA: string, idB: string) => void;
  onApplyPreset?: (sizes: number[]) => void;
}) {
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
      onSwap={onSwap}
      columnLayout={columnLayout}
      onMergeColumn={onMergeColumn}
      onJoinColumn={onJoinColumn}
      onSplitColumn={onSplitColumn}
      onApplyPreset={onApplyPreset}
    />
  );
}

describe("TerminalsSurface", () => {
  it("passes columnLayout and onMergeColumn through to TerminalLayoutGrid", () => {
    const columnLayout = [[{ sessionId: "a", weight: 1 }], [{ sessionId: "b", weight: 2 }]];
    const onMergeColumn = vi.fn();
    const onJoinColumn = vi.fn();
    const onSplitColumn = vi.fn();
    const onSwap = vi.fn();

    render(
      <Harness
        columnLayout={columnLayout}
        onMergeColumn={onMergeColumn}
        onJoinColumn={onJoinColumn}
        onSplitColumn={onSplitColumn}
        onSwap={onSwap}
      />,
    );

    const props = gridProps.mock.calls.at(-1)?.[0];
    expect(props.columnLayout).toBe(columnLayout);
    expect(props.onMergeColumn).toBe(onMergeColumn);
    expect(props.onJoinColumn).toBe(onJoinColumn);
    expect(props.onSplitColumn).toBe(onSplitColumn);
    expect(props.onSwap).toBe(onSwap);
  });

  it("wires sessions.length and onApplyPreset into the toolbar's LayoutPresetMenu", () => {
    const onApplyPreset = vi.fn();
    render(<Harness onApplyPreset={onApplyPreset} />);

    const props = toolbarProps.mock.calls.at(-1)?.[0];
    expect(props.sessions).toEqual([]);
    expect(props.onApplyPreset).toBe(onApplyPreset);
  });
});
