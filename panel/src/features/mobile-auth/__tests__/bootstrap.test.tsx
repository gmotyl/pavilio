import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MobileAuthBootstrap } from "../MobileAuthBootstrap";

let reload: ReturnType<typeof vi.fn>;

function setHost(host: string) {
  Object.defineProperty(window, "location", {
    writable: true,
    value: { ...window.location, hostname: host, hash: "", pathname: "/", search: "", reload },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  reload = vi.fn();
  global.fetch = vi.fn();
});

describe("MobileAuthBootstrap", () => {
  it("passes through children on localhost", async () => {
    setHost("localhost");
    render(
      <MobileAuthBootstrap>
        <div>app</div>
      </MobileAuthBootstrap>
    );
    await waitFor(() => expect(screen.getByText("app")).toBeInTheDocument());
    expect(fetch).not.toHaveBeenCalled();
  });

  it("on .ts.net with #mt=token posts login and reloads on success", async () => {
    // Not "renders children": this document was fetched before the cookie
    // existed, so its blocking `/api/preferences.js` 401'd. Mounting the app on
    // it would leave every portable preference stuck on its default and every
    // portable write dropped — see preferences/__tests__/auth-interlock.test.tsx.
    setHost("mac.foo.ts.net");
    window.location.hash = "#mt=ABC";
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    render(
      <MobileAuthBootstrap>
        <div>app</div>
      </MobileAuthBootstrap>
    );
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("app")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/mobile-login",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("on remote host without fragment: probes /api/auth/status; authenticated=true renders children", async () => {
    setHost("192.168.10.45");
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ authRequired: true, authenticated: true }),
    });
    render(
      <MobileAuthBootstrap>
        <div>app</div>
      </MobileAuthBootstrap>,
    );
    await waitFor(() => expect(screen.getByText("app")).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/status",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("on remote host without cookie and without fragment renders PairingGate", async () => {
    setHost("mac.foo.ts.net");
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ authRequired: true, authenticated: false }),
    });
    render(
      <MobileAuthBootstrap>
        <div>app</div>
      </MobileAuthBootstrap>
    );
    await waitFor(() => expect(screen.getByText(/scan a fresh QR/i)).toBeInTheDocument());
    expect(screen.queryByText("app")).not.toBeInTheDocument();
  });
});
