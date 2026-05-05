import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
  render(<TerminalLayoutGrid {...props} />);
  return props;
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
});
