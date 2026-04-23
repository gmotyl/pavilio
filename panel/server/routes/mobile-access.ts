import { Router, type Request, type Response, type NextFunction } from "express";
import { getConfig } from "../config.js";
import {
  detectTailscale,
  enableServe,
  disableServe,
} from "../lib/tailscale.js";
import { ensureToken, rotateToken, getCurrentToken } from "../lib/mobile-auth.js";

const router = Router();

function loopbackOnly(req: Request, res: Response, next: NextFunction) {
  const addr = req.socket.remoteAddress ?? "";
  if (addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1") {
    return next();
  }
  return res.status(403).json({ error: "loopback only" });
}

router.use(loopbackOnly);

function toResponse(state: Awaited<ReturnType<typeof detectTailscale>>) {
  const token = getCurrentToken();
  if (state.state === "on" && token) {
    return { ...state, qrUrl: `${state.url}/#mt=${token}` };
  }
  return state;
}

router.get("/status", async (_req, res) => {
  const { port } = getConfig();
  const state = await detectTailscale(port);
  res.json(toResponse(state));
});

router.post("/enable", async (_req, res) => {
  const { port } = getConfig();
  // Preserve the existing pairing token across toggle cycles; only mint
  // one when there isn't a token yet. Users rotate explicitly via /rotate.
  await ensureToken();
  const state = await enableServe(port);
  res.json(toResponse(state));
});

router.post("/disable", async (_req, res) => {
  const { port } = getConfig();
  // Leave the token in place so re-enabling keeps the same QR code paired.
  // To invalidate paired devices, the user explicitly rotates.
  const state = await disableServe(port);
  res.json(toResponse(state));
});

router.post("/rotate", async (_req, res) => {
  const { port } = getConfig();
  await rotateToken();
  const state = await detectTailscale(port);
  res.json(toResponse(state));
});

export default router;
