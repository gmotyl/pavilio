import { beforeEach, describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { useRef } from "react";
import { TerminalsSurface } from "../TerminalsSurface";
import type { LayoutPreset, TileLayout } from "../tileLayout";
import type { TerminalHandle } from "../TerminalView";
import { INERT_SPEECH } from "./speech.harness";

const gridProps = vi.fn();
const toolbarProps = vi.fn();
vi.mock("../TerminalToolbar", () => ({
  TerminalToolbar: (props: Record<string, unknown>) => {
    toolbarProps(props);
    return <div />;
  },
}));
const railProps = vi.fn();
vi.mock("../TerminalMobileRail", () => ({
  TerminalMobileRail: (props: Record<string, unknown>) => {
    railProps(props);
    return <div />;
  },
}));

// The pool is the unit under test elsewhere; here we only assert the surface
// routes each gesture to the right entry point.
const sendDismiss = vi.fn();
const reconnectOnActivate = vi.fn();
const reconnectSession = vi.fn();
const reconnectAllDisconnected = vi.fn(() => 0);
vi.mock("../terminalInstances", () => ({
  sendDismiss: (id: string) => sendDismiss(id),
  reconnectOnActivate: (id: string) => reconnectOnActivate(id),
  reconnectSession: (id: string, trigger?: string) =>
    reconnectSession(id, trigger),
  reconnectAllDisconnected: () => reconnectAllDisconnected(),
}));
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
  focusedId = null,
}: {
  tiles?: TileLayout;
  onPlace?: (layout: TileLayout) => void;
  onApplyPreset?: (preset: LayoutPreset) => void;
  focusedId?: string | null;
}) {
  const ref = useRef<Map<string, TerminalHandle>>(new Map());
  return (
    <TerminalsSurface
      currentProject="vector"
      repos={[]}
      sessions={[]}
      focusedId={focusedId}
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
      speech={INERT_SPEECH}
    />
  );
}

describe("TerminalsSurface", () => {
  it("passes the tiling and the placement callback through to TerminalLayoutGrid", () => {
    const tiles = [
      { sessionId: "a", x: 0, y: 0, w: 24, h: 48 },
      { sessionId: "b", x: 24, y: 0, w: 24, h: 48 },
    ];
    const onPlace = vi.fn();

    render(<Harness tiles={tiles} onPlace={onPlace} />);

    const props = gridProps.mock.calls.at(-1)?.[0];
    expect(props.tiles).toBe(tiles);
    expect(props.onPlace).toBe(onPlace);
  });

  // The surface used to hand the same `onToggleMaximize` to both children, and
  // the cell button that used it toggled the toolbar's own surface-wide flag.
  // The cell button is gone; the toolbar's path must be untouched.
  it("hands the maximize callback to the toolbar only", () => {
    render(<Harness />);

    const toolbar = toolbarProps.mock.calls.at(-1)?.[0];
    const grid = gridProps.mock.calls.at(-1)?.[0];
    expect(typeof toolbar.onToggleMaximize).toBe("function");
    expect(toolbar.maximized).toBe(false);
    expect(grid.maximized).toBe(false);
    expect("onToggleMaximize" in grid).toBe(false);
  });

  it("wires sessions.length and onApplyPreset into the toolbar's LayoutPresetMenu", () => {
    const onApplyPreset = vi.fn();
    render(<Harness onApplyPreset={onApplyPreset} />);

    const props = toolbarProps.mock.calls.at(-1)?.[0];
    expect(props.sessions).toEqual([]);
    expect(props.onApplyPreset).toBe(onApplyPreset);
  });
});

describe("TerminalsSurface reconnect wiring", () => {
  beforeEach(() => {
    sendDismiss.mockClear();
    reconnectOnActivate.mockClear();
    reconnectSession.mockClear();
    reconnectAllDisconnected.mockClear();
    reconnectAllDisconnected.mockReturnValue(0);
    gridProps.mockClear();
    toolbarProps.mockClear();
    railProps.mockClear();
  });

  /** The onFocus every surface is handed — TerminalsSurface's handleFocus. */
  function handleFocus(): (id: string | null) => void {
    return gridProps.mock.calls.at(-1)![0].onFocus as (
      id: string | null,
    ) => void;
  }

  it("focusing a disconnected session reconnects it", () => {
    render(<Harness />);

    handleFocus()("s1");

    // The pool's own guard decides; the surface asks unconditionally, after
    // the attention LED is dismissed as before.
    expect(sendDismiss).toHaveBeenCalledWith("s1");
    expect(reconnectOnActivate).toHaveBeenCalledWith("s1");
  });

  it("focusing a connected session does not reconnect", () => {
    // Guarded in the pool, so the surface's contract is only that it asks with
    // the id it focused — never that it reconnects something else.
    render(<Harness />);

    handleFocus()("s2");

    expect(reconnectOnActivate).toHaveBeenCalledTimes(1);
    expect(reconnectOnActivate).toHaveBeenCalledWith("s2");
    expect(reconnectSession).not.toHaveBeenCalled();
  });

  it("clearing focus does not reconnect", () => {
    render(<Harness />);

    handleFocus()(null);

    expect(reconnectOnActivate).not.toHaveBeenCalled();
    expect(sendDismiss).not.toHaveBeenCalled();
  });

  it("the Reconnect control reconnects every disconnected session", () => {
    reconnectAllDisconnected.mockReturnValue(2);
    render(<Harness focusedId="s1" />);

    (toolbarProps.mock.calls.at(-1)![0].onReconnect as () => void)();

    expect(reconnectAllDisconnected).toHaveBeenCalledTimes(1);
    // The focused session is already in the fan-out — reconnecting it again
    // would double its log line.
    expect(reconnectSession).not.toHaveBeenCalled();
  });

  it("the Reconnect control falls back to the focused session when nothing is disconnected", () => {
    render(<Harness focusedId="s1" />);

    (toolbarProps.mock.calls.at(-1)![0].onReconnect as () => void)();

    expect(reconnectAllDisconnected).toHaveBeenCalledTimes(1);
    expect(reconnectSession).toHaveBeenCalledWith("s1", undefined);
  });

  it("the mobile rail Reconnect uses the same fan-out", () => {
    reconnectAllDisconnected.mockReturnValue(3);
    render(<Harness focusedId="s1" />);

    (railProps.mock.calls.at(-1)![0].onReconnect as () => void)();

    expect(reconnectAllDisconnected).toHaveBeenCalledTimes(1);
    expect(reconnectSession).not.toHaveBeenCalled();
  });
});
