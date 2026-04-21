import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TerminalLayoutGrid } from "../TerminalLayoutGrid";
import type { SessionMeta } from "../useTerminalSessions";

// TerminalView pulls in xterm which cannot render in jsdom; stub it.
vi.mock("../TerminalView", () => ({
  TerminalView: ({ sessionId }: { sessionId: string }) => (
    <div data-testid={`terminal-view-${sessionId}`} />
  ),
}));

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
