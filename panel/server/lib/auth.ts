import type { Request, Response, NextFunction } from "express";

const TOKEN = process.env.PANEL_TOKEN;

export function isAuthEnabled(): boolean {
  return !!TOKEN;
}

function parseCookie(cookie: string | undefined): Record<string, string> {
  if (!cookie) return {};
  return Object.fromEntries(
    cookie
      .split(";")
      .map((c) => c.trim().split("="))
      .filter(([k]) => k)
      .map(([k, ...v]) => [decodeURIComponent(k), decodeURIComponent(v.join("="))])
  );
}

function hasValidToken(req: Request): boolean {
  if (!TOKEN) return true;
  const cookieToken = parseCookie(req.headers.cookie)["panel_token"];
  if (cookieToken === TOKEN) return true;
  const authHeader = req.headers.authorization;
  if (authHeader === `Bearer ${TOKEN}`) return true;
  return false;
}

// Paths that bypass auth (health + login flow)
const PUBLIC_PATHS = new Set(["/api/health", "/api/auth/login", "/api/auth/status"]);

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!TOKEN) return next();
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (hasValidToken(req)) return next();
  // API requests get a 401 JSON. Everything else — the app shell and its
  // assets, whether they come from the built bundle or from Vite on the dev
  // entry — is let through, because an unauthenticated visitor still has to
  // be able to load the SPA far enough to render the Login page.
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}

export function loginHandler(req: Request, res: Response) {
  const { token } = req.body ?? {};
  if (!TOKEN) {
    return res.status(200).json({ ok: true, authRequired: false });
  }
  if (typeof token === "string" && token === TOKEN) {
    res.cookie("panel_token", token, {
      httpOnly: true,
      secure: req.secure,
      sameSite: "strict",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: "Invalid token" });
}

export function logoutHandler(_req: Request, res: Response) {
  res.clearCookie("panel_token");
  res.json({ ok: true });
}

export function statusHandler(req: Request, res: Response) {
  res.json({ authRequired: !!TOKEN, authenticated: !TOKEN || hasValidToken(req) });
}

export function validateWsToken(cookie: string | undefined): boolean {
  if (!TOKEN) return true;
  if (!cookie) return false;
  return parseCookie(cookie)["panel_token"] === TOKEN;
}
