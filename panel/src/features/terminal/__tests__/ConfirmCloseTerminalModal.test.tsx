import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmCloseTerminalModal } from "../ConfirmCloseTerminalModal";

describe("ConfirmCloseTerminalModal", () => {
  it("does not render when sessionName is null", () => {
    render(
      <ConfirmCloseTerminalModal
        sessionName={null}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("renders with session name in title", () => {
    render(
      <ConfirmCloseTerminalModal
        sessionName="claude-ch"
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
        sessionName="s1"
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
        sessionName="s1"
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
        sessionName="s1"
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
        sessionName="s1"
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
        sessionName="s1"
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
        sessionName="s1"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    cancelBtn.focus();
    expect(document.activeElement).toBe(cancelBtn);
    rerender(
      <ConfirmCloseTerminalModal
        sessionName="s1"
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
        sessionName="s1"
        onCancel={onCancel}
        onConfirm={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("modal-backdrop"));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
