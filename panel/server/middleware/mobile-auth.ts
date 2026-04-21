import type { Request, Response, NextFunction } from "express";
import { verifySessionCookie } from "../lib/mobile-auth.js";

function hostnameOf(req: Request): string {
  const raw = (req.headers.host ?? "").toLowerCase();
  return raw.split(":")[0] ?? "";
}

function isLocal(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

export function mobileAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path === "/api/auth/mobile-login") return next();
  if (isLocal(hostnameOf(req))) return next();
  if (verifySessionCookie(req)) return next();
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "mobile pairing required" });
  }
  return next();
}
