import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmCloseTerminalModal } from "../ConfirmCloseTerminalModal";

describe("ConfirmCloseTerminalModal", () => {
  it("does not render when sessionName is null", () => {
    render(
      <ConfirmCloseTerminalModal
        session={null}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("renders with session name in title", () => {
    render(
      <ConfirmCloseTerminalModal
        session={{ id: "c", name: "claude-ch" }}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/claude-ch/)).toBeInTheDocument();
  });

  it("calls onConfirm when Close button clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmCloseTerminalModal
        session={{ id: "s1", name: "s1" }}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel when Cancel button clicked", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmCloseTerminalModal
        session={{ id: "s1", name: "s1" }}
        onCancel={onCancel}
        onConfirm={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onCancel on Escape key", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmCloseTerminalModal
        session={{ id: "s1", name: "s1" }}
        onCancel={onCancel}
        onConfirm={() => {}}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("Enter on window (no button focused) → onConfirm", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmCloseTerminalModal
        session={{ id: "s1", name: "s1" }}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("Enter with Cancel focused does NOT call onConfirm", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmCloseTerminalModal
        session={{ id: "s1", name: "s1" }}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    cancelBtn.focus();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does not steal focus back to Close when parent re-renders with new callbacks", () => {
    const { rerender } = render(
      <ConfirmCloseTerminalModal
        session={{ id: "s1", name: "s1" }}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    cancelBtn.focus();
    expect(document.activeElement).toBe(cancelBtn);
    rerender(
      <ConfirmCloseTerminalModal
        session={{ id: "s1", name: "s1" }}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(document.activeElement).toBe(cancelBtn);
  });

  it("calls onCancel on backdrop click", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmCloseTerminalModal
        session={{ id: "s1", name: "s1" }}
        onCancel={onCancel}
        onConfirm={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("modal-backdrop"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("single close copy unchanged", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmCloseTerminalModal
        session={{ id: "id-1", name: "claude-ch" }}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    expect(
      screen.getByRole("heading", { name: 'Close terminal "claude-ch"?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The shell will be killed. Output is not saved."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("confirm-close-terminal-confirm")).toHaveTextContent(
      /^Close$/,
    );
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledWith(["id-1"]);
  });

  const three = [
    { id: "a", name: "alpha", working: false },
    { id: "b", name: "beta", working: true },
    { id: "c", name: "gamma", working: true },
  ];

  it("bulk others title counts others", () => {
    render(
      <ConfirmCloseTerminalModal
        bulk={{ sessions: three.slice(0, 2), others: true }}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Close 2 other terminals?" }),
    ).toBeInTheDocument();
  });

  it("bulk all title counts all", () => {
    render(
      <ConfirmCloseTerminalModal
        bulk={{ sessions: three, others: false }}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Close 3 terminals?" }),
    ).toBeInTheDocument();
  });

  it("bulk lists names and Close N button", () => {
    render(
      <ConfirmCloseTerminalModal
        bulk={{ sessions: three, others: false }}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["alpha", "beta", "gamma"]);
    expect(screen.getByRole("button", { name: "Close 3" })).toBeInTheDocument();
  });

  it("working agents are warned about", () => {
    render(
      <ConfirmCloseTerminalModal
        bulk={{ sessions: three, others: false }}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText(/2 have a working agent/)).toBeInTheDocument();
  });

  it("no warning when none are working", () => {
    render(
      <ConfirmCloseTerminalModal
        bulk={{ sessions: three.slice(0, 1), others: false }}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByText(/working agent/)).not.toBeInTheDocument();
  });

  it("Enter confirms bulk with all ids", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmCloseTerminalModal
        bulk={{ sessions: three, others: false }}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith(["a", "b", "c"]);
  });
});
