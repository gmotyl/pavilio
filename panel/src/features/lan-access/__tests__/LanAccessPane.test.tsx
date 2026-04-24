import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LanAccessPane } from "../LanAccessModal/LanAccessPane";

vi.mock("../../mobile-access/qr", () => ({
  renderQrSvg: async (s: string) => `<svg data-url="${s}"></svg>`,
}));

describe("LanAccessPane (off state, has interface)", () => {
  const off = { state: "off" as const, lanIp: "192.168.1.42" };

  it("toggle switch turns on → calls onEnable", () => {
    const enable = vi.fn();
    render(
      <LanAccessPane
        lan={off}
        onEnable={enable}
        onDisable={() => {}}
        onRegenerate={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /lan access/i }));
    expect(enable).toHaveBeenCalled();
  });

  it("shows toggle-on prompt", () => {
    render(
      <LanAccessPane
        lan={off}
        onEnable={() => {}}
        onDisable={() => {}}
        onRegenerate={() => {}}
      />,
    );
    expect(screen.getByText(/toggle on to show lan link/i)).toBeInTheDocument();
  });
});

describe("LanAccessPane (off state, no interface)", () => {
  const empty = { state: "off" as const, lanIp: null };

  it("shows 'No LAN network detected' empty state", () => {
    render(
      <LanAccessPane
        lan={empty}
        onEnable={() => {}}
        onDisable={() => {}}
        onRegenerate={() => {}}
      />,
    );
    expect(
      screen.getByText(/no lan network detected/i),
    ).toBeInTheDocument();
  });

  it("disables the toggle", () => {
    render(
      <LanAccessPane
        lan={empty}
        onEnable={() => {}}
        onDisable={() => {}}
        onRegenerate={() => {}}
      />,
    );
    const toggle = screen.getByRole("switch", { name: /lan access/i });
    expect(toggle).toBeDisabled();
  });
});

describe("LanAccessPane (on state)", () => {
  const on = {
    state: "on" as const,
    lanIp: "192.168.1.42",
    url: "http://192.168.1.42:3010",
    qrUrl: "http://192.168.1.42:3010/#mt=TKN",
  };

  it("renders QR with qrUrl", async () => {
    const { container } = render(
      <LanAccessPane
        lan={on}
        onEnable={() => {}}
        onDisable={() => {}}
        onRegenerate={() => {}}
      />,
    );
    await waitFor(() => {
      const svg = container.querySelector("svg[data-url]");
      expect(svg?.getAttribute("data-url")).toBe(on.qrUrl);
    });
  });

  it("renders the qrUrl as a clickable anchor, not plain text", () => {
    render(
      <LanAccessPane
        lan={on}
        onEnable={() => {}}
        onDisable={() => {}}
        onRegenerate={() => {}}
      />,
    );
    const link = screen.getByRole("link", { name: on.qrUrl });
    expect(link).toHaveAttribute("href", on.qrUrl);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("toggle switch turns off → calls onDisable", () => {
    const disable = vi.fn();
    render(
      <LanAccessPane
        lan={on}
        onEnable={() => {}}
        onDisable={disable}
        onRegenerate={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /lan access/i }));
    expect(disable).toHaveBeenCalled();
  });

  it("rotate button calls onRegenerate", () => {
    const regen = vi.fn();
    render(
      <LanAccessPane
        lan={on}
        onEnable={() => {}}
        onDisable={() => {}}
        onRegenerate={regen}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /rotate pairing token/i }),
    );
    expect(regen).toHaveBeenCalled();
  });

  it("shows the cleartext-warning row", () => {
    render(
      <LanAccessPane
        lan={on}
        onEnable={() => {}}
        onDisable={() => {}}
        onRegenerate={() => {}}
      />,
    );
    expect(
      screen.getByText(/cleartext over lan/i),
    ).toBeInTheDocument();
  });

  it("clicking the ! icon reveals a GitHub-issue link", () => {
    render(
      <LanAccessPane
        lan={on}
        onEnable={() => {}}
        onDisable={() => {}}
        onRegenerate={() => {}}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /cleartext warning details/i }),
    );
    const link = screen.getByRole("link", { name: /request https support/i });
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining("github.com/gmotyl/pavilio/issues/new"),
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("shows a WSL portproxy callout when host.wsl is true, with the WSL VM IP pre-filled", () => {
    render(
      <LanAccessPane
        lan={on}
        host={{ wsl: true, wslVmIp: "172.26.2.49" }}
        onEnable={() => {}}
        onDisable={() => {}}
        onRegenerate={() => {}}
      />,
    );
    expect(screen.getByText(/wsl2 detected/i)).toBeInTheDocument();
    expect(
      screen.getByText(/netsh interface portproxy add/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/172\.26\.2\.49/)).toBeInTheDocument();
  });

  it("does not show WSL callout when host.wsl is false", () => {
    render(
      <LanAccessPane
        lan={on}
        host={{ wsl: false, wslVmIp: null }}
        onEnable={() => {}}
        onDisable={() => {}}
        onRegenerate={() => {}}
      />,
    );
    expect(screen.queryByText(/wsl2 detected/i)).toBeNull();
  });
});
