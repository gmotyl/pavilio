import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { TerminalsSurface } from "../TerminalsSurface";
import type { LayoutPreset, TileLayout } from "../tileLayout";
import type { TerminalHandle } from "../TerminalView";
import type { SessionMeta } from "../useTerminalSessions";
import { INERT_SPEECH } from "./speech.harness";
import { forgetAnswerPane, setAnswerPaneOpen } from "../answerPaneState";

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
const shortcutBarProps = vi.fn();
vi.mock("../TerminalShortcutBar", () => ({
  TerminalShortcutBar: (props: Record<string, unknown>) => {
    shortcutBarProps(props);
    return <div data-testid="shortcut-bar" />;
  },
}));
vi.mock("../TerminalSpineDrawer", () => ({ TerminalSpineDrawer: () => <div /> }));

function Harness({
  tiles,
  onPlace,
  onApplyPreset,
  focusedId = null,
  sessions = [],
  handles,
}: {
  tiles?: TileLayout;
  onPlace?: (layout: TileLayout) => void;
  onApplyPreset?: (preset: LayoutPreset) => void;
  focusedId?: string | null;
  sessions?: SessionMeta[];
  handles?: Map<string, TerminalHandle>;
}) {
  const ref = useRef<Map<string, TerminalHandle>>(handles ?? new Map());
  return (
    <TerminalsSurface
      currentProject="vector"
      repos={[]}
      sessions={sessions}
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

function session(id: string): SessionMeta {
  return { id, name: id, project: "vector", cwd: "/", pid: 1, createdAt: "" };
}

describe("TerminalsSurface shortcut bar visibility", () => {
  afterEach(() => {
    forgetAnswerPane("s1");
    forgetAnswerPane("s2");
    forgetAnswerPane("other");
  });

  it("the shortcut bar is absent while a visible session's answer pane is open", () => {
    setAnswerPaneOpen("s1", true);

    render(<Harness sessions={[session("s1"), session("s2")]} />);

    expect(screen.queryByTestId("shortcut-bar")).toBeNull();
  });

  it("the shortcut bar returns when the pane closes", () => {
    setAnswerPaneOpen("s1", true);

    const { rerender } = render(
      <Harness sessions={[session("s1"), session("s2")]} />,
    );
    expect(screen.queryByTestId("shortcut-bar")).toBeNull();

    setAnswerPaneOpen("s1", false);
    rerender(<Harness sessions={[session("s1"), session("s2")]} />);

    expect(screen.queryByTestId("shortcut-bar")).not.toBeNull();
  });

  it("another surface's open pane does not hide this surface's bar", () => {
    setAnswerPaneOpen("other", true);

    render(<Harness sessions={[session("s1"), session("s2")]} />);

    expect(screen.queryByTestId("shortcut-bar")).not.toBeNull();
  });

  // On mobile every session stays mounted and one is shown; a hidden session's
  // pane can auto-open when its agent answers, and must not take the bar away
  // from the terminal on screen.
  it("a pane open on a hidden session does not withhold the shortcut bar", () => {
    setAnswerPaneOpen("s2", true);

    render(
      <Harness focusedId="s1" sessions={[session("s1"), session("s2")]} />,
    );

    expect(screen.queryByTestId("shortcut-bar")).not.toBeNull();
  });

  it("the visible session's open pane withholds the bar and closing it brings it back", () => {
    setAnswerPaneOpen("s1", true);

    render(
      <Harness focusedId="s1" sessions={[session("s1"), session("s2")]} />,
    );
    expect(screen.queryByTestId("shortcut-bar")).toBeNull();

    act(() => setAnswerPaneOpen("s1", false));

    expect(screen.queryByTestId("shortcut-bar")).not.toBeNull();
  });

  it("switching onto a session with an open pane withholds the bar", () => {
    setAnswerPaneOpen("s2", true);
    const sessions = [session("s1"), session("s2")];

    const { rerender } = render(
      <Harness focusedId="s1" sessions={sessions} />,
    );
    expect(screen.queryByTestId("shortcut-bar")).not.toBeNull();

    rerender(<Harness focusedId="s2" sessions={sessions} />);
    expect(screen.queryByTestId("shortcut-bar")).toBeNull();

    rerender(<Harness focusedId="s1" sessions={sessions} />);
    expect(screen.queryByTestId("shortcut-bar")).not.toBeNull();
  });

  it("with nothing focused the first session's pane decides", () => {
    const sessions = [session("s1"), session("s2")];
    setAnswerPaneOpen("s1", true);

    const { rerender } = render(<Harness sessions={sessions} />);
    expect(screen.queryByTestId("shortcut-bar")).toBeNull();

    act(() => {
      setAnswerPaneOpen("s1", false);
      setAnswerPaneOpen("s2", true);
    });
    rerender(<Harness sessions={sessions} />);

    expect(screen.queryByTestId("shortcut-bar")).not.toBeNull();
  });

  it("the shortcut bar sends to the visible session when the stored focus is stale", () => {
    const handle = (id: string) => ({
      sessionId: id,
      send: vi.fn(),
      focus: vi.fn(),
      getBufferSnapshot: vi.fn(),
    });
    const s1 = handle("s1");
    const s2 = handle("s2");
    const gone = handle("gone");
    const handles = new Map<string, TerminalHandle>([
      ["s1", s1 as unknown as TerminalHandle],
      ["s2", s2 as unknown as TerminalHandle],
      ["gone", gone as unknown as TerminalHandle],
    ]);
    const sessions = [session("s1"), session("s2")];
    const bar = () =>
      shortcutBarProps.mock.calls.at(-1)![0] as {
        onSend: (data: string) => void;
        onToggleKeyboard: () => void;
      };

    const { rerender } = render(
      <Harness focusedId="gone" sessions={sessions} handles={handles} />,
    );
    bar().onSend("\x1b");
    bar().onToggleKeyboard();

    expect(s1.send).toHaveBeenCalledWith("\x1b");
    expect(s1.focus).toHaveBeenCalled();
    expect(gone.send).not.toHaveBeenCalled();
    expect(gone.focus).not.toHaveBeenCalled();

    rerender(<Harness focusedId="s2" sessions={sessions} handles={handles} />);
    bar().onSend("\t");

    expect(s2.send).toHaveBeenCalledWith("\t");
  });

  it("the shortcut bar sends nothing when there are no sessions", () => {
    const gone = {
      sessionId: "gone",
      send: vi.fn(),
      focus: vi.fn(),
      getBufferSnapshot: vi.fn(),
    };
    const handles = new Map<string, TerminalHandle>([
      ["gone", gone as unknown as TerminalHandle],
    ]);

    render(<Harness focusedId="gone" sessions={[]} handles={handles} />);
    const bar = shortcutBarProps.mock.calls.at(-1)![0] as {
      onSend: (data: string) => void;
      onToggleKeyboard: () => void;
    };

    expect(() => {
      bar.onSend("x");
      bar.onToggleKeyboard();
    }).not.toThrow();
    expect(gone.send).not.toHaveBeenCalled();
    expect(gone.focus).not.toHaveBeenCalled();
  });
});
