import { Router } from "express";
import multer from "multer";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { homedir, tmpdir } from "os";
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

// Pasted images from the browser (e.g. Mac browser → panel on another
// machine): the terminal CLI can only read the clipboard of the machine it
// runs on, so the browser uploads the image here and pastes the saved path.
const pasteUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
};

router.post("/paste-image", pasteUpload.single("image"), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "Missing image" });
  const ext = EXT_BY_MIME[file.mimetype];
  if (!ext) return res.status(400).json({ error: "Not an image" });

  const dir = join(tmpdir(), "pavilio-pastes");
  mkdirSync(dir, { recursive: true });
  const path = join(
    dir,
    `paste-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`,
  );
  writeFileSync(path, file.buffer);
  res.json({ path });
});

export default router;
