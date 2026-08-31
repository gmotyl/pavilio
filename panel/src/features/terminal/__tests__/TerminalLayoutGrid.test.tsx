import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TerminalLayoutGrid } from "../TerminalLayoutGrid";
import type { SessionMeta } from "../useTerminalSessions";
import { getLayoutPresets, expandPreset } from "../columnLayout";
import type { ColumnLayout } from "../columnLayout";

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
    color: null,
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
    onSwap: vi.fn(),
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

describe("TerminalLayoutGrid — column layout", () => {
  // jsdom's DragEvent has no real DataTransfer; the component's own
  // onDragStart handler writes to it, so tests must supply a stand-in.
  function dragStart(el: Element) {
    fireEvent.dragStart(el, { dataTransfer: { effectAllowed: "", dropEffect: "" } });
  }

  // This jsdom build has no DragEvent constructor, so @testing-library's
  // fireEvent.drop(el, { ctrlKey }) falls back to a plain Event whose
  // constructor silently drops unknown init keys like ctrlKey. Dispatch a
  // real MouseEvent (which jsdom does support) to get a readable ctrlKey.
  function dropCtrl(el: Element, ctrlKey: boolean) {
    fireEvent(el, new MouseEvent("drop", { bubbles: true, cancelable: true, ctrlKey }));
  }

  // Same workaround as dropCtrl, for "dragover" — the component reads
  // e.ctrlKey during dragover to compute the live preview.
  function dragOverCtrl(el: Element, ctrlKey: boolean) {
    fireEvent(el, new MouseEvent("dragover", { bubbles: true, cancelable: true, ctrlKey }));
  }

  function threeSessionsSameColumnAB(): { sessions: SessionMeta[]; columnLayout: ColumnLayout } {
    // a, b share column 0 (weight 1 each); c alone in column 1.
    const sessions = [
      makeSession({ id: "a" }),
      makeSession({ id: "b" }),
      makeSession({ id: "c" }),
    ];
    const columnLayout: ColumnLayout = [
      [
        { sessionId: "a", weight: 1 },
        { sessionId: "b", weight: 1 },
      ],
      [{ sessionId: "c", weight: 1 }],
    ];
    return { sessions, columnLayout };
  }

  it("renders session count matching cells across counts 1-7 using the default preset", () => {
    for (let count = 1; count <= 7; count++) {
      const sessions = Array.from({ length: count }, (_, i) =>
        makeSession({ id: `count${count}-s${i}` }),
      );
      const order = sessions.map((s) => s.id);
      const expected = expandPreset(order, getLayoutPresets(count)[0].sizes);

      const { unmount } = renderGrid({ sessions, focusedId: sessions[0].id });
      expect(screen.getAllByTestId(/^terminal-view-/)).toHaveLength(count);
      expected.forEach((column, i) => {
        const col = screen.getByTestId(`terminal-grid-column-${i}`);
        expect(within(col).getAllByTestId(/^terminal-view-/)).toHaveLength(column.length);
      });
      expect(screen.queryByTestId(`terminal-grid-column-${expected.length}`)).not.toBeInTheDocument();
      unmount();
    }
  });

  it("a weighted column renders row tracks proportional to each entry's weight", () => {
    const sessions = [
      makeSession({ id: "a" }),
      makeSession({ id: "b" }),
      makeSession({ id: "c" }),
    ];
    const columnLayout: ColumnLayout = [
      [
        { sessionId: "a", weight: 2 },
        { sessionId: "b", weight: 1 },
      ],
      [{ sessionId: "c", weight: 1 }],
    ];
    renderGrid({ sessions, focusedId: "a", columnLayout });

    const col0 = screen.getByTestId("terminal-grid-column-0");
    expect(col0.style.gridTemplateRows).toBe("2fr 1fr");
  });

  it("an explicit columnLayout prop overrides the default preset expansion", () => {
    const sessions = [
      makeSession({ id: "a" }),
      makeSession({ id: "b" }),
      makeSession({ id: "c" }),
      makeSession({ id: "d" }),
    ];
    const columnLayout: ColumnLayout = [
      [{ sessionId: "a", weight: 1 }],
      [
        { sessionId: "b", weight: 1 },
        { sessionId: "c", weight: 1 },
        { sessionId: "d", weight: 1 },
      ],
    ];
    renderGrid({ sessions, focusedId: "a", columnLayout });

    const col0 = screen.getByTestId("terminal-grid-column-0");
    const col1 = screen.getByTestId("terminal-grid-column-1");
    expect(within(col0).getAllByTestId(/^terminal-view-/)).toHaveLength(1);
    expect(within(col1).getAllByTestId(/^terminal-view-/)).toHaveLength(3);
  });

  it("mobile/maximized rendering is unaffected by columnLayout", () => {
    const sessions = [
      makeSession({ id: "a" }),
      makeSession({ id: "b" }),
      makeSession({ id: "c" }),
    ];
    const columnLayout: ColumnLayout = [
      [{ sessionId: "a", weight: 1 }],
      [
        { sessionId: "b", weight: 1 },
        { sessionId: "c", weight: 1 },
      ],
    ];
    renderGrid({
      sessions,
      focusedId: "a",
      maximized: true,
      columnLayout,
    });

    expect(screen.queryByTestId("terminal-grid-column-0")).not.toBeInTheDocument();
    expect(screen.queryByTestId("terminal-grid-gutter-0")).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/^terminal-view-/)).toHaveLength(3);
  });

  it("plain drop still calls onSwap regardless of column", () => {
    const { sessions, columnLayout } = threeSessionsSameColumnAB();
    const onSwap = vi.fn();
    const onMergeColumn = vi.fn();
    const onJoinColumn = vi.fn();
    renderGrid({ sessions, focusedId: "a", columnLayout, onSwap, onMergeColumn, onJoinColumn });

    // a and b share a column — a plain drop still swaps, never merges/joins.
    dragStart(screen.getAllByTitle("Drag to swap")[0]);
    fireEvent.drop(screen.getByTestId("terminal-view-b"));

    expect(onSwap).toHaveBeenCalledWith("a", "b");
    expect(onMergeColumn).not.toHaveBeenCalled();
    expect(onJoinColumn).not.toHaveBeenCalled();
  });

  it("Ctrl+drop onto a same-column cell calls onMergeColumn", () => {
    const { sessions, columnLayout } = threeSessionsSameColumnAB();
    const onSwap = vi.fn();
    const onMergeColumn = vi.fn();
    const onJoinColumn = vi.fn();
    renderGrid({ sessions, focusedId: "a", columnLayout, onSwap, onMergeColumn, onJoinColumn });

    dragStart(screen.getAllByTitle("Drag to swap")[0]);
    dropCtrl(screen.getByTestId("terminal-view-b"), true);

    expect(onMergeColumn).toHaveBeenCalledWith("a", "b");
    expect(onJoinColumn).not.toHaveBeenCalled();
    expect(onSwap).not.toHaveBeenCalled();
  });

  it("Ctrl+drop onto a different-column cell calls onJoinColumn", () => {
    const { sessions, columnLayout } = threeSessionsSameColumnAB();
    const onSwap = vi.fn();
    const onMergeColumn = vi.fn();
    const onJoinColumn = vi.fn();
    renderGrid({ sessions, focusedId: "a", columnLayout, onSwap, onMergeColumn, onJoinColumn });

    // c is in a different column than a.
    dragStart(screen.getAllByTitle("Drag to swap")[0]);
    dropCtrl(screen.getByTestId("terminal-view-c"), true);

    expect(onJoinColumn).toHaveBeenCalledWith("a", "c");
    expect(onMergeColumn).not.toHaveBeenCalled();
    expect(onSwap).not.toHaveBeenCalled();
  });

  it("Ctrl+drop onto a gutter calls onSplitColumn with its index", () => {
    const { sessions, columnLayout } = threeSessionsSameColumnAB();
    const onSplitColumn = vi.fn();
    renderGrid({ sessions, focusedId: "a", columnLayout, onSplitColumn });

    dragStart(screen.getAllByTitle("Drag to swap")[0]);
    dropCtrl(screen.getByTestId("terminal-grid-gutter-1"), true);

    expect(onSplitColumn).toHaveBeenCalledWith("a", 1);
  });

  it("gutter dragover sets dropEffect to move for cursor affordance", () => {
    // Regression: the gutter's dragover handler used to skip setting
    // dropEffect, unlike the cell path — no "drop here" cursor while
    // hovering a gutter mid Ctrl-drag, even though the drop was accepted.
    const { sessions, columnLayout } = threeSessionsSameColumnAB();
    renderGrid({ sessions, focusedId: "a", columnLayout });

    const dataTransfer = { effectAllowed: "", dropEffect: "" };
    fireEvent.dragOver(screen.getByTestId("terminal-grid-gutter-1"), { dataTransfer });

    expect(dataTransfer.dropEffect).toBe("move");
  });

  it("a non-Ctrl drop onto a gutter fires no callback", () => {
    const { sessions, columnLayout } = threeSessionsSameColumnAB();
    const onSplitColumn = vi.fn();
    const onSwap = vi.fn();
    renderGrid({ sessions, focusedId: "a", columnLayout, onSplitColumn, onSwap });

    dragStart(screen.getAllByTitle("Drag to swap")[0]);
    fireEvent.drop(screen.getByTestId("terminal-grid-gutter-1"));

    expect(onSplitColumn).not.toHaveBeenCalled();
    expect(onSwap).not.toHaveBeenCalled();
  });

  it("dragover with Ctrl held renders a live preview without calling any commit callback", () => {
    const { sessions, columnLayout } = threeSessionsSameColumnAB();
    const onMergeColumn = vi.fn();
    const onJoinColumn = vi.fn();
    const onSplitColumn = vi.fn();
    renderGrid({
      sessions,
      focusedId: "a",
      columnLayout,
      onMergeColumn,
      onJoinColumn,
      onSplitColumn,
    });

    // Before drag: 2 columns, column 0 has both a and b.
    expect(screen.queryByTestId("terminal-grid-column-2")).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("terminal-grid-column-0")).getAllByTestId(/^terminal-view-/),
    ).toHaveLength(2);

    dragStart(screen.getAllByTitle("Drag to swap")[0]);
    dragOverCtrl(screen.getByTestId("terminal-view-b"), true);

    // mergeInColumn(layout, "a", "b") collapses column 0 to a single (grown)
    // slot and appends a new column holding the displaced "b" — rendered
    // live, without committing anything.
    expect(screen.getByTestId("terminal-grid-column-2")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("terminal-grid-column-0")).getAllByTestId(/^terminal-view-/),
    ).toHaveLength(1);
    expect(
      within(screen.getByTestId("terminal-grid-column-2")).getByTestId("terminal-view-b"),
    ).toBeInTheDocument();

    expect(onMergeColumn).not.toHaveBeenCalled();
    expect(onJoinColumn).not.toHaveBeenCalled();
    expect(onSplitColumn).not.toHaveBeenCalled();
  });

  it("ending the drag without a drop reverts the preview to the real columnLayout", () => {
    const { sessions, columnLayout } = threeSessionsSameColumnAB();
    renderGrid({ sessions, focusedId: "a", columnLayout });

    const dragHandle = screen.getAllByTitle("Drag to swap")[0];
    dragStart(dragHandle);
    dragOverCtrl(screen.getByTestId("terminal-view-b"), true);

    // Preview is live: 3 columns now.
    expect(screen.getByTestId("terminal-grid-column-2")).toBeInTheDocument();

    fireEvent.dragEnd(dragHandle);

    // Reverted to the real (committed) columnLayout: back to 2 columns,
    // column 0 has both a and b again.
    expect(screen.queryByTestId("terminal-grid-column-2")).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("terminal-grid-column-0")).getAllByTestId(/^terminal-view-/),
    ).toHaveLength(2);
  });

  it("Ctrl+drag works without throwing when onMergeColumn/onJoinColumn/onSplitColumn are omitted", () => {
    const { sessions, columnLayout } = threeSessionsSameColumnAB();
    renderGrid({ sessions, focusedId: "a", columnLayout });

    expect(() => {
      dragStart(screen.getAllByTitle("Drag to swap")[0]);
      dragOverCtrl(screen.getByTestId("terminal-view-b"), true);
      dropCtrl(screen.getByTestId("terminal-view-b"), true);

      dragStart(screen.getAllByTitle("Drag to swap")[0]);
      dragOverCtrl(screen.getByTestId("terminal-view-c"), true);
      dropCtrl(screen.getByTestId("terminal-view-c"), true);

      dragStart(screen.getAllByTitle("Drag to swap")[0]);
      dropCtrl(screen.getByTestId("terminal-grid-gutter-1"), true);
    }).not.toThrow();
  });
});
