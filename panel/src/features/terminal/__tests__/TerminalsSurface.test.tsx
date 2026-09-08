import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { useRef } from "react";
import { TerminalsSurface } from "../TerminalsSurface";
import type { LayoutPreset, TileLayout } from "../tileLayout";
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
  tiles,
  onPlace,
  onApplyPreset,
}: {
  tiles?: TileLayout;
  onPlace?: (layout: TileLayout) => void;
  onApplyPreset?: (preset: LayoutPreset) => void;
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
      tiles={tiles}
      onPlace={onPlace}
      onApplyPreset={onApplyPreset}
    />
  );
}

describe("TerminalsSurface", () => {
  it("passes the tiling and the placement callback through to TerminalLayoutGrid", () => {
    const tiles = [
      { sessionId: "a", x: 0, y: 0, w: 6, h: 12 },
      { sessionId: "b", x: 6, y: 0, w: 6, h: 12 },
    ];
    const onPlace = vi.fn();

    render(<Harness tiles={tiles} onPlace={onPlace} />);

    const props = gridProps.mock.calls.at(-1)?.[0];
    expect(props.tiles).toBe(tiles);
    expect(props.onPlace).toBe(onPlace);
  });

  it("wires sessions.length and onApplyPreset into the toolbar's LayoutPresetMenu", () => {
    const onApplyPreset = vi.fn();
    render(<Harness onApplyPreset={onApplyPreset} />);

    const props = toolbarProps.mock.calls.at(-1)?.[0];
    expect(props.sessions).toEqual([]);
    expect(props.onApplyPreset).toBe(onApplyPreset);
  });
});
