import { Router, type Request, type Response, type NextFunction } from "express";
import multer, { type StorageEngine } from "multer";
import { mkdir, realpath, writeFile } from "fs/promises";
import { resolve } from "path";
import { getConfig } from "../config.js";
import { discoverProjects } from "../lib/discovery.js";
import { rebuildIndex } from "../lib/file-index.js";
import { localISODate } from "../lib/dateLocal.js";
import { validateProjectName } from "../lib/projectName.js";
import {
  MOCKUP_MAX_BYTES,
  MOCKUP_MAX_TOTAL_BYTES,
  countExternalResources,
  isPathUnder,
  mockupFileName,
  sniffMockup,
} from "../lib/mockup-import.js";

const router = Router();

const MAX_FILES = 50;
const MAX_SUFFIX = 1000;
/** A slug is cut to 60 chars server-side; 1 KB leaves room for any typed input. */
const MAX_FIELD_BYTES = 1024;

type BufferedFile = Express.Multer.File & { tooLarge?: boolean; overTotal?: boolean };

/** Bytes buffered so far for one request, across all of its files. */
const bufferedBytes = new WeakMap<Request, number>();
/** Requests that hit the total cap: every later file fails too, even a small one. */
const overTotalRequests = new WeakSet<Request>();

/**
 * Memory storage that keeps going past the size caps: an oversized file is
 * drained and flagged instead of failing the whole request, so one 30 MB
 * export does not block the rest of the batch. Once the request has buffered
 * `MOCKUP_MAX_TOTAL_BYTES`, every further file is drained and flagged too.
 */
const cappedMemoryStorage: StorageEngine = {
  _handleFile(req, file, cb) {
    const chunks: Buffer[] = [];
    let size = 0;
    let kept = 0;
    let tooLarge = false;
    let overTotal = false;
    // Reserve bytes as they arrive (not at `end`) so a file that starts
    // before the previous one finished still sees the running total.
    const total = () => bufferedBytes.get(req) ?? 0;
    const release = () => {
      bufferedBytes.set(req, total() - kept);
      kept = 0;
      chunks.length = 0;
    };
    file.stream.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (tooLarge || overTotal) return;
      if (overTotalRequests.has(req)) {
        overTotal = true;
        release();
      } else if (size > MOCKUP_MAX_BYTES) {
        tooLarge = true;
        release();
      } else if (total() + chunk.length > MOCKUP_MAX_TOTAL_BYTES) {
        overTotal = true;
        overTotalRequests.add(req);
        release();
      } else {
        chunks.push(chunk);
        kept += chunk.length;
        bufferedBytes.set(req, total() + chunk.length);
      }
    });
    file.stream.on("error", cb);
    file.stream.on("end", () => {
      const buffer = tooLarge || overTotal ? Buffer.alloc(0) : Buffer.concat(chunks);
      cb(null, { buffer, size, tooLarge, overTotal } as Partial<BufferedFile>);
    });
  },
  _removeFile(_req, _file, cb) {
    cb(null);
  },
};

const upload = multer({
  storage: cappedMemoryStorage,
  defParamCharset: "utf8",
  // Text fields are bounded too: the only one is `slugs`, one per file, so
  // repeated or huge fields cannot grow `req.body` past a few dozen KB.
  limits: {
    files: MAX_FILES,
    fields: MAX_FILES,
    fieldSize: MAX_FIELD_BYTES,
    fieldNameSize: 100,
    // A file and its slug per entry; busboy counts the closing boundary as
    // a part too, so the full 50 + 50 needs one more.
    parts: MAX_FILES * 2 + 1,
  },
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

/** A failure whose message is safe to show the client (no server paths). */
class ImportError extends Error {}

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
    if (!isPathUnder(target, dir) || target === dir) throw new ImportError("Invalid file name");
    try {
      await writeFile(target, file.buffer, { flag: "wx" });
      return name;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  throw new ImportError("Too many files with this name");
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

  // Created lazily (only once a file passes), then resolved through symlinks:
  // a `mockups` link pointing out of the project must not receive writes.
  let realDir: Promise<string> | undefined;
  const mockupsDir = () =>
    (realDir ??= (async () => {
      await mkdir(dir, { recursive: true });
      const [realProject, real] = await Promise.all([realpath(projectDir), realpath(dir)]);
      if (!isPathUnder(real, realProject) || real === realProject) {
        throw new ImportError("The mockups folder is outside the project");
      }
      return real;
    })());

  for (const [i, file] of files.entries()) {
    const fail = (error: string) =>
      results.push({ name: file.originalname, relativePath: "", ok: false, error });
    if (file.tooLarge) {
      fail("File is larger than 20 MB");
      continue;
    }
    if (file.overTotal) {
      fail("The import is larger than 100 MB in total — import the rest separately");
      continue;
    }
    const sniff = sniffMockup(file.originalname, file.buffer);
    if (!sniff.ok) {
      fail(sniff.error);
      continue;
    }
    try {
      const target = await mockupsDir();
      const name = await writeUnique(target, date, slugs[i], file, sniff.ext);
      wrote = true;
      results.push({ name, relativePath: `${project}/mockups/${name}`, ok: true });
    } catch (err) {
      // fs errors carry absolute paths — log them, send a generic reason
      if (err instanceof ImportError) fail(err.message);
      else {
        console.error("[mockups] import write failed:", err);
        fail("Could not write the file");
      }
    }
  }

  if (wrote) rebuildIndex();
  res.json({ files: results });
});

/**
 * The date every import is prefixed with today — the server's local day, which
 * the dialog shows instead of the browser's (they differ across time zones).
 */
router.get("/:project/mockups/today", requireProject, (_req, res) => {
  res.json({ date: localISODate() });
});

router.post("/:project/mockups/inspect", requireProject, receiveFiles, (req, res) => {
  const files = uploadedFiles(req).map((file) => ({
    name: file.originalname,
    externalCount: file.tooLarge ? 0 : countExternalResources(file.originalname, file.buffer),
  }));
  res.json({ files });
});

export default router;
