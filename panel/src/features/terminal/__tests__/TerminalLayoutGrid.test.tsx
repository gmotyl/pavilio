import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { TerminalLayoutGrid } from "../TerminalLayoutGrid";
import type { SessionMeta } from "../useTerminalSessions";
import { getLayoutPresets, expandPreset, type TileLayout } from "../tileLayout";
import type { ConnectionState } from "../terminalInstances";
import { reconnectSession } from "../terminalInstances";
import { useTerminalOrdering } from "../useTerminalOrdering";
import {
  TEST_PROJECT_COLORS,
  installProjectColors,
  rgb,
} from "./projectColors.harness";

// Connection state is per-browser and lives in the terminal instance pool.
// Stub the two leaf reads the disconnected badge makes so a cell can be put
// into the disconnected state without standing up a socket.
const conn = vi.hoisted(() => ({
  state: "connected" as ConnectionState,
  exited: false,
}));

vi.mock("../useTerminalConnection", () => ({
  useTerminalConnection: () => conn.state,
}));

vi.mock("../terminalInstances", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../terminalInstances")>();
  return {
    ...actual,
    hasExited: () => conn.exited,
    reconnectSession: vi.fn(),
  };
});

beforeEach(() => {
  conn.state = "connected";
  conn.exited = false;
  vi.mocked(reconnectSession).mockClear();
});

// TerminalView pulls in xterm which cannot render in jsdom; stub it.
// The stub also calls onReady with a fake handle that returns a one-line
// snapshot, so the Eye button (which depends on getBufferSnapshot) can
// be exercised in tests without xterm.
vi.mock("../TerminalView", async () => {
  const React = await import("react");
  return {
    TerminalView: ({
      sessionId,
      onReady,
    }: {
      sessionId: string;
      onReady?: (h: {
        sessionId: string;
        send: (d: string) => void;
        focus: () => void;
        getBufferSnapshot: () => unknown;
      }) => void;
    }) => {
      React.useEffect(() => {
        onReady?.({
          sessionId,
          send: () => {},
          focus: () => {},
          getBufferSnapshot: () => ({
            lines: [[{ text: "hello" }]],
            viewportTopIndex: 0,
            viewportBottomIndex: 0,
            pageSize: 1,
            pixelWidth: 600,
            fontSize: 13,
            defaultFg: "#fff",
            defaultBg: "#000",
          }),
        });
      }, [sessionId]);
      return <div data-testid={`terminal-view-${sessionId}`} />;
    },
  };
});

// TerminalActivityLed reads activity state — stub to keep tests focused.
vi.mock("../TerminalActivityLed", () => ({
  TerminalActivityLed: () => <span data-testid="activity-led" />,
}));

beforeAll(() => {
  // jsdom does not implement matchMedia
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      }),
    });
  }
});

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

function renderGrid(
  overrides: Partial<Parameters<typeof TerminalLayoutGrid>[0]> = {},
) {
  const sessions = overrides.sessions ?? [makeSession()];
  const props = {
    sessions,
    focusedId: sessions[0]?.id ?? null,
    maximized: false,
    onFocus: vi.fn(),
    onExit: vi.fn(),
    onToggleMaximize: vi.fn(),
    onReady: vi.fn(),
    onPlace: vi.fn(),
    ...overrides,
  };
  const result = render(<TerminalLayoutGrid {...props} />);
  return { ...props, ...result };
}

