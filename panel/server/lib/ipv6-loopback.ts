import type { Server } from "http";
import { createServer as createNetServer, type Server as NetServer } from "net";

/**
 * A second loopback listener on `[::1]:<port>` that hands every accepted socket
 * to the panel's own HTTP(S) server — same handlers, same TLS, same WebSocket
 * upgrades; only the address differs.
 *
 * Why it exists: on WSL2, Windows' `localhost` reaches a WSL listener through
 * wslrelay, which mirrors each Linux loopback socket onto the same address on
 * the Windows side. Pavilio's LAN setup adds a `netsh portproxy` on
 * `0.0.0.0:<port>`, and once that holds the IPv4 port, wslrelay can no longer
 * claim `127.0.0.1:<port>` — so after any in-session panel restart the Windows
 * browser lands on the portproxy instead and gets a reset. IPv6 does not
 * collide with that IPv4 entry: wslrelay can still claim `[::1]:<port>`, and
 * Windows resolves `localhost` to `::1` first. Listening here keeps
 * `http://localhost:<port>` working from the Windows host across restarts.
 *
 * Purely additive: a host without IPv6, or a port someone else already holds
 * on `::1`, costs one warning line and the panel carries on IPv4-only. Never
 * rejects. Resolves to the listener, or `null` when it could not bind.
 */
export function listenIpv6Loopback(server: Server, port: number): Promise<NetServer | null> {
  return new Promise((resolve) => {
    const companion = createNetServer((socket) => {
      server.emit("connection", socket);
    });
    companion.once("error", (err: NodeJS.ErrnoException) => {
      console.warn(`Panel: no IPv6 loopback listener on [::1]:${port} (${err.code ?? err.message}) — IPv4 only`);
      companion.close();
      resolve(null);
    });
    companion.listen({ port, host: "::1", ipv6Only: true }, () => {
      // Deliberately not "Panel bound to …": scripts/panel reads that line back
      // out of the log to learn the port, and must keep finding the IPv4 one.
      console.log(`Panel also listening on [::1]:${port} (IPv6 loopback)`);
      resolve(companion);
    });
  });
}
