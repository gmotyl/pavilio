import { Router } from "express";
import { resolve, sep } from "path";
import { getConfig } from "../config.js";

/**
 * Tiny system-info endpoint. Currently just tells the client whether the
 * server process is running inside WSL and, if so, which distro — the
 * client needs this to build a `vscode://` link that actually resolves
 * (see src/lib/vscode.ts for why plain `vscode://file/<linux-path>` breaks
 * when the browser is a Windows host pointed at a WSL-hosted panel).
 *
 * WSL sets WSL_DISTRO_NAME in every process's environment inside the
 * distro — no /proc parsing or uname sniffing needed.
 *
 * It also carries `workspaceRoot`, the parent of the configured projects
 * directory, with forward slashes: every viewer's copy-path is relative to it
 * (see src/features/projects/relativeToWorkspace.ts), so the client never has to
 * guess the projects directory's name.
 */
const systemRouter = Router();

systemRouter.get("/", (_req, res) => {
  const workspaceRoot = resolve(getConfig().projectsDir, "..");
  res.json({
    wslDistro: process.env.WSL_DISTRO_NAME ?? null,
    workspaceRoot: sep === "/" ? workspaceRoot : workspaceRoot.split(sep).join("/"),
  });
});

export default systemRouter;
