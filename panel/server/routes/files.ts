import { Router } from "express";
import { readFileSync, existsSync, statSync, renameSync, copyFileSync, unlinkSync } from "fs";
import { resolve, dirname, basename, extname, join, relative } from "path";
import { getConfig } from "../config.js";
import { getFileIndex, rebuildIndex } from "../lib/file-index.js";

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

  // Support _commands/ prefix for files in the commands directory
  let absolutePath: string;
  if (relativePath.startsWith("_commands/")) {
    const commandFile = relativePath.slice("_commands/".length);
    absolutePath = resolve(projectsDir, "../commands", commandFile);
    const commandsDir = resolve(projectsDir, "../commands");
    if (!absolutePath.startsWith(commandsDir)) {
      return res.status(403).json({ error: "Path traversal blocked" });
    }
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
router.post("/move", (req, res) => {
  const { projectsDir } = getConfig();
  const from = typeof req.body?.from === "string" ? req.body.from : "";
  const to = typeof req.body?.to === "string" ? req.body.to : "";
  if (!from || !to) {
    return res.status(400).json({ error: "Both 'from' and 'to' are required" });
  }

  const absFrom = resolve(projectsDir, from);
  const absToDir = resolve(projectsDir, to);

  if (!absFrom.startsWith(projectsDir + "/") && absFrom !== projectsDir) {
    return res.status(403).json({ error: "Path traversal blocked (from)" });
  }
  if (!absToDir.startsWith(projectsDir + "/") && absToDir !== projectsDir) {
    return res.status(403).json({ error: "Path traversal blocked (to)" });
  }
  if (!existsSync(absFrom)) {
    return res.status(404).json({ error: "Source file not found" });
  }
  const srcStat = statSync(absFrom);
  if (!srcStat.isFile()) {
    return res.status(400).json({ error: "Source is not a regular file" });
  }
  if (!existsSync(absToDir)) {
    return res.status(404).json({ error: "Destination directory not found" });
  }
  const destStat = statSync(absToDir);
  if (!destStat.isDirectory()) {
    return res.status(400).json({ error: "Destination is not a directory" });
  }

  // No-op when source already lives in the destination directory
  if (dirname(absFrom) === absToDir) {
    return res.json({
      from,
      to: relative(projectsDir, absFrom),
      renamed: false,
      noop: true,
    });
  }

  const resolved = resolveCollision(absToDir, basename(absFrom));
  if (!resolved) {
    return res.status(409).json({ error: "Too many collisions at destination" });
  }

  try {
    renameSync(absFrom, resolved.absolutePath);
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EXDEV") {
      // Cross-device fallback (unlikely under one projectsDir, but defensive)
      copyFileSync(absFrom, resolved.absolutePath);
      unlinkSync(absFrom);
    } else {
      return res.status(500).json({ error: `Move failed: ${err.message}` });
    }
  }

  rebuildIndex();
  return res.json({
    from,
    to: relative(projectsDir, resolved.absolutePath),
    renamed: resolved.renamed,
  });
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
