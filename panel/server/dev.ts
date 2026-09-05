import { createServer as createViteServer } from "vite";
import { findFreePort, startPanel } from "./panel-server.js";

async function startDev(): Promise<void> {
  const hmrPort = await findFreePort(24678);
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: { port: hmrPort },
      // The panel binds to 127.0.0.1 by default. When Tailscale serve or the
      // LAN-access toggle is enabled, requests arrive with a non-loopback
      // Host header (`<mac>.<tail>.ts.net` via tailnet, or `<lan-ip>` via LAN
      // rebind). Vite's default DNS-rebind protection is the wrong threat
      // model here — every non-loopback request is already gated by the
      // mobile-auth middleware. Disabling the allowlist lets any Host through
      // to the middleware layer, which is where the real check happens.
      allowedHosts: true,
    },
    appType: "spa",
  });

  await startPanel((app) => {
    app.use(vite.middlewares);
  });
}

startDev();
