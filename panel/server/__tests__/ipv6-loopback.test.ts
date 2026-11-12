import { describe, it, expect, afterEach, vi } from "vitest";
import { createServer, request, type Server } from "http";
import { createServer as createNetServer, type Server as NetServer, type AddressInfo } from "net";
import { listenIpv6Loopback } from "../lib/ipv6-loopback.js";

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
  it("serves the panel's own handler on [::1] with a loopback remote address", async () => {
    const { server, port } = await ipv4Panel();
    const companion = await listenIpv6Loopback(server, port);
    expect(companion).not.toBeNull();
    closeLater(companion!);

    expect(await get("::1", port)).toBe("remote=::1");
    // The IPv4 bind is untouched.
    expect(await get("127.0.0.1", port)).toBe("remote=127.0.0.1");
  });

  it("warns and resolves null when [::1]:<port> is already taken", async () => {
    const { server, port } = await ipv4Panel();
    const squatter = createNetServer();
    await new Promise<void>((r) => squatter.listen({ port, host: "::1", ipv6Only: true }, r));
    closeLater(squatter);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(listenIpv6Loopback(server, port)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("EADDRINUSE"));
  });
});
