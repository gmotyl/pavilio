import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NotInstalledPane } from "../MobileAccessModal/NotInstalledPane";
import { NotLoggedInPane } from "../MobileAccessModal/NotLoggedInPane";
import { AccessPane } from "../MobileAccessModal/AccessPane";
import { ErrorPane } from "../MobileAccessModal/ErrorPane";
import {
  SETUP_GUIDE_URL,
  SETUP_GUIDE_WSL_URL,
  type HostPlatform,
} from "../setupGuide";

vi.mock("../qr", () => ({
  renderQrSvg: async (s: string) => `<svg data-url="${s}"></svg>`,
}));

describe("NotInstalledPane", () => {
  it("shows brew install command and refresh button", () => {
    const refresh = vi.fn();
    render(<NotInstalledPane platform="darwin" onRefresh={refresh} />);
    expect(screen.getByText(/brew install --cask tailscale/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /installed/i }));
    expect(refresh).toHaveBeenCalled();
  });

  it("offers the Homebrew command on darwin", () => {
    render(<NotInstalledPane platform="darwin" onRefresh={() => {}} />);
    expect(screen.getByText(/install tailscale on this mac/i)).toBeInTheDocument();
    expect(screen.getByText("brew install --cask tailscale")).toBeInTheDocument();
  });

  it("offers the Linux installer inside a WSL distro and never mentions brew", () => {
    const { container } = render(
      <NotInstalledPane platform="wsl" onRefresh={() => {}} />,
    );
    expect(
      screen.getByText(/install tailscale in this wsl distro/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText("curl -fsSL https://tailscale.com/install.sh | sh"),
    ).toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(/brew/i);
  });

  it("explains the missing systemd and links the WSL setup guide on wsl", () => {
    render(<NotInstalledPane platform="wsl" onRefresh={() => {}} />);
    expect(screen.getByText(/no systemd/i)).toBeInTheDocument();
    expect(screen.getByText(/boot hook/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /setup guide/i })).toHaveAttribute(
      "href",
      SETUP_GUIDE_WSL_URL,
    );
  });

  it("offers the Linux installer without WSL wording on linux", () => {
    const { container } = render(
      <NotInstalledPane platform="linux" onRefresh={() => {}} />,
    );
    expect(
      screen.getByText("curl -fsSL https://tailscale.com/install.sh | sh"),
    ).toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(/wsl/i);
    expect(container.textContent ?? "").not.toMatch(/systemd/i);
  });

  it("offers the winget command on win32", () => {
    render(<NotInstalledPane platform="win32" onRefresh={() => {}} />);
    expect(screen.getByText(/install tailscale on windows/i)).toBeInTheDocument();
    expect(screen.getByText("winget install tailscale.tailscale")).toBeInTheDocument();
  });

  it("keeps the recheck button on every platform", () => {
    const platforms: HostPlatform[] = ["darwin", "linux", "wsl", "win32"];
    for (const platform of platforms) {
      const refresh = vi.fn();
      const { unmount, getByTestId } = render(
        <NotInstalledPane platform={platform} onRefresh={refresh} />,
      );
      fireEvent.click(getByTestId("mobile-access-not-installed-refresh"));
      expect(refresh).toHaveBeenCalled();
      unmount();
    }
  });
});

