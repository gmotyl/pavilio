import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TerminalLayoutGrid } from "../TerminalLayoutGrid";
import type { SessionMeta } from "../useTerminalSessions";

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

  it("renders sessions.length matching cells for counts 1-7 with default columnSizes", () => {
    for (let count = 1; count <= 7; count++) {
      const sessions = Array.from({ length: count }, (_, i) =>
        makeSession({ id: `count${count}-s${i}` }),
      );
      const { unmount } = renderGrid({ sessions, focusedId: sessions[0].id });
      expect(screen.getAllByTestId(/^terminal-view-/)).toHaveLength(count);
      unmount();
    }
  });

  it("count=3 default groups session 0 alone in column 0 and sessions 1-2 in column 1", () => {
    const sessions = [
      makeSession({ id: "a" }),
      makeSession({ id: "b" }),
      makeSession({ id: "c" }),
    ];
    renderGrid({ sessions, focusedId: "a" });

    const col0 = screen.getByTestId("terminal-grid-column-0");
    const col1 = screen.getByTestId("terminal-grid-column-1");
    expect(within(col0).getAllByTestId(/^terminal-view-/)).toHaveLength(1);
    expect(within(col1).getAllByTestId(/^terminal-view-/)).toHaveLength(2);
    expect(within(col0).getByTestId("terminal-view-a")).toBeInTheDocument();
    expect(within(col1).getByTestId("terminal-view-b")).toBeInTheDocument();
    expect(within(col1).getByTestId("terminal-view-c")).toBeInTheDocument();
  });

  it("count=7 default groups sessions into 3 column wrappers of sizes 3, 2, 2", () => {
    const sessions = Array.from({ length: 7 }, (_, i) =>
      makeSession({ id: `s${i}` }),
    );
    renderGrid({ sessions, focusedId: "s0" });

    const col0 = screen.getByTestId("terminal-grid-column-0");
    const col1 = screen.getByTestId("terminal-grid-column-1");
    const col2 = screen.getByTestId("terminal-grid-column-2");
    expect(within(col0).getAllByTestId(/^terminal-view-/)).toHaveLength(3);
    expect(within(col1).getAllByTestId(/^terminal-view-/)).toHaveLength(2);
    expect(within(col2).getAllByTestId(/^terminal-view-/)).toHaveLength(2);
    expect(screen.queryByTestId("terminal-grid-column-3")).not.toBeInTheDocument();
  });

  it("an explicit columnSizes prop overrides the count-derived default", () => {
    const sessions = [
      makeSession({ id: "a" }),
      makeSession({ id: "b" }),
      makeSession({ id: "c" }),
      makeSession({ id: "d" }),
    ];
    renderGrid({ sessions, focusedId: "a", columnSizes: [1, 3] });

    const col0 = screen.getByTestId("terminal-grid-column-0");
    const col1 = screen.getByTestId("terminal-grid-column-1");
    expect(within(col0).getAllByTestId(/^terminal-view-/)).toHaveLength(1);
    expect(within(col1).getAllByTestId(/^terminal-view-/)).toHaveLength(3);
  });

  it("mobile/maximized rendering is unaffected by columnSizes", () => {
    const sessions = [
      makeSession({ id: "a" }),
      makeSession({ id: "b" }),
      makeSession({ id: "c" }),
    ];
    renderGrid({
      sessions,
      focusedId: "a",
      maximized: true,
      columnSizes: [1, 2],
    });

    expect(screen.queryByTestId("terminal-grid-column-0")).not.toBeInTheDocument();
    expect(screen.queryByTestId("terminal-grid-gutter-0")).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/^terminal-view-/)).toHaveLength(3);
  });

  it("plain drop across a column boundary still calls onSwap, not onJoinColumn", () => {
    const sessions = [
      makeSession({ id: "a" }),
      makeSession({ id: "b" }),
      makeSession({ id: "c" }),
    ];
    const onSwap = vi.fn();
    const onJoinColumn = vi.fn();
    renderGrid({ sessions, focusedId: "a", onSwap, onJoinColumn });

    dragStart(screen.getAllByTitle("Drag to swap")[0]);
    fireEvent.drop(screen.getByTestId("terminal-view-b"));

    expect(onSwap).toHaveBeenCalledWith("a", "b");
    expect(onJoinColumn).not.toHaveBeenCalled();
  });

  it("Ctrl+drop onto a cell calls onJoinColumn instead of onSwap", () => {
    const sessions = [
      makeSession({ id: "a" }),
      makeSession({ id: "b" }),
      makeSession({ id: "c" }),
    ];
    const onSwap = vi.fn();
    const onJoinColumn = vi.fn();
    renderGrid({ sessions, focusedId: "a", onSwap, onJoinColumn });

    dragStart(screen.getAllByTitle("Drag to swap")[0]);
    dropCtrl(screen.getByTestId("terminal-view-b"), true);

    expect(onJoinColumn).toHaveBeenCalledWith("a", "b");
    expect(onSwap).not.toHaveBeenCalled();
  });

  it("Ctrl+drop onto a gutter calls onSplitColumn with the gutter's index", () => {
    const sessions = [
      makeSession({ id: "a" }),
      makeSession({ id: "b" }),
      makeSession({ id: "c" }),
    ];
    const onSplitColumn = vi.fn();
    renderGrid({ sessions, focusedId: "a", onSplitColumn });

    dragStart(screen.getAllByTitle("Drag to swap")[0]);
    dropCtrl(screen.getByTestId("terminal-grid-gutter-1"), true);

    expect(onSplitColumn).toHaveBeenCalledWith("a", 1);
  });

  it("a non-Ctrl drop onto a gutter fires no callback", () => {
    const sessions = [
      makeSession({ id: "a" }),
      makeSession({ id: "b" }),
      makeSession({ id: "c" }),
    ];
    const onSplitColumn = vi.fn();
    const onSwap = vi.fn();
    renderGrid({ sessions, focusedId: "a", onSplitColumn, onSwap });

    dragStart(screen.getAllByTitle("Drag to swap")[0]);
    fireEvent.drop(screen.getByTestId("terminal-grid-gutter-1"));

    expect(onSplitColumn).not.toHaveBeenCalled();
    expect(onSwap).not.toHaveBeenCalled();
  });

  it("Ctrl+drag works without throwing when onJoinColumn/onSplitColumn are omitted", () => {
    const sessions = [
      makeSession({ id: "a" }),
      makeSession({ id: "b" }),
      makeSession({ id: "c" }),
    ];
    renderGrid({ sessions, focusedId: "a" });

    expect(() => {
      dragStart(screen.getAllByTitle("Drag to swap")[0]);
      dropCtrl(screen.getByTestId("terminal-view-b"), true);
      dragStart(screen.getAllByTitle("Drag to swap")[0]);
      dropCtrl(screen.getByTestId("terminal-grid-gutter-1"), true);
    }).not.toThrow();
  });
});
