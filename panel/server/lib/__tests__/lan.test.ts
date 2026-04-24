import { describe, it, expect } from "vitest";
import type { NetworkInterfaceInfo } from "os";
import { detectLanIp } from "../lan";

const notWsl = () => false;
const noWslHost = () => null;

function addr(
  address: string,
  opts: { internal?: boolean; family?: "IPv4" | "IPv6" } = {},
): NetworkInterfaceInfo {
  return {
    address,
    netmask: "255.255.255.0",
    family: opts.family ?? "IPv4",
    mac: "00:00:00:00:00:00",
    internal: opts.internal ?? false,
    cidr: `${address}/24`,
  } as NetworkInterfaceInfo;
}

function makeStub(
  ifaces: Record<string, NetworkInterfaceInfo[]>,
): () => NodeJS.Dict<NetworkInterfaceInfo[]> {
  return () => ifaces;
}

describe("detectLanIp — WSL path", () => {
  it("uses Windows host IP when WSL is detected and powershell returns an IP", () => {
    const stub = makeStub({
      eth0: [addr("172.26.2.49")], // typical WSL2 NAT'd IP
    });
    const wsl = () => true;
    const hostIp = () => "192.168.10.45";
    expect(detectLanIp(stub, hostIp, wsl)).toBe("192.168.10.45");
  });

  it("falls back to local heuristic when WSL host IP lookup fails", () => {
    const stub = makeStub({
      en0: [addr("192.168.1.10")],
    });
    const wsl = () => true;
    const hostIp = () => null;
    expect(detectLanIp(stub, hostIp, wsl)).toBe("192.168.1.10");
  });

  it("PANEL_LAN_IP env var takes precedence over everything", () => {
    process.env.PANEL_LAN_IP = "10.0.0.99";
    try {
      const stub = makeStub({
        en0: [addr("192.168.1.10")],
      });
      expect(detectLanIp(stub, () => "192.168.10.45", () => true)).toBe(
        "10.0.0.99",
      );
    } finally {
      delete process.env.PANEL_LAN_IP;
    }
  });
});

describe("detectLanIp", () => {
  it("returns a single Wi-Fi IP", () => {
    const stub = makeStub({
      lo0: [addr("127.0.0.1", { internal: true })],
      en0: [addr("192.168.1.42")],
    });
    expect(detectLanIp(stub, noWslHost, notWsl)).toBe("192.168.1.42");
  });

  it("prefers en0 over eth0 when both present (macOS-style)", () => {
    const stub = makeStub({
      en0: [addr("192.168.1.50")],
      eth0: [addr("10.0.0.5")],
    });
    expect(detectLanIp(stub, noWslHost, notWsl)).toBe("192.168.1.50");
  });

  it("prefers eth0 when en0 is absent (Linux-style)", () => {
    const stub = makeStub({
      eth0: [addr("10.0.0.5")],
      docker0: [addr("172.17.0.1")],
    });
    expect(detectLanIp(stub, noWslHost, notWsl)).toBe("10.0.0.5");
  });

  it("skips internal (loopback) addresses", () => {
    const stub = makeStub({
      lo0: [addr("127.0.0.1", { internal: true })],
    });
    expect(detectLanIp(stub, noWslHost, notWsl)).toBeNull();
  });

  it("skips link-local 169.254/16", () => {
    const stub = makeStub({
      en0: [addr("169.254.10.20")],
    });
    expect(detectLanIp(stub, noWslHost, notWsl)).toBeNull();
  });

  it("skips Tailscale CGNAT range 100.64.0.0/10", () => {
    const stub = makeStub({
      tailscale0: [addr("100.100.10.5")],
    });
    expect(detectLanIp(stub, noWslHost, notWsl)).toBeNull();
  });

  it("skips IPv6 addresses", () => {
    const stub = makeStub({
      en0: [addr("fe80::1", { family: "IPv6" })],
    });
    expect(detectLanIp(stub, noWslHost, notWsl)).toBeNull();
  });

  it("keeps only RFC1918 ranges — public IPs are ignored", () => {
    const stub = makeStub({
      en0: [addr("203.0.113.5")],
    });
    expect(detectLanIp(stub, noWslHost, notWsl)).toBeNull();
  });

  it("returns null when no interfaces are present", () => {
    expect(detectLanIp(makeStub({}))).toBeNull();
  });

  it("picks Wi-Fi over docker0 (priority + RFC1918 both covered)", () => {
    const stub = makeStub({
      docker0: [addr("172.17.0.1")],
      en0: [addr("192.168.1.100")],
    });
    expect(detectLanIp(stub, noWslHost, notWsl)).toBe("192.168.1.100");
  });
});
