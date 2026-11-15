import { describe, it, expect, afterEach, vi } from "vitest";
import { createServer, request, type Server } from "http";
import { createServer as createNetServer, Server as NetServerClass, type Server as NetServer, type AddressInfo } from "net";
import { closeIpv6Loopback, listenIpv6Loopback } from "../lib/ipv6-loopback.js";

/**
 * Whether this host can bind `[::1]` at all. Containers and CI runners without
 * IPv6 cannot, and there the listener's whole job is to warn and step aside —
 * which the EAFNOSUPPORT test covers on every host.
 */
async function ipv6LoopbackWorks(): Promise<boolean> {
  const probe = createNetServer();
  return new Promise((resolve) => {
    probe.once("error", () => resolve(false));
    probe.listen({ port: 0, host: "::1", ipv6Only: true }, () => probe.close(() => resolve(true)));
  });
}
const hasIpv6Loopback = await ipv6LoopbackWorks();

const closers: Array<() => Promise<void>> = [];

function closeLater(s: Server | NetServer) {
  closers.push(() => new Promise((r) => s.close(() => r())));
}

afterEach(async () => {
  while (closers.length) await closers.pop()!();
  vi.restoreAllMocks();
});

async function ipv4Panel(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => res.end(`remote=${req.socket.remoteAddress}`));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  closeLater(server);
  return { server, port: (server.address() as AddressInfo).port };
}

function get(host: string, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    request({ host, port, path: "/", family: host.includes(":") ? 6 : 4 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c)).on("end", () => resolve(body));
    })
      .on("error", reject)
      .end();
  });
}

describe("listenIpv6Loopback", () => {
  it.runIf(hasIpv6Loopback)("serves the panel's own handler on [::1] with a loopback remote address", async () => {
    const { server, port } = await ipv4Panel();
    const companion = await listenIpv6Loopback(server, port);
    expect(companion).not.toBeNull();
    closeLater(companion!);

    expect(await get("::1", port)).toBe("remote=::1");
    // The IPv4 bind is untouched.
    expect(await get("127.0.0.1", port)).toBe("remote=127.0.0.1");
  });

  it.runIf(hasIpv6Loopback)("warns and resolves null when [::1]:<port> is already taken", async () => {
    const { server, port } = await ipv4Panel();
    const squatter = createNetServer();
    await new Promise<void>((r) => squatter.listen({ port, host: "::1", ipv6Only: true }, r));
    closeLater(squatter);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(listenIpv6Loopback(server, port)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("EADDRINUSE"));
  });

  it.runIf(hasIpv6Loopback)("closeIpv6Loopback() frees [::1]:<port>", async () => {
    const { server, port } = await ipv4Panel();
    expect(await listenIpv6Loopback(server, port)).not.toBeNull();

    await closeIpv6Loopback();

    const probe = createNetServer();
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen({ port, host: "::1", ipv6Only: true }, () => resolve());
    });
    closeLater(probe);
  });

  it("warns and resolves null on a host without IPv6 (EAFNOSUPPORT)", async () => {
    // Runs everywhere: the bind failure is simulated, not needed from the host.
    const { server, port } = await ipv4Panel();
    vi.spyOn(NetServerClass.prototype, "listen").mockImplementation(function (this: NetServer) {
      const err = Object.assign(new Error("listen EAFNOSUPPORT: address family not supported ::1"), {
        code: "EAFNOSUPPORT",
      });
      process.nextTick(() => this.emit("error", err));
      return this;
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(listenIpv6Loopback(server, port)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("EAFNOSUPPORT"));
  });
});
