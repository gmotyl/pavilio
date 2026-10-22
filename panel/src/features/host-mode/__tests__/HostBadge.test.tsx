import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { HostBadge } from "../HostBadge";

/**
 * Wiring only: which hostnames are local is `useHostMode.test.ts`'s table
 * (`detectHostMode`). The badge just shows the hostname and carries the mode.
 */
describe("HostBadge", () => {
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

  it("shows the hostname and the mode detected for it", () => {
    for (const [hostname, mode] of [
      ["localhost", "local"],
      ["192.168.10.45", "remote"],
    ]) {
      setHostname(hostname);
      const { unmount } = render(<HostBadge />);
      const badge = screen.getByTestId("host-badge");
      expect(badge.dataset.hostMode).toBe(mode);
      expect(badge.textContent).toContain(hostname);
      unmount();
    }
  });
});
