import { Router } from "express";
import { readFileSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import {
  createSession,
  listSessions,
  destroySession,
  updateSession,
} from "../lib/terminal-manager.js";
import { getConfig } from "../config.js";

function expandPath(p: string): string {
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  if (p === "~") return homedir();
  return p;
}

const router = Router();

router.get("/sessions", (_req, res) => {
  res.json(listSessions());
});

router.post("/sessions", (req, res) => {
  const { cwd, cols = 80, rows = 24, project = "", name } = req.body ?? {};
  const effectiveCwd =
    cwd && typeof cwd === "string"
      ? expandPath(cwd)
      : resolve(getConfig().projectsDir, "..");
  const session = createSession({
    cwd: effectiveCwd,
    cols,
    rows,
    project,
    name,
  });
  res.status(201).json(session);
});

router.patch("/sessions/:id", (req, res) => {
  const { name, color } = req.body ?? {};
  const ok = updateSession(req.params.id, { name, color });
  if (!ok) return res.status(404).json({ error: "Session not found" });
  res.json({ ok: true });
});

router.delete("/sessions/:id", (req, res) => {
  const ok = destroySession(req.params.id);
  if (!ok) return res.status(404).json({ error: "Session not found" });
  res.json({ ok: true });
});

router.get("/start-dirs", (req, res) => {
  const { projectsDir } = getConfig();
  const home = process.env.HOME || "/tmp";
  const project = typeof req.query.project === "string" ? req.query.project : "";

  const dirs: { label: string; path: string }[] = [
    { label: "Projects", path: projectsDir },
    { label: "Home", path: home },
  ];

  if (project) {
    try {
      const reposPath = resolve(projectsDir, project, "repos.json");
      const repos = JSON.parse(readFileSync(reposPath, "utf-8")) as Array<{
        name: string;
        path: string;
      }>;
      for (const repo of repos) {
        dirs.push({ label: repo.name, path: expandPath(repo.path) });
      }
    } catch {
      // repos.json optional
    }
  }

  res.json(dirs);
});

export default router;