describe("TerminalLayoutGrid — confirm close flow", () => {
  it("× click opens confirm modal and does NOT call onExit", () => {
    const onExit = vi.fn();
    renderGrid({ onExit });

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByTitle("Kill session")[0]);

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(onExit).not.toHaveBeenCalled();
  });

  it("× → Close button confirms and calls onExit with session id", () => {
    const onExit = vi.fn();
    const session = makeSession({ id: "abc-123", name: "claude-ch" });
    renderGrid({ sessions: [session], focusedId: session.id, onExit });

    fireEvent.click(screen.getAllByTitle("Kill session")[0]);
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith("abc-123");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("× → Cancel closes modal without calling onExit", () => {
    const onExit = vi.fn();
    renderGrid({ onExit });

    fireEvent.click(screen.getAllByTitle("Kill session")[0]);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onExit).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("TerminalLayoutGrid — viewport reader (Eye button + Cmd/Ctrl+U)", () => {
  it("clicking the Eye button opens the viewport modal", () => {
    const session = makeSession({ id: "s-eye-click" });
    renderGrid({ sessions: [session], focusedId: session.id });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`terminal-cell-eye-${session.id}`));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Cmd+U on the focused cell opens the viewport modal", () => {
    const session = makeSession({ id: "s-cmd-u" });
    renderGrid({ sessions: [session], focusedId: session.id });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "u", metaKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Ctrl+U on the focused cell opens the viewport modal", () => {
    const session = makeSession({ id: "s-ctrl-u" });
    renderGrid({ sessions: [session], focusedId: session.id });

    fireEvent.keyDown(window, { key: "u", ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("plain U (no modifier) does NOT open the modal", () => {
    const session = makeSession({ id: "s-plain-u" });
    renderGrid({ sessions: [session], focusedId: session.id });

    fireEvent.keyDown(window, { key: "u" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Cmd+Shift+U is ignored (modifier set must be exact)", () => {
    const session = makeSession({ id: "s-shift-u" });
    renderGrid({ sessions: [session], focusedId: session.id });

    fireEvent.keyDown(window, { key: "u", metaKey: true, shiftKey: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Cmd+U on an unfocused cell does NOT open its modal", () => {
    const a = makeSession({ id: "s-a" });
    const b = makeSession({ id: "s-b" });
    renderGrid({ sessions: [a, b], focusedId: a.id });

    fireEvent.keyDown(window, { key: "u", metaKey: true });

    // Only one dialog renders — for the focused session (a).
    const dialogs = screen.queryAllByRole("dialog");
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].getAttribute("aria-labelledby")).toBe(
      "viewport-modal-title",
    );
  });

  it("Esc closes the modal even when an xterm-style bubble listener would swallow it", () => {
    const session = makeSession({ id: "s-esc-close" });
    renderGrid({ sessions: [session], focusedId: session.id });

    // Stand-in for xterm's bubble-phase handler that would normally consume
    // Escape. The modal listener uses capture phase + stopPropagation so
    // this should never fire while the modal is open.
    const xtermLikeHandler = vi.fn();
    window.addEventListener("keydown", xtermLikeHandler);

    fireEvent.click(screen.getByTestId(`terminal-cell-eye-${session.id}`));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(xtermLikeHandler).not.toHaveBeenCalled();

    window.removeEventListener("keydown", xtermLikeHandler);
  });

  it("Cmd+U with modal open toggles it closed", () => {
    const session = makeSession({ id: "s-toggle" });
    renderGrid({ sessions: [session], focusedId: session.id });

    fireEvent.keyDown(window, { key: "u", metaKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "u", metaKey: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

// jsdom has no DragEvent constructor, so Testing Library's drag helpers drop
// clientX/clientY. Dispatch a MouseEvent of the same type instead.
function dragOverAt(
  el: HTMLElement,
  clientX: number,
  clientY: number,
  modifiers: { shiftKey?: boolean; ctrlKey?: boolean } = {},
) {
  fireEvent(
    el,
    new MouseEvent("dragover", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      ...modifiers,
    }),
  );
}

const tilesFor = (ids: string[]): TileLayout =>
  expandPreset(ids, getLayoutPresets(ids.length)[0]);

const areaOf = (el: HTMLElement) => `${el.style.gridColumn}|${el.style.gridRow}`;

function cellsByArea() {
  return screen
    .getAllByTitle("Drag to place this terminal")
    .map((header) => header.parentElement as HTMLElement)
    .map(areaOf);
}

describe("TerminalLayoutGrid — tiling", () => {
  it("renders session count matching cells across counts 1-7 using the default preset", () => {
    for (const count of [1, 2, 3, 4, 5, 6, 7]) {
      const sessions = Array.from({ length: count }, (_, i) =>
        makeSession({ id: `s${i}`, name: `t${i}` }),
      );
      const { unmount } = renderGrid({ sessions, tiles: [] });
      expect(screen.getAllByTitle("Drag to place this terminal")).toHaveLength(count);
      unmount();
    }
  });

  it("places each session with the grid-area its tile describes", () => {
    const sessions = [
      makeSession({ id: "a", name: "a" }),
      makeSession({ id: "b", name: "b" }),
    ];
    renderGrid({
      sessions,
      tiles: [
        { sessionId: "a", x: 0, y: 0, w: 48, h: 16 },
        { sessionId: "b", x: 0, y: 16, w: 48, h: 32 },
      ],
    });

    expect(cellsByArea()).toEqual([
      "1 / span 48|1 / span 16",
      "1 / span 48|17 / span 32",
    ]);
  });

  it("renders one CSS grid of 48 by 48 tracks and no gutter drop zones", () => {
    renderGrid({
      sessions: [makeSession({ id: "a" }), makeSession({ id: "b" })],
      tiles: tilesFor(["a", "b"]),
    });

    const grid = screen.getByTestId("terminal-grid");
    expect(grid.style.gridTemplateColumns).toBe("repeat(48, 1fr)");
    expect(grid.style.gridTemplateRows).toBe("repeat(48, 1fr)");
    expect(screen.queryByTestId("terminal-grid-gutter-0")).toBeNull();
  });

  it("falls back to the default preset when no tiles are passed", () => {
    renderGrid({
      sessions: [makeSession({ id: "a" }), makeSession({ id: "b" })],
      tiles: [],
    });

    expect(cellsByArea()).toEqual([
      "1 / span 24|1 / span 48",
      "25 / span 24|1 / span 48",
    ]);
  });

  it("mobile/maximized rendering is unaffected by the tiling", () => {
    const sessions = [makeSession({ id: "a" }), makeSession({ id: "b" })];
    renderGrid({
      sessions,
      maximized: true,
      focusedId: "b",
      tiles: tilesFor(["a", "b"]),
    });

    // Every session stays mounted so its terminal state survives the toggle.
    expect(screen.getAllByTitle("Drag to place this terminal")).toHaveLength(2);
    expect(screen.queryByTestId("terminal-grid")).toBeNull();
  });
});

describe("TerminalLayoutGrid — placement drag", () => {
  const sessions = [
    makeSession({ id: "a", name: "a" }),
    makeSession({ id: "b", name: "b" }),
    makeSession({ id: "c", name: "c" }),
  ];
  const tiles: TileLayout = [
    { sessionId: "a", x: 0, y: 0, w: 24, h: 48 },
    { sessionId: "b", x: 24, y: 0, w: 24, h: 24 },
    { sessionId: "c", x: 24, y: 24, w: 24, h: 24 },
  ];

  function startDrag() {
    const onPlace = vi.fn();
    renderGrid({ sessions, tiles, onPlace });
    const before = cellsByArea();
    fireEvent.dragStart(screen.getAllByTitle("Drag to place this terminal")[0]);
    const overlay = screen.getByTestId("terminal-placement-overlay");
    // The wrapper owns the drag events; the overlay only measures and paints.
    const wrapper = screen.getByTestId("terminal-grid").parentElement as HTMLElement;
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 480,
      height: 480,
      right: 480,
      bottom: 480,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    return { onPlace, overlay, wrapper, before };
  }

  it("never lets the overlay take pointer events", () => {
    renderGrid({ sessions, tiles });
    const overlay = screen.getByTestId("terminal-placement-overlay");

    // Two things killed the drag before: mounting the overlay during dragstart, and
    // arming it by taking pointer events. Either changes the DOM under the cursor at
    // dragstart and Chromium abandons the drag — observed as dragstart → dragend with
    // no dragover at all. It is mounted from the first render and stays untouchable.
    expect(overlay.style.pointerEvents).toBe("none");

    fireEvent.dragStart(screen.getAllByTitle("Drag to place this terminal")[0]);
    expect(overlay.style.pointerEvents).toBe("none");

    fireEvent.dragEnd(screen.getAllByTitle("Drag to place this terminal")[0]);
    expect(overlay.style.pointerEvents).toBe("none");
  });

  it("does not re-render the cells when a drag starts", () => {
    renderGrid({ sessions, tiles });
    const before = screen.getAllByTitle("Drag to place this terminal")[0];

    fireEvent.dragStart(before);

    // The very same DOM node must survive dragstart: Chrome cancels a drag whose
    // source subtree is rebuilt underneath it.
    expect(screen.getAllByTitle("Drag to place this terminal")[0]).toBe(before);
  });

  it("leaves every cell's grid-area untouched for the whole drag", () => {
    const { wrapper, before } = startDrag();

    dragOverAt(wrapper, 395, 155);
    dragOverAt(wrapper, 395, 395);

    // The regression that motivated the change: previewing must not re-flow the grid,
    // because a cell moving under the cursor changes which one the drop lands on.
    expect(cellsByArea()).toEqual(before);
  });

  it("commits the painted layout on drop", () => {
    const { wrapper, onPlace } = startDrag();

    dragOverAt(wrapper, 395, 155, { shiftKey: true });
    fireEvent(wrapper, new MouseEvent("drop", { bubbles: true, cancelable: true }));

    expect(onPlace).toHaveBeenCalledTimes(1);
    const committed = onPlace.mock.calls[0][0] as TileLayout;
    // The Shift gesture grows the dragged window towards the pointer.
    expect(committed.find((t) => t.sessionId === "a")).toMatchObject({
      x: 0,
      y: 0,
      w: 40,
      h: 48,
    });
  });

  it("commits nothing when the drag ends without a drop", () => {
    const { onPlace, wrapper } = startDrag();

    dragOverAt(wrapper, 395, 155);
    fireEvent.dragEnd(screen.getAllByTitle("Drag to place this terminal")[0]);

    expect(onPlace).not.toHaveBeenCalled();
    expect(screen.queryByTestId("placement-preview-a")).toBeNull();
  });

  it("ignores drags that did not start in the grid", () => {
    const onPlace = vi.fn();
    renderGrid({ sessions, tiles, onPlace });
    const wrapper = screen.getByTestId("terminal-grid").parentElement as HTMLElement;

    // No dragstart of ours: a file dragged in from the desktop must pass straight
    // through rather than being claimed and silently eaten.
    const over = new MouseEvent("dragover", { bubbles: true, cancelable: true });
    fireEvent(wrapper, over);
    expect(over.defaultPrevented).toBe(false);

    fireEvent(wrapper, new MouseEvent("drop", { bubbles: true, cancelable: true }));
    expect(onPlace).not.toHaveBeenCalled();
  });

  it("works without throwing when onPlace is omitted", () => {
    renderGrid({ sessions, tiles, onPlace: undefined });
    fireEvent.dragStart(screen.getAllByTitle("Drag to place this terminal")[0]);
    const wrapper = screen.getByTestId("terminal-grid").parentElement as HTMLElement;
    expect(() =>
      fireEvent(wrapper, new MouseEvent("drop", { bubbles: true, cancelable: true })),
    ).not.toThrow();
  });

  it("paints the area the pointer is stretching to", () => {
    const { wrapper } = startDrag();

    dragOverAt(wrapper, 395, 155, { shiftKey: true });

    expect(screen.getByTestId("placement-region").getAttribute("data-region")).toBe(
      "0,0,40,48",
    );
    expect(
      screen.getByTestId("placement-preview-a").getAttribute("data-region"),
    ).toBe("0,0,40,48");
  });
});

describe("TerminalLayoutGrid — which gesture the modifiers select", () => {
  const sessions = [
    makeSession({ id: "a", name: "a" }),
    makeSession({ id: "b", name: "b" }),
    makeSession({ id: "c", name: "c" }),
  ];
  // a on the left, b over c on the right. 480x480 over 48 zones: one zone is 10px.
  const tiles: TileLayout = [
    { sessionId: "a", x: 0, y: 0, w: 24, h: 48 },
    { sessionId: "b", x: 24, y: 0, w: 24, h: 24 },
    { sessionId: "c", x: 24, y: 24, w: 24, h: 24 },
  ];

  // Zone 39,0 — inside b's top edge band, so the three gestures are told apart by
  // what they paint there: target aims at b's top half, grow stretches a to the
  // pointer, swap takes the whole of b.
  const AT_B_TOP: [number, number] = [395, 5];

  function startDrag() {
    renderGrid({ sessions, tiles, onPlace: vi.fn() });
    fireEvent.dragStart(screen.getAllByTitle("Drag to place this terminal")[0]);
    const overlay = screen.getByTestId("terminal-placement-overlay");
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 480,
      height: 480,
      right: 480,
      bottom: 480,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    return screen.getByTestId("terminal-grid").parentElement as HTMLElement;
  }

  const previewOf = (id: string) =>
    screen.getByTestId(`placement-preview-${id}`).getAttribute("data-region");

  it("a plain drag drives the overlay in target mode", () => {
    const wrapper = startDrag();

    dragOverAt(wrapper, ...AT_B_TOP);

    // b's centre and its four edge bands are on offer and the top one is aimed at —
    // the gesture that used to need Shift. Swap would offer the centre alone.
    for (const side of ["centre", "left", "right", "top", "bottom"]) {
      expect(screen.getByTestId(`placement-target-${side}`)).toBeTruthy();
    }
    expect(screen.getByTestId("placement-target-top").getAttribute("data-active")).toBe(
      "true",
    );
    // Something is painted, and it is not an area anchored on the dragged window.
    expect(previewOf("a")).toBeTruthy();
    expect(screen.queryByTestId("placement-region")).toBeNull();
  });

  it("Shift drives the overlay in grow mode", () => {
    const wrapper = startDrag();

    dragOverAt(wrapper, ...AT_B_TOP, { shiftKey: true });

    expect(screen.getByTestId("placement-region").getAttribute("data-region")).toBe(
      "0,0,40,48",
    );
    expect(previewOf("a")).toBe("0,0,40,48");
    // The painted area is not a target on the hovered window.
    expect(screen.queryByTestId("placement-target-top")).toBeNull();
  });

  it("Ctrl still drives the overlay in swap mode", () => {
    const wrapper = startDrag();

    dragOverAt(wrapper, ...AT_B_TOP, { ctrlKey: true });

    expect(previewOf("a")).toBe("24,0,24,24");
    expect(previewOf("b")).toBe("0,0,24,48");
    // The whole window, with no edge bands to aim past and nothing painted.
    expect(screen.queryByTestId("placement-target-top")).toBeNull();
    expect(screen.queryByTestId("placement-region")).toBeNull();
  });

  it("Ctrl takes precedence over Shift", () => {
    const wrapper = startDrag();

    dragOverAt(wrapper, ...AT_B_TOP, { ctrlKey: true, shiftKey: true });

    expect(previewOf("a")).toBe("24,0,24,24");
    expect(previewOf("b")).toBe("0,0,24,48");
    expect(screen.queryByTestId("placement-region")).toBeNull();
  });
});

describe("TerminalLayoutGrid — disconnected badge", () => {
  it("shows the badge on a disconnected cell header", () => {
    conn.state = "disconnected";
    const session = makeSession({ id: "abc-123" });
    const { onFocus } = renderGrid({ sessions: [session], focusedId: null });

    const header = screen.getAllByTitle("Drag to place this terminal")[0];
    const badge = within(header).getByTestId("terminal-disconnected-abc-123");
    expect(badge).toBeInTheDocument();

    fireEvent.click(badge);

    expect(reconnectSession).toHaveBeenCalledWith("abc-123");
    expect(onFocus).not.toHaveBeenCalled();
  });
});

describe("TerminalLayoutGrid — project colour", () => {
  beforeEach(() => installProjectColors());

  // The cell header is tinted with the project's accent; it is the only
  // element in the cell that carries the colour, and it has no test id.
  const headerColor = (index: number) =>
    (screen.getAllByTitle("Drag to place this terminal")[index] as HTMLElement).style.background;

  it("all sessions of one project share its colour", async () => {
    renderGrid({
      sessions: [
        makeSession({ id: "s1", project: "alpha" }),
        makeSession({ id: "s2", project: "alpha", name: "claude-alpha-2" }),
      ],
      focusedId: "s1",
    });

    await waitFor(() =>
      expect(headerColor(0)).toContain(rgb(TEST_PROJECT_COLORS.alpha)),
    );
    expect(headerColor(1)).toContain(rgb(TEST_PROJECT_COLORS.alpha));
    expect(headerColor(0)).toBe(headerColor(1));
  });

  it("sessions of different projects differ in colour", async () => {
    renderGrid({
      sessions: [
        makeSession({ id: "s1", project: "alpha" }),
        makeSession({ id: "s2", project: "beta", name: "claude-beta" }),
      ],
      focusedId: "s1",
    });

    await waitFor(() =>
      expect(headerColor(0)).toContain(rgb(TEST_PROJECT_COLORS.alpha)),
    );
    expect(headerColor(1)).toContain(rgb(TEST_PROJECT_COLORS.beta));
    expect(headerColor(0)).not.toBe(headerColor(1));
  });
});

describe("TerminalLayoutGrid — project colour picker", () => {
  beforeEach(() => installProjectColors());

  it("sits between the eye and maximize buttons, sized like its siblings", () => {
    const session = makeSession({ id: "s-pick", project: "alpha" });
    renderGrid({ sessions: [session], focusedId: session.id });

    const eye = screen.getByTestId("terminal-cell-eye-s-pick");
    const color = screen.getByTestId("terminal-cell-color-s-pick");
    const maximize = screen.getByTestId("terminal-cell-maximize-s-pick");

    // The control needs a positioning wrapper for its popover, so compare the
    // slot it occupies in the group rather than the button itself.
    const group = Array.from(eye.parentElement!.children);
    const slot = group.findIndex((el) => el.contains(color));
    expect(slot).toBe(group.indexOf(eye) + 1);
    expect(group.indexOf(maximize)).toBe(slot + 1);

    // The old picker hung off the 6x6px activity LED. This one is a real
    // control: same padding and icon size as the buttons beside it.
    expect(color.className).toBe(eye.className);
    expect(color.querySelector("svg")?.getAttribute("width")).toBe(
      eye.querySelector("svg")?.getAttribute("width"),
    );
  });

  it("opens a picker naming the cell's project without focusing the cell", () => {
    const session = makeSession({ id: "s-pick2", project: "beta" });
    const { onFocus } = renderGrid({ sessions: [session], focusedId: null });

    fireEvent.click(screen.getByTestId("terminal-cell-color-s-pick2"));

    expect(screen.getByRole("dialog")).toHaveTextContent("beta");
    expect(onFocus).not.toHaveBeenCalled();
  });
});

describe("TerminalLayoutGrid — rename from the cell header", () => {
  // jsdom's DragEvent has no real DataTransfer; the header's own onDragStart
  // writes to it, so a stand-in has to be supplied (same helper as the
  // column-layout block above).
  function dragStart(el: Element) {
    fireEvent.dragStart(el, { dataTransfer: { effectAllowed: "", dropEffect: "" } });
  }

  function twoSessions() {
    return [
      makeSession({ id: "a", name: "claude-a" }),
      makeSession({ id: "b", name: "claude-b" }),
    ];
  }

  it("renames a session from the cell header", () => {
    const onRename = vi.fn();
    renderGrid({
      sessions: [makeSession({ id: "s-ren", name: "claude-ch" })],
      focusedId: "s-ren",
      onRename,
    });

    // Single click must not start an edit — the header is a drag handle.
    fireEvent.click(screen.getByText("claude-ch"));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    fireEvent.doubleClick(screen.getByText("claude-ch"));

    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input).toHaveValue("claude-ch");

    fireEvent.change(input, { target: { value: "  builder  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onRename).toHaveBeenCalledWith("s-ren", "builder");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("keeps the previous name when the edit is cancelled with Escape", () => {
    const onRename = vi.fn();
    renderGrid({
      sessions: [makeSession({ id: "s-esc", name: "claude-ch" })],
      focusedId: "s-esc",
      onRename,
    });

    fireEvent.doubleClick(screen.getByText("claude-ch"));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "discarded" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("claude-ch")).toBeInTheDocument();
  });

  it("dragging the header starts a placement drag", () => {
    const sessions = [makeSession({ id: "a" }), makeSession({ id: "b" })];
    renderGrid({ sessions, tiles: [] });

    const overlay = screen.getByTestId("terminal-placement-overlay");
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 480, height: 480, right: 480, bottom: 480, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.dragStart(screen.getAllByTitle("Drag to place this terminal")[0]);

    // Arming leaves no trace in the DOM by design — what proves it is that a
    // subsequent dragover paints a target.
    const wrapper = screen.getByTestId("terminal-grid").parentElement as HTMLElement;
    dragOverAt(wrapper, 395, 235);

    expect(screen.queryAllByTestId(/^placement-preview-/).length).toBeGreaterThan(0);
  });

  it("selecting text in the rename input does not start a cell drag", () => {
    renderGrid({ sessions: twoSessions(), focusedId: "a", onRename: vi.fn() });

    fireEvent.doubleClick(screen.getByText("claude-a"));
    const input = screen.getByRole("textbox");

    // The input lives inside a `draggable` header; without a stop, dragging
    // to select its text starts a cell drag instead.
    dragStart(input);

    expect(screen.queryAllByTestId(/^placement-preview-/)).toHaveLength(0);
  });
});

// 476 + the 4px gutter = 480, so one zone is exactly 10px and pixel deltas convert
// to zone deltas without rounding noise. The grid measures itself when the tiling
// mounts, so the spy has to be installed before the render.
function measureGrid(width = 476, height = 476) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

function seamHandles(container: HTMLElement) {
  return Array.from(container.querySelectorAll('[data-testid^="seam-handle-"]'));
}

function grabSeam(testId: string, from: number, axis: "x" | "y" = "x") {
  const handle = screen.getByTestId(testId);
  handle.setPointerCapture = vi.fn();
  fireEvent.pointerDown(handle, {
    pointerId: 3,
    button: 0,
    clientX: axis === "x" ? from : 0,
    clientY: axis === "x" ? 0 : from,
  });
  return handle;
}

function dragSeamTo(to: number, axis: "x" | "y" = "x") {
  fireEvent.pointerMove(window, {
    pointerId: 3,
    clientX: axis === "x" ? to : 0,
    clientY: axis === "x" ? 0 : to,
  });
}

function releaseSeamAt(to: number, axis: "x" | "y" = "x") {
  fireEvent.pointerUp(window, {
    pointerId: 3,
    clientX: axis === "x" ? to : 0,
    clientY: axis === "x" ? 0 : to,
  });
}

describe("TerminalLayoutGrid — seam resize", () => {
  const threeSessions = [
    makeSession({ id: "a", name: "a" }),
    makeSession({ id: "b", name: "b" }),
    makeSession({ id: "c", name: "c" }),
  ];
  // a down the left, b over c on the right.
  const threeTiles: TileLayout = [
    { sessionId: "a", x: 0, y: 0, w: 24, h: 48 },
    { sessionId: "b", x: 24, y: 0, w: 24, h: 24 },
    { sessionId: "c", x: 24, y: 24, w: 24, h: 24 },
  ];
  const twoSessionsSplit = threeSessions.slice(0, 2);
  const twoTiles: TileLayout = [
    { sessionId: "a", x: 0, y: 0, w: 24, h: 48 },
    { sessionId: "b", x: 24, y: 0, w: 24, h: 48 },
  ];

  it("seam handles render over a multi-session grid", () => {
    measureGrid();
    const { container } = renderGrid({ sessions: threeSessions, tiles: threeTiles });

    // The vertical boundary runs the full height; the horizontal one covers only
    // the right-hand column, the one stretch where b faces c.
    expect(seamHandles(container).map((el) => el.getAttribute("data-testid"))).toEqual([
      "seam-handle-x-24-0",
      "seam-handle-y-24-24",
    ]);
    // Centred on the gutter before track 24 — over the gap, not over a cell.
    expect(screen.getByTestId("seam-handle-x-24-0").style.left).toBe(
      "calc(-2px + 0.5 * (100% + 4px))",
    );
  });

  it("no seam handles while a terminal is maximized", () => {
    measureGrid();
    const maxed = renderGrid({
      sessions: threeSessions,
      tiles: threeTiles,
      maximized: true,
    });

    expect(seamHandles(maxed.container)).toHaveLength(0);
    maxed.unmount();

    // Nor with a single session live: one tile covers the whole grid, so there is
    // no boundary between two terminals to grab.
    const single = renderGrid({ sessions: [makeSession({ id: "a" })], tiles: [] });
    expect(seamHandles(single.container)).toHaveLength(0);
  });

  it("a draft layout is what the cells render", () => {
    measureGrid();
    renderGrid({ sessions: twoSessionsSplit, tiles: twoTiles });

    grabSeam("seam-handle-x-24-0", 240);
    dragSeamTo(340);

    // +100px is +10 zones: the cells follow the draft, live and unpersisted.
    expect(cellsByArea()).toEqual([
      "1 / span 34|1 / span 48",
      "35 / span 14|1 / span 48",
    ]);

    fireEvent.keyDown(window, { key: "Escape" });

    // The draft is dropped, so the committed layout is what renders again.
    expect(cellsByArea()).toEqual([
      "1 / span 24|1 / span 48",
      "25 / span 24|1 / span 48",
    ]);
  });

  it("a completed resize is handed to onPlace once", () => {
    measureGrid();
    const onPlace = vi.fn();
    renderGrid({ sessions: twoSessionsSplit, tiles: twoTiles, onPlace });

    grabSeam("seam-handle-x-24-0", 240);
    dragSeamTo(300);
    dragSeamTo(340);
    releaseSeamAt(340);

    expect(onPlace).toHaveBeenCalledTimes(1);
    const [committed, kind] = onPlace.mock.calls[0];
    expect(committed).toEqual([
      { sessionId: "a", x: 0, y: 0, w: 34, h: 48 },
      { sessionId: "b", x: 34, y: 0, w: 14, h: 48 },
    ]);
    // Committed as a resize, not a placement: the scope must not re-derive the
    // session order from the new tiling.
    expect(kind).toBe("resize");
  });

  it("a pointerdown on a handle starts no placement", () => {
    measureGrid();
    const onPlace = vi.fn();
    renderGrid({ sessions: threeSessions, tiles: threeTiles, onPlace });

    const handle = screen.getByTestId("seam-handle-x-24-0");
    handle.setPointerCapture = vi.fn();
    const notPrevented = fireEvent.pointerDown(handle, {
      pointerId: 3,
      button: 0,
      clientX: 240,
      clientY: 240,
    });

    // The default is cancelled, which is what stops the press turning into an
    // HTML5 drag of whatever sits under the strip.
    expect(notPrevented).toBe(false);
    // And the overlay is not armed, so a dragover paints nothing at all.
    const wrapper = screen.getByTestId("terminal-grid").parentElement as HTMLElement;
    dragOverAt(wrapper, 395, 155);
    expect(screen.queryAllByTestId(/^placement-preview-/)).toHaveLength(0);
    expect(screen.queryByTestId("placement-region")).toBeNull();
    expect(onPlace).not.toHaveBeenCalled();
  });

  it("a horizontal seam commit keeps the existing session order", () => {
    // ADR 0008's amendment, worked: dragging the y=12 seam down by 24 zones
    // carries b past d in the y-major reading order. The tiling stays valid, so
    // re-deriving the order from it would silently renumber the terminals.
    const sessions = ["a", "b", "c", "d"].map((id) => makeSession({ id, name: id }));
    const stored: TileLayout = [
      { sessionId: "a", x: 0, y: 0, w: 24, h: 12 },
      { sessionId: "b", x: 0, y: 12, w: 24, h: 36 },
      { sessionId: "c", x: 24, y: 0, w: 24, h: 24 },
      { sessionId: "d", x: 24, y: 24, w: 24, h: 24 },
    ];
    localStorage.setItem("panel-terminal-grid-seams", JSON.stringify(stored));

    function Harness() {
      const { tiles, sessionOrder, placeTiles } = useTerminalOrdering("seams", sessions);
      return (
        <>
          <div data-testid="session-order">{sessionOrder.join(",")}</div>
          <TerminalLayoutGrid
            sessions={sessions}
            focusedId={null}
            maximized={false}
            onFocus={() => {}}
            onExit={() => {}}
            onToggleMaximize={() => {}}
            tiles={tiles}
            onPlace={placeTiles}
          />
        </>
      );
    }

    measureGrid();
    render(<Harness />);
    expect(screen.getByTestId("session-order").textContent).toBe("a,c,b,d");

    grabSeam("seam-handle-y-12-0", 120, "y");
    dragSeamTo(360, "y");
    releaseSeamAt(360, "y");

    // The boundary moved — a took b's 24 zones...
    expect(cellsByArea()).toEqual([
      "1 / span 24|1 / span 36",
      "1 / span 24|37 / span 12",
      "25 / span 24|1 / span 24",
      "25 / span 24|25 / span 24",
    ]);
    // ...and the numbering did not, though readingOrder of that tiling is a,c,d,b.
    expect(screen.getByTestId("session-order").textContent).toBe("a,c,b,d");
  });
});
