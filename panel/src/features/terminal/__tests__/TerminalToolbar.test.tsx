import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TerminalToolbar } from "../TerminalToolbar";
import type { SessionMeta } from "../useTerminalSessions";

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

function renderToolbar(overrides: Partial<Parameters<typeof TerminalToolbar>[0]> = {}) {
  const sessions = overrides.sessions ?? [makeSession()];
  const props = {
    sessions,
    focusedId: sessions[0]?.id ?? null,
    maximized: false,
    currentProject: "ch",
    projects: [{ name: "ch" }],
    repos: [],
    onFocus: vi.fn(),
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    onColorChange: vi.fn(),
    onRename: vi.fn(),
    onToggleMaximize: vi.fn(),
    onReorder: vi.fn(),
    ...overrides,
  };
  render(<TerminalToolbar {...props} />);
  return props;
}

describe("TerminalToolbar — confirm close flow", () => {
  it("× click opens confirm modal and does NOT call onDelete", () => {
    const onDelete = vi.fn();
    renderToolbar({ onDelete });

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByTitle("Kill session")[0]);

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("× → Close button confirms and calls onDelete with session id", () => {
    const onDelete = vi.fn();
    const session = makeSession({ id: "abc-123", name: "claude-ch" });
    renderToolbar({ sessions: [session], focusedId: session.id, onDelete });

    fireEvent.click(screen.getAllByTitle("Kill session")[0]);
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("abc-123");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("× → Cancel closes modal without calling onDelete", () => {
    const onDelete = vi.fn();
    renderToolbar({ onDelete });

    fireEvent.click(screen.getAllByTitle("Kill session")[0]);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
