import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { HostBadge } from "../HostBadge";

describe("HostBadge", () => {
  beforeEach(() => {
    // jsdom default location is http://localhost — override per test.
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function setHostname(hostname: string) {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...window.location, hostname },
    });
  }

  it("renders 'local' style when window hostname is localhost", () => {
    setHostname("localhost");
    render(<HostBadge />);
    const badge = screen.getByTestId("host-badge");
    expect(badge.dataset.hostMode).toBe("local");
    expect(badge.textContent).toContain("localhost");
  });

  it("renders 'local' style when window hostname is 127.0.0.1", () => {
    setHostname("127.0.0.1");
    render(<HostBadge />);
    const badge = screen.getByTestId("host-badge");
    expect(badge.dataset.hostMode).toBe("local");
    expect(badge.textContent).toContain("127.0.0.1");
  });

  it("renders 'remote' style when window hostname is a LAN IP", () => {
    setHostname("192.168.10.45");
    render(<HostBadge />);
    const badge = screen.getByTestId("host-badge");
    expect(badge.dataset.hostMode).toBe("remote");
    expect(badge.textContent).toContain("192.168.10.45");
  });

  it("renders 'remote' style when window hostname is a Tailscale URL", () => {
    setHostname("mac.foo.ts.net");
    render(<HostBadge />);
    const badge = screen.getByTestId("host-badge");
    expect(badge.dataset.hostMode).toBe("remote");
    expect(badge.textContent).toContain("mac.foo.ts.net");
  });

  it("hides on mobile via Tailwind's hidden md:inline-flex classes", () => {
    setHostname("localhost");
    render(<HostBadge />);
    const badge = screen.getByTestId("host-badge");
    expect(badge.className).toContain("hidden");
    expect(badge.className).toContain("md:inline-flex");
  });
});
