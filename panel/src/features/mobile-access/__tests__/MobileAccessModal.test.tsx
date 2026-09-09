import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MobileAccessModal } from "../MobileAccessModal";
import type { MobileAccessStatus } from "../useMobileAccessStatus";

const status = vi.hoisted(() => ({ current: null as MobileAccessStatus | null }));

vi.mock("../useMobileAccessStatus", () => ({
  useMobileAccessStatus: () => ({
    status: status.current,
    refresh: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    rotate: vi.fn(),
    enableLan: vi.fn(),
    disableLan: vi.fn(),
  }),
}));

const notInstalledOn = (platform: "darwin" | "linux" | "wsl" | "win32") =>
  ({
    tailscale: { state: "not_installed" },
    lan: { state: "off", lanIp: null },
    host: { wsl: platform === "wsl", wslVmIp: null, platform },
  }) as MobileAccessStatus;

beforeEach(() => {
  status.current = null;
});

describe("MobileAccessModal", () => {
  it("passes the host platform into the install pane", () => {
    status.current = notInstalledOn("wsl");
    const { container } = render(<MobileAccessModal onClose={() => {}} />);
    expect(
      screen.getByText(/install tailscale in this wsl distro/i),
    ).toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(/brew/i);
  });

  it("renders Loading before the first status", () => {
    const { container } = render(<MobileAccessModal onClose={() => {}} />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(/install tailscale/i);
    expect(container.textContent ?? "").not.toMatch(/sign in to tailscale/i);
    expect(container.querySelector("pre")).toBeNull();
  });

  it("renders the Mac pane on a darwin host", () => {
    status.current = notInstalledOn("darwin");
    render(<MobileAccessModal onClose={() => {}} />);
    expect(
      screen.getByText(/install tailscale on this mac/i),
    ).toBeInTheDocument();
    expect(screen.getByText("brew install --cask tailscale")).toBeInTheDocument();
  });
});
