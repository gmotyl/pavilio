import { Router } from "express";
import { readFileSync, existsSync, readdirSync, statSync, promises as fsPromises } from "fs";
import { resolve, dirname, basename, extname, join, relative, isAbsolute, sep } from "path";
import { getConfig } from "../config.js";
import { getFileIndex, rebuildIndex } from "../lib/file-index.js";
import { resolveRoot, isValidRoot } from "../lib/file-roots.js";

/** Cross-platform: forward slashes only in API responses. */
function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

/** True when `abs` is the root itself or lies under it (no `..` traversal). */
function isPathUnder(abs: string, root: string): boolean {
  if (abs === root) return true;
  const rel = relative(root, abs);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

const router = Router();

/**
 * Resolve a candidate destination filename inside `destDir`. If `${name}` already
 * exists, walk `${baseName}-1.${ext}`, `${baseName}-2.${ext}`, … up to 50 attempts.
 * Returns `{ absolutePath, name, renamed }` or null if exhausted.
 */
export function resolveCollision(destDir: string, originalName: string):
  | { absolutePath: string; name: string; renamed: boolean }
  | null {
  const initialPath = join(destDir, originalName);
  if (!existsSync(initialPath)) {
    return { absolutePath: initialPath, name: originalName, renamed: false };
  }
  const ext = extname(originalName);
  const stem = originalName.slice(0, originalName.length - ext.length);
  for (let i = 1; i <= 50; i++) {
    const candidate = `${stem}-${i}${ext}`;
    const abs = join(destDir, candidate);
    if (!existsSync(abs)) return { absolutePath: abs, name: candidate, renamed: true };
  }
  return null;
}

// File path index for Cmd+P finder
router.get("/index", (_req, res) => {
  res.json(
    getFileIndex().map(({ relativePath, project, modified }) => ({
      relativePath,
      project,
      modified,
    }))
  );
});

// Read a file's raw content — Express v5 / path-to-regexp v8: *name wildcard
router.get("/read/*path", (req, res) => {
  const parts = req.params.path;
  const relativePath = Array.isArray(parts) ? parts.join("/") : parts;
  const { projectsDir } = getConfig();

  // ?root=<id> — explicit cross-root read (checked first, before legacy prefixes)
  const rootParam = typeof req.query.root === "string" ? req.query.root : "";
  if (rootParam && isValidRoot(rootParam)) {
    const base = resolveRoot(rootParam);
    const candidate = resolve(base, relativePath);
    if (!isPathUnder(candidate, base)) {
      return res.status(403).json({ error: "Path traversal blocked" });
    }
    if (!existsSync(candidate)) {
      return res.status(404).json({ error: "File not found" });
    }
    const content = readFileSync(candidate, "utf-8");
    return res.json({ path: relativePath, absolutePath: candidate, content });
  }

  // Support _skills/ prefix for skill SKILL.md files
  let absolutePath: string;
  if (relativePath.startsWith("_skills/")) {
    const tail = relativePath.slice("_skills/".length);
    const skillsDir = resolve(projectsDir, "../skills");
    // Accept either "<name>" (resolve to <name>/SKILL.md) or an explicit path inside the skill folder.
    const candidate = tail.includes("/")
      ? resolve(skillsDir, tail)
      : resolve(skillsDir, tail, "SKILL.md");
    if (!candidate.startsWith(skillsDir)) {
      return res.status(403).json({ error: "Path traversal blocked" });
    }
    absolutePath = candidate;
  } else if (relativePath.startsWith("_help/")) {
    const helpFile = relativePath.slice("_help/".length);
    absolutePath = resolve(projectsDir, "../panel/help", helpFile);
    const helpDir = resolve(projectsDir, "../panel/help");
    if (!absolutePath.startsWith(helpDir)) {
      return res.status(403).json({ error: "Path traversal blocked" });
    }
  } else {
    absolutePath = resolve(projectsDir, relativePath);
    if (!absolutePath.startsWith(projectsDir)) {
      return res.status(403).json({ error: "Path traversal blocked" });
    }
    // Fallback: if not found in projectsDir, try repo root
    if (!existsSync(absolutePath)) {
      const repoRoot = resolve(projectsDir, "..");
      const fallback = resolve(repoRoot, relativePath);
      if (fallback.startsWith(repoRoot) && existsSync(fallback)) {
        absolutePath = fallback;
      }
    }
  }

  if (!existsSync(absolutePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  const content = readFileSync(absolutePath, "utf-8");
  res.json({ path: relativePath, absolutePath, content });
});

// Serve raw files (images, etc.) with correct MIME type
router.get("/raw/*path", (req, res) => {
  const parts = req.params.path;
  const relativePath = Array.isArray(parts) ? parts.join("/") : parts;
  const { projectsDir } = getConfig();

  let absolutePath = resolve(projectsDir, relativePath);
  if (!absolutePath.startsWith(projectsDir)) {
    return res.status(403).json({ error: "Path traversal blocked" });
  }

  // Fallback: if not found in projectsDir, try repo root
  if (!existsSync(absolutePath)) {
    const repoRoot = resolve(projectsDir, "..");
    const fallback = resolve(repoRoot, relativePath);
    if (fallback.startsWith(repoRoot) && existsSync(fallback)) {
      absolutePath = fallback;
    }
  }

  if (!existsSync(absolutePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  res.sendFile(absolutePath);
});

// Move a file within the notes world (under projectsDir).
// Body: { from: string (file relativePath), to: string (destination dir relativePath) }
// Response: { from, to, renamed } where `to` is the final relativePath after collision-resolve.
router.post("/move", async (req, res) => {
  const { projectsDir } = getConfig();
  const from = typeof req.body?.from === "string" ? req.body.from : "";
  const to = typeof req.body?.to === "string" ? req.body.to : "";
  if (!from || !to) {
    return res.status(400).json({ error: "Both 'from' and 'to' are required" });
  }

  const absFrom = resolve(projectsDir, from);
  const absToDir = resolve(projectsDir, to);

  if (!isPathUnder(absFrom, projectsDir)) {
    return res.status(403).json({ error: "Path traversal blocked (from)" });
  }
  if (!isPathUnder(absToDir, projectsDir)) {
    return res.status(403).json({ error: "Path traversal blocked (to)" });
  }

  let srcStat;
  try {
    srcStat = await fsPromises.stat(absFrom);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return res.status(404).json({ error: "Source file not found" });
    }
    throw e;
  }
  if (!srcStat.isFile()) {
    return res.status(400).json({ error: "Source is not a regular file" });
  }

  let destStat;
  try {
    destStat = await fsPromises.stat(absToDir);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return res.status(404).json({ error: "Destination directory not found" });
    }
    throw e;
  }
  if (!destStat.isDirectory()) {
    return res.status(400).json({ error: "Destination is not a directory" });
  }

  // No-op when source already lives in the destination directory
  if (dirname(absFrom) === absToDir) {
    return res.json({
      from,
      to: toPosix(relative(projectsDir, absFrom)),
      renamed: false,
      noop: true,
    });
  }

  const resolved = resolveCollision(absToDir, basename(absFrom));
  if (!resolved) {
    return res.status(409).json({ error: "Too many collisions at destination" });
  }

  try {
    await fsPromises.rename(absFrom, resolved.absolutePath);
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EXDEV") {
      // Cross-device fallback (unlikely under one projectsDir, but defensive)
      await fsPromises.copyFile(absFrom, resolved.absolutePath);
      await fsPromises.unlink(absFrom);
    } else {
      return res.status(500).json({ error: `Move failed: ${err.message}` });
    }
  }

  rebuildIndex();
  return res.json({
    from,
    to: toPosix(relative(projectsDir, resolved.absolutePath)),
    renamed: resolved.renamed,
  });
});

// Write a file's content (create or overwrite) within projectsDir.
// Body: { path: string, content: string }
// Response: { ok: true, path } where `path` is the final relativePath.
router.post("/write", async (req, res) => {
  const { projectsDir } = getConfig();
  const relPath = typeof req.body?.path === "string" ? req.body.path : "";
  const content = typeof req.body?.content === "string" ? req.body.content : null;
  if (!relPath || content === null) {
    return res.status(400).json({ error: "Both 'path' and 'content' are required" });
  }

  const absolutePath = resolve(projectsDir, relPath);
  if (!isPathUnder(absolutePath, projectsDir)) {
    return res.status(403).json({ error: "Path traversal blocked" });
  }

  await fsPromises.mkdir(dirname(absolutePath), { recursive: true });
  await fsPromises.writeFile(absolutePath, content, "utf-8");

  rebuildIndex();
  return res.json({ ok: true, path: toPosix(relative(projectsDir, absolutePath)) });
});

// Walk a root directory recursively, skipping hidden entries (dot-prefixed names)
function walkRoot(absRoot: string): Array<{ relativePath: string; modified: number }> {
  const out: Array<{ relativePath: string; modified: number }> = [];
  function recur(dir: string, prefix: string) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const abs = join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        recur(abs, rel);
      } else if (e.isFile()) {
        try {
          const st = statSync(abs);
          out.push({ relativePath: toPosix(rel), modified: st.mtimeMs });
        } catch {}
      }
    }
  }
  recur(absRoot, "");
  return out;
}

// List all files under a named root (projects | skills | claude-commands | opencode-commands)
router.get("/listing", (req, res) => {
  const root = String(req.query.root ?? "");
  if (!isValidRoot(root)) {
    return res.status(400).json({ error: "Unknown root" });
  }
  const abs = resolveRoot(root);
  res.json(walkRoot(abs));
});

// File tree for a specific project
router.get("/tree/:project", (req, res) => {
  const entries = getFileIndex().filter((e) => e.project === req.params.project);
  res.json(
    entries.map(({ relativePath, project, modified }) => ({
      relativePath,
      project,
      modified,
    }))
  );
});

export default router;
