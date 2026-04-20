import { Router, type Request, type Response } from "express";
import { verifyLoginToken, issueSessionCookie } from "../lib/mobile-auth.js";

const router = Router();

router.post("/mobile-login", (req: Request, res: Response) => {
  const token = req.body?.token;
  if (typeof token !== "string" || !token) {
    return res.status(400).json({ error: "missing token" });
  }
  if (!verifyLoginToken(token)) {
    return res.status(401).json({ error: "invalid token" });
  }
  issueSessionCookie(res);
  return res.json({ ok: true });
});

export default router;
