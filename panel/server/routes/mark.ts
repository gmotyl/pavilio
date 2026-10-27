import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { createHash } from "crypto";
import { lstat, rename, unlink, writeFile } from "fs/promises";
import { resolve } from "path";
import { getConfig } from "../config.js";
import { isPathUnder, sniffMockup } from "../lib/mockup-import.js";
import { requireProject } from "./mockups.js";

/**
 * A project's mark image: one `mark.<ext>` file in its notes folder
 * (`projects/<name>/`), which `project.mark = "image:mark.<ext>"` points at.
 */
const router = Router();

export const MARK_MAX_BYTES = 256 * 1024;

const MARK_TYPES = {
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
} as const;
type MarkExt = keyof typeof MARK_TYPES;
const MARK_EXTS = Object.keys(MARK_TYPES) as MarkExt[];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fields: 0, fileSize: MARK_MAX_BYTES },
});

function receiveImage(req: Request, res: Response, next: NextFunction) {
  upload.single("image")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Image is larger than 256 KB" });
    }
    if (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      return res.status(400).json({ error: message });
    }
    next();
  });
}

/** The project's notes folder, or null when it would resolve outside the projects dir. */
function projectDir(req: Request): string | null {
  const { projectsDir } = getConfig();
  const dir = resolve(projectsDir, req.params.project as string);
  return isPathUnder(dir, projectsDir) && dir !== resolve(projectsDir) ? dir : null;
}

/** Remove every `mark.*` except `keep`; a missing file is not an error. */
async function removeMarks(dir: string, keep?: MarkExt): Promise<void> {
  await Promise.all(
    MARK_EXTS.filter((ext) => ext !== keep).map((ext) =>
      unlink(resolve(dir, `mark${ext}`)).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") throw err;
      }),
    ),
  );
}

router.put("/:project/mark", requireProject, receiveImage, async (req, res) => {
  const dir = projectDir(req);
  if (!dir) return res.status(400).json({ error: "Invalid project" });
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No image uploaded" });

  // Extension and bytes must agree, and only png|svg|webp may be a mark.
  const sniff = sniffMockup(file.originalname, file.buffer);
  if (!sniff.ok) return res.status(400).json({ error: sniff.error });
  if (!(MARK_EXTS as string[]).includes(sniff.ext)) {
    return res.status(400).json({ error: "Unsupported file type — use PNG, SVG or WebP" });
  }
  const ext = sniff.ext as MarkExt;

  try {
    // Write a temp file and rename over the target: a `mark.*` symlink is
    // replaced, never followed out of the project.
    const target = resolve(dir, `mark${ext}`);
    const tmp = resolve(dir, `.mark-${process.pid}-${Date.now()}.tmp`);
    await writeFile(tmp, file.buffer, { flag: "wx" });
    await rename(tmp, target);
    await removeMarks(dir, ext);
  } catch (err) {
    // fs errors carry absolute paths — log them, send a generic reason
    console.error("[mark] write failed:", err);
    return res.status(500).json({ error: "Could not write the mark image" });
  }

  const hash = createHash("sha256").update(file.buffer).digest("hex").slice(0, 16);
  res.json({ mark: `image:mark${ext}`, hash });
});

router.get("/:project/mark", requireProject, async (req, res) => {
  const dir = projectDir(req);
  if (!dir) return res.status(400).json({ error: "Invalid project" });
  for (const ext of MARK_EXTS) {
    const path = resolve(dir, `mark${ext}`);
    // Regular files only: a symlinked mark could point anywhere.
    const stat = await lstat(path).catch(() => null);
    if (!stat?.isFile()) continue;
    res.setHeader("Content-Type", MARK_TYPES[ext]);
    res.setHeader("X-Content-Type-Options", "nosniff");
    // SVG can carry script; sandbox it like raw mockup SVG in files.ts.
    if (ext === ".svg") res.setHeader("Content-Security-Policy", "sandbox");
    return res.sendFile(path);
  }
  res.status(404).json({ error: "No mark image" });
});

router.delete("/:project/mark", requireProject, async (req, res) => {
  const dir = projectDir(req);
  if (!dir) return res.status(400).json({ error: "Invalid project" });
  try {
    await removeMarks(dir);
  } catch (err) {
    console.error("[mark] delete failed:", err);
    return res.status(500).json({ error: "Could not delete the mark image" });
  }
  res.status(204).end();
});

export default router;
