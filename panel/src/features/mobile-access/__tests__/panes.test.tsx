import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NotInstalledPane } from "../MobileAccessModal/NotInstalledPane";
import { NotLoggedInPane } from "../MobileAccessModal/NotLoggedInPane";
import { OffPane } from "../MobileAccessModal/OffPane";
import { ErrorPane } from "../MobileAccessModal/ErrorPane";

describe("NotInstalledPane", () => {
  it("shows brew install command and refresh button", () => {
    const refresh = vi.fn();
    render(<NotInstalledPane onRefresh={refresh} />);
    expect(screen.getByText(/brew install --cask tailscale/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /installed/i }));
    expect(refresh).toHaveBeenCalled();
  });
});

describe("NotLoggedInPane", () => {
  it("shows tailscale up command and refresh button", () => {
    const refresh = vi.fn();
    render(<NotLoggedInPane onRefresh={refresh} />);
    expect(screen.getByText(/tailscale up/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /signed in/i }));
    expect(refresh).toHaveBeenCalled();
  });
});

describe("OffPane", () => {
  it("enable button calls onEnable", () => {
    const enable = vi.fn();
    render(<OffPane onEnable={enable} />);
    fireEvent.click(screen.getByRole("button", { name: /enable mobile access/i }));
    expect(enable).toHaveBeenCalled();
  });
});

describe("ErrorPane", () => {
  it("shows error text", () => {
    render(<ErrorPane error="boom" />);
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });

  it("https_not_enabled hint renders admin link", () => {
    render(<ErrorPane error="x" hint="https_not_enabled" />);
    const link = screen.getByRole("link", { name: /admin/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("login.tailscale.com/admin"));
  });
});
