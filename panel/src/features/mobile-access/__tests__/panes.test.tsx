import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

import { OnPane } from "../MobileAccessModal/OnPane";

vi.mock("../qr", () => ({ renderQrSvg: async (s: string) => `<svg data-url="${s}"></svg>` }));

describe("OnPane", () => {
  const state = {
    state: "on" as const,
    selfHost: "mac.foo.ts.net",
    url: "https://mac.foo.ts.net",
    qrUrl: "https://mac.foo.ts.net/#mt=XYZ",
  };

  it("renders QR SVG embedding qrUrl", async () => {
    const { container } = render(<OnPane status={state} onDisable={() => {}} onRegenerate={() => {}} />);
    await waitFor(() => {
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("data-url")).toBe(state.qrUrl);
    });
  });

  it("disable button calls onDisable", () => {
    const disable = vi.fn();
    render(<OnPane status={state} onDisable={disable} onRegenerate={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /disable mobile access/i }));
    expect(disable).toHaveBeenCalled();
  });

  it("regenerate button calls onRegenerate", () => {
    const regen = vi.fn();
    render(<OnPane status={state} onDisable={() => {}} onRegenerate={regen} />);
    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));
    expect(regen).toHaveBeenCalled();
  });

  it("shows URL", () => {
    render(<OnPane status={state} onDisable={() => {}} onRegenerate={() => {}} />);
    expect(screen.getByText(state.url)).toBeInTheDocument();
  });
});
