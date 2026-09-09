import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MobileAccessModal } from "../MobileAccessModal";
import type { MobileAccessStatus } from "../useMobileAccessStatus";
import { SETUP_GUIDE_WSL_URL } from "../setupGuide";

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

type Platform = "darwin" | "linux" | "wsl" | "win32";

const statusOn = (
  platform: Platform,
  tailscale: MobileAccessStatus["tailscale"],
) =>
  ({
    tailscale,
    lan: { state: "off", lanIp: null },
    host: { wsl: platform === "wsl", wslVmIp: null, platform },
  }) as MobileAccessStatus;

const notInstalledOn = (platform: Platform) =>
  statusOn(platform, { state: "not_installed" });

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

  it("degrades to the generic pane when the payload carries no host info", () => {
    // An older server, or a partial response, sends no `host` key.
    status.current = {
      tailscale: { state: "not_installed" },
      lan: { state: "off", lanIp: null },
    } as unknown as MobileAccessStatus;
    expect(() => render(<MobileAccessModal onClose={() => {}} />)).not.toThrow();
    expect(
      screen.getByText(/install tailscale on this host/i),
    ).toBeInTheDocument();
  });

  it("passes the host platform into the sign-in pane", () => {
    status.current = statusOn("wsl", { state: "not_logged_in" });
    const { container } = render(<MobileAccessModal onClose={() => {}} />);
    expect(screen.getByText(/sign in to tailscale/i)).toBeInTheDocument();
    expect(screen.getByText("sudo tailscale up")).toBeInTheDocument();
    expect(screen.getByText(/windows browser/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /setup guide/i })).toHaveAttribute(
      "href",
      SETUP_GUIDE_WSL_URL,
    );
    expect(container.textContent ?? "").not.toMatch(/install tailscale/i);
  });

  it("passes the host platform into the error pane", () => {
    status.current = statusOn("wsl", {
      state: "error",
      error: "tailscaled is not running on this host. Start it, then try again.",
      hint: "daemon_down",
    });
    const { container } = render(<MobileAccessModal onClose={() => {}} />);
    expect(screen.getByText(/tailscaled isn't running/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /setup guide/i })).toHaveAttribute(
      "href",
      SETUP_GUIDE_WSL_URL,
    );
    // ADR 0009: no start command is printed anywhere in the modal.
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
