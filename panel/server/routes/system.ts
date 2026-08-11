import { Router } from "express";

/**
 * Tiny system-info endpoint. Currently just tells the client whether the
 * server process is running inside WSL and, if so, which distro — the
 * client needs this to build a `vscode://` link that actually resolves
 * (see src/lib/vscode.ts for why plain `vscode://file/<linux-path>` breaks
 * when the browser is a Windows host pointed at a WSL-hosted panel).
 *
 * WSL sets WSL_DISTRO_NAME in every process's environment inside the
 * distro — no /proc parsing or uname sniffing needed.
 */
const systemRouter = Router();

systemRouter.get("/", (_req, res) => {
  res.json({ wslDistro: process.env.WSL_DISTRO_NAME ?? null });
});

export default systemRouter;
