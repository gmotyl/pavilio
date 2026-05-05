import { Router, type Request, type Response, type NextFunction } from "express";
import { getConfig } from "../config.js";
import {
  detectTailscale,
  enableServe,
  disableServe,
  type TailscaleState,
} from "../lib/tailscale.js";
import { ensureToken, rotateToken, getCurrentToken } from "../lib/mobile-auth.js";
import {
  detectLanIp,
  isWsl,
  getWslVmIp,
  getWslHostGatewayIp,
} from "../lib/lan.js";
import { rebindPanel, getCurrentBindHost } from "../lib/panel-listener.js";

const router = Router();

type LanChannel =
  | { state: "on"; lanIp: string; url: string; qrUrl: string }
  | { state: "off"; lanIp: string | null };

interface HostInfo {
  wsl: boolean;
  wslVmIp: string | null;
}

interface MobileAccessResponse {
  tailscale: TailscaleState & { qrUrl?: string };
  lan: LanChannel;
  host: HostInfo;
}

function loopbackOnly(req: Request, res: Response, next: NextFunction) {
  const addr = (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
  if (addr === "127.0.0.1" || addr === "::1") {
    return next();
  }
  // On WSL2, a browser running on the Windows host reaches the panel via
  // wslrelay or netsh portproxy, which translates the source from
  // 127.0.0.1 (Windows side) into the Windows host's WSL-side gateway IP
  // (172.x.x.1) by the time it lands inside the VM. That's still
  // "this machine" — accept it for the host-only management gate.
  const wslHost = getWslHostGatewayIp();
  if (wslHost && addr === wslHost) {
    return next();
  }
  return res.status(403).json({ error: "loopback only" });
}

router.use(loopbackOnly);

function withTailscaleQr(state: TailscaleState): TailscaleState & { qrUrl?: string } {
  const token = getCurrentToken();
  if (state.state === "on" && token) {
    return { ...state, qrUrl: `${state.url}/#mt=${token}` };
  }
  return state;
}

function buildLanChannel(port: number): LanChannel {
  const lanIp = detectLanIp();
  const bindHost = getCurrentBindHost();
  if (bindHost === "0.0.0.0" && lanIp) {
    const token = getCurrentToken();
    const url = `http://${lanIp}:${port}`;
    const qrUrl = token ? `${url}/#mt=${token}` : url;
    return { state: "on", lanIp, url, qrUrl };
  }
  return { state: "off", lanIp };
}

function buildHostInfo(): HostInfo {
  return { wsl: isWsl(), wslVmIp: getWslVmIp() };
}

async function buildResponse(port: number): Promise<MobileAccessResponse> {
  const tailscale = withTailscaleQr(await detectTailscale(port));
  const lan = buildLanChannel(port);
  return { tailscale, lan, host: buildHostInfo() };
}

router.get("/status", async (_req, res) => {
  const { port } = getConfig();
  res.json(await buildResponse(port));
});

router.post("/enable", async (_req, res) => {
  const { port } = getConfig();
  // Preserve the existing pairing token across toggle cycles; only mint
  // one when there isn't a token yet. Users rotate explicitly via /rotate.
  await ensureToken();
  const ts = withTailscaleQr(await enableServe(port));
  const lan = buildLanChannel(port);
  res.json({ tailscale: ts, lan, host: buildHostInfo() });
});

router.post("/disable", async (_req, res) => {
  const { port } = getConfig();
  // Leave the token in place so re-enabling keeps the same QR code paired.
  // To invalidate paired devices, the user explicitly rotates.
  const ts = withTailscaleQr(await disableServe(port));
  const lan = buildLanChannel(port);
  res.json({ tailscale: ts, lan, host: buildHostInfo() });
});

router.post("/rotate", async (_req, res) => {
  const { port } = getConfig();
  await rotateToken();
  res.json(await buildResponse(port));
});

router.post("/lan/enable", async (_req, res) => {
  const { port } = getConfig();
  const lanIp = detectLanIp();
  if (!lanIp) {
    const tailscale = withTailscaleQr(await detectTailscale(port));
    return res.json({
      tailscale,
      lan: { state: "off", lanIp: null },
      host: buildHostInfo(),
    });
  }
  // First-enable may race with a Tailscale that's never been turned on —
  // make sure a pairing token exists so qrUrl carries `#mt=<token>`.
  await ensureToken();
  try {
    await rebindPanel("0.0.0.0");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const tailscale = withTailscaleQr(await detectTailscale(port));
    return res.status(500).json({
      tailscale,
      lan: { state: "off", lanIp },
      host: buildHostInfo(),
      error: message,
    });
  }
  res.json(await buildResponse(port));
});

router.post("/lan/disable", async (_req, res) => {
  const { port } = getConfig();
  try {
    await rebindPanel("127.0.0.1");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const tailscale = withTailscaleQr(await detectTailscale(port));
    return res.status(500).json({
      tailscale,
      lan: { state: "off", lanIp: detectLanIp() },
      host: buildHostInfo(),
      error: message,
    });
  }
  res.json(await buildResponse(port));
});

export default router;
