import { Router } from "express";
import multer from "multer";
import { readFileSync } from "fs";
import { promises as fs } from "fs";
import { join, resolve } from "path";
import { homedir, tmpdir } from "os";
import {
  createSession,
  listSessions,
  destroySession,
  updateSession,
} from "../lib/terminal-manager.js";
import { appendReconnectMetric } from "../lib/reconnect-log.js";
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

router.post("/reconnect-log", (req, res) => {
  const b = req.body ?? {};
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
  try {
    appendReconnectMetric({
      sessionId: typeof b.sessionId === "string" ? b.sessionId : undefined,
      blankAtClick: bool(b.blankAtClick),
      wsReadyState: num(b.wsReadyState),
      pingMs: num(b.pingMs),
      frameMs: num(b.frameMs),
      cols: num(b.cols),
      rows: num(b.rows),
      stale: bool(b.stale),
      // Forwarded as sent. Keeping the trigger column an enum is the log's
      // job, in one place: appendReconnectMetric coerces a present value and
      // leaves an absent one absent. Normalising here too would default an
      // unattributed POST to "manual" — recording a click that never happened.
      trigger: b.trigger,
    });
    res.json({ ok: true });
  } catch (err) {
    console.warn("[terminal] reconnect-log append failed:", err);
    res.status(500).json({ ok: false });
  }
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

const PASTE_DIR = join(tmpdir(), "pavilio-pastes");
const PASTE_TTL_MS = 24 * 60 * 60 * 1000;

// Nothing else ever deletes these files, so each upload sweeps expired ones.
async function sweepOldPastes() {
  let names: string[];
  try {
    names = await fs.readdir(PASTE_DIR);
  } catch {
    return;
  }
  for (const name of names) {
    const p = join(PASTE_DIR, name);
    try {
      const stat = await fs.stat(p);
      if (Date.now() - stat.mtimeMs > PASTE_TTL_MS) await fs.unlink(p);
    } catch {
      // raced with another sweep — ignore
    }
  }
}

router.post("/paste-image", (req, res) => {
  pasteUpload.single("image")(req, res, async (err: unknown) => {
    if (err) {
      const tooBig = (err as { code?: string })?.code === "LIMIT_FILE_SIZE";
      return res
        .status(tooBig ? 413 : 400)
        .json({ error: tooBig ? "Image too large (max 20MB)" : "Upload failed" });
    }
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Missing image" });
    const ext = EXT_BY_MIME[file.mimetype];
    if (!ext) return res.status(400).json({ error: "Not an image" });

    try {
      // Screenshots often contain secrets — keep them out of reach of other
      // local users on shared-/tmp machines.
      await fs.mkdir(PASTE_DIR, { recursive: true, mode: 0o700 });
      // Fire-and-forget: don't delay this upload's response on the sweep.
      sweepOldPastes().catch(() => {});
      const path = join(
        PASTE_DIR,
        `paste-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`,
      );
      await fs.writeFile(path, file.buffer, { mode: 0o600 });
      res.json({ path });
    } catch {
      res.status(500).json({ error: "Upload failed" });
    }
  });
});

export default router;
