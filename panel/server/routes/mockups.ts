import { Router, type Request, type Response, type NextFunction } from "express";
import multer, { type StorageEngine } from "multer";
import { mkdir, writeFile } from "fs/promises";
import { resolve } from "path";
import { getConfig } from "../config.js";
import { discoverProjects } from "../lib/discovery.js";
import { rebuildIndex } from "../lib/file-index.js";
import { localISODate } from "../lib/dateLocal.js";
import { validateProjectName } from "../lib/projectName.js";
import {
  MOCKUP_MAX_BYTES,
  countExternalResources,
  isPathUnder,
  mockupFileName,
  sniffMockup,
} from "../lib/mockup-import.js";

const router = Router();

const MAX_FILES = 50;
const MAX_SUFFIX = 1000;

type BufferedFile = Express.Multer.File & { tooLarge?: boolean };

/**
 * Memory storage that keeps going past the size cap: an oversized file is
 * drained and flagged instead of failing the whole request, so one 30 MB
 * export does not block the rest of the batch.
 */
const cappedMemoryStorage: StorageEngine = {
  _handleFile(_req, file, cb) {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    file.stream.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MOCKUP_MAX_BYTES) {
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    file.stream.on("error", cb);
    file.stream.on("end", () => {
      const buffer = tooLarge ? Buffer.alloc(0) : Buffer.concat(chunks);
      cb(null, { buffer, size, tooLarge } as Partial<BufferedFile>);
    });
  },
  _removeFile(_req, _file, cb) {
    cb(null);
  },
};

const upload = multer({
  storage: cappedMemoryStorage,
  defParamCharset: "utf8",
  limits: { files: MAX_FILES },
});

/** 400 for a malformed name, 404 for one that is not a known project — before any upload is read. */
function requireProject(req: Request, res: Response, next: NextFunction) {
  const project = req.params.project;
  const invalid = validateProjectName(project);
  if (invalid) return res.status(400).json({ error: invalid });
  if (!discoverProjects().some((p) => p.name === project)) {
    return res.status(404).json({ error: "Project not found" });
  }
  next();
}

function receiveFiles(req: Request, res: Response, next: NextFunction) {
  upload.array("files", MAX_FILES)(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      return res.status(400).json({ error: message });
    }
    next();
  });
}

function uploadedFiles(req: Request): BufferedFile[] {
  return Array.isArray(req.files) ? (req.files as BufferedFile[]) : [];
}

/** `slugs` arrives as a string (one file) or an array (several), parallel to `files`. */
function slugList(body: unknown): string[] {
  const b = (body ?? {}) as Record<string, unknown>;
  const raw = b.slugs ?? b["slugs[]"];
  if (Array.isArray(raw)) return raw.map((s) => (typeof s === "string" ? s : ""));
  return typeof raw === "string" ? [raw] : [];
}

interface ImportResult {
  name: string;
  relativePath: string;
  ok: boolean;
  error?: string;
}

/** Write with `wx`, moving to the next `-n` suffix on EEXIST — never an overwrite. */
async function writeUnique(
  dir: string,
  date: string,
  slug: string | undefined,
  file: BufferedFile,
  ext: string,
): Promise<string> {
  for (let n = 1; n <= MAX_SUFFIX; n++) {
    const name = mockupFileName(date, slug, file.originalname, ext, n);
    const target = resolve(dir, name);
    if (!isPathUnder(target, dir) || target === dir) throw new Error("Invalid file name");
    try {
      await writeFile(target, file.buffer, { flag: "wx" });
      return name;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  throw new Error("Too many files with this name");
}

router.post("/:project/mockups/import", requireProject, receiveFiles, async (req, res) => {
  const project = req.params.project as string;
  const { projectsDir } = getConfig();
  const projectDir = resolve(projectsDir, project);
  const dir = resolve(projectDir, "mockups");
  if (!isPathUnder(projectDir, projectsDir) || !isPathUnder(dir, projectDir)) {
    return res.status(400).json({ error: "Invalid project" });
  }

  const files = uploadedFiles(req);
  const slugs = slugList(req.body);
  const date = localISODate();
  const results: ImportResult[] = [];
  let wrote = false;

  for (const [i, file] of files.entries()) {
    const fail = (error: string) =>
      results.push({ name: file.originalname, relativePath: "", ok: false, error });
    if (file.tooLarge) {
      fail("File is larger than 20 MB");
      continue;
    }
    const sniff = sniffMockup(file.originalname, file.buffer);
    if (!sniff.ok) {
      fail(sniff.error);
      continue;
    }
    try {
      await mkdir(dir, { recursive: true });
      const name = await writeUnique(dir, date, slugs[i], file, sniff.ext);
      wrote = true;
      results.push({ name, relativePath: `${project}/mockups/${name}`, ok: true });
    } catch (err) {
      fail(err instanceof Error ? err.message : "Write failed");
    }
  }

  if (wrote) rebuildIndex();
  res.json({ files: results });
});

router.post("/:project/mockups/inspect", requireProject, receiveFiles, (req, res) => {
  const files = uploadedFiles(req).map((file) => ({
    name: file.originalname,
    externalCount: file.tooLarge ? 0 : countExternalResources(file.originalname, file.buffer),
  }));
  res.json({ files });
});

export default router;