describe("NotLoggedInPane", () => {
  it("shows tailscale up command and refresh button", () => {
    const refresh = vi.fn();
    render(<NotLoggedInPane platform="darwin" onRefresh={refresh} />);
    expect(screen.getByText(/tailscale up/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /signed in/i }));
    expect(refresh).toHaveBeenCalled();
  });

  it("asks for sudo tailscale up and explains the auth URL on wsl", () => {
    const refresh = vi.fn();
    render(<NotLoggedInPane platform="wsl" onRefresh={refresh} />);
    expect(screen.getByText("sudo tailscale up")).toBeInTheDocument();
    expect(screen.getByText(/windows browser/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("mobile-access-not-logged-in-refresh"));
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the plain tailscale up copy on darwin", () => {
    const { container } = render(
      <NotLoggedInPane platform="darwin" onRefresh={() => {}} />,
    );
    expect(screen.getByText("tailscale up")).toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(/sudo/i);
    expect(container.textContent ?? "").not.toMatch(/windows/i);
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

  it("names the stopped daemon and links the WSL guide for daemon_down", () => {
    const { container } = render(<ErrorPane error="x" hint="daemon_down" />);
    expect(screen.getByText(/tailscaled isn't running/i)).toBeInTheDocument();
    expect(screen.getByText("sudo tailscaled")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /setup guide/i })).toHaveAttribute(
      "href",
      SETUP_GUIDE_WSL_URL,
    );
    expect(container.textContent ?? "").not.toMatch(/https certificates/i);
  });

  it("keeps the tailnet admin copy for https_not_enabled", () => {
    render(<ErrorPane error="x" hint="https_not_enabled" />);
    expect(screen.getByText(/https certificates must be enabled/i)).toBeInTheDocument();
    expect(screen.queryByText(/tailscaled isn't running/i)).toBeNull();
  });

  it("links the setup guide for an unhinted error", () => {
    render(<ErrorPane error="boom" />);
    expect(screen.getByText(/boom/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /setup guide/i })).toHaveAttribute(
      "href",
      SETUP_GUIDE_URL,
    );
  });
});

describe("AccessPane (off state)", () => {
  const offState = { state: "off" as const, selfHost: "mac.foo.ts.net" };

  it("toggle switch turns on → calls onEnable", () => {
    const enable = vi.fn();
    render(
      <AccessPane
        status={offState}
        onEnable={enable}
        onDisable={() => {}}
        onRegenerate={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /mobile access/i }));
    expect(enable).toHaveBeenCalled();
  });

  it("shows hint to toggle on", () => {
    render(
      <AccessPane
        status={offState}
        onEnable={() => {}}
        onDisable={() => {}}
        onRegenerate={() => {}}
      />,
    );
    expect(screen.getByText(/toggle on to pair/i)).toBeInTheDocument();
  });
});

describe("AccessPane (on state)", () => {
  const onState = {
    state: "on" as const,
    selfHost: "mac.foo.ts.net",
    url: "https://mac.foo.ts.net",
    qrUrl: "https://mac.foo.ts.net/#mt=XYZ",
  };

  it("renders QR SVG embedding qrUrl", async () => {
    const { container } = render(
      <AccessPane
        status={onState}
        onEnable={() => {}}
        onDisable={() => {}}
        onRegenerate={() => {}}
      />,
    );
    await waitFor(() => {
      const svg = container.querySelector("svg[data-url]");
      expect(svg?.getAttribute("data-url")).toBe(onState.qrUrl);
    });
  });

  it("toggle switch turns off → calls onDisable", () => {
    const disable = vi.fn();
    render(
      <AccessPane
        status={onState}
        onEnable={() => {}}
        onDisable={disable}
        onRegenerate={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /mobile access/i }));
    expect(disable).toHaveBeenCalled();
  });

  it("regenerate button calls onRegenerate", () => {
    const regen = vi.fn();
    render(
      <AccessPane
        status={onState}
        onEnable={() => {}}
        onDisable={() => {}}
        onRegenerate={regen}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /rotate pairing token/i }));
    expect(regen).toHaveBeenCalled();
  });

  it("renders the self-pairing qrUrl as a clickable anchor, not a plain URL", () => {
    render(
      <AccessPane
        status={onState}
        onEnable={() => {}}
        onDisable={() => {}}
        onRegenerate={() => {}}
      />,
    );
    const link = screen.getByRole("link", { name: onState.qrUrl });
    expect(link).toHaveAttribute("href", onState.qrUrl);
    expect(link).toHaveAttribute("target", "_blank");
  });
});
