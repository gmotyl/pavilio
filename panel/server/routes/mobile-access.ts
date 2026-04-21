import { Router, type Request, type Response, type NextFunction } from "express";
import { getConfig } from "../config.js";
import {
  detectTailscale,
  enableServe,
  disableServe,
} from "../lib/tailscale.js";
import { rotateToken, clearToken, getCurrentToken } from "../lib/mobile-auth.js";

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
  await rotateToken();
  const state = await enableServe(port);
  res.json(toResponse(state));
});

router.post("/disable", async (_req, res) => {
  const { port } = getConfig();
  const state = await disableServe(port);
  await clearToken();
  res.json(toResponse(state));
});

export default router;
