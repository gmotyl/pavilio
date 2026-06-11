import { Router } from "express";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  lstatSync,
  mkdirSync,
  renameSync,
  copyFileSync,
  unlinkSync,
} from "fs";
import { join, resolve, basename, relative, dirname, isAbsolute, sep } from "path";
import { discoverProjects, type RepoEntry } from "../lib/discovery.js";
import { expandHome } from "../lib/paths.js";
import { resolveCollision } from "./files.js";
import { rebuildIndex } from "../lib/file-index.js";
import { getConfig } from "../config.js";

const router = Router();

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

interface ContextSource {
  id: string;
  label: string;
  absoluteRoot: string;
}
interface ContextFile {
  source: string;
  filename: string;
  absolutePath: string;
  modified: number;
  /** Forward-slash path relative to projectsDir when source is "project"; null otherwise. */
  relativeToProjectsDir: string | null;
}
interface AdrFile {
  source: string;
  filename: string;
  absolutePath: string;
  modified: number;
  adrNumber: number | null;
  slug: string;
  /** Forward-slash path relative to projectsDir when source is "project"; null otherwise. */
  relativeToProjectsDir: string | null;
}

interface PlanFile {
  source: string;
  filename: string;
  absolutePath: string;
  modified: number;
  /** Forward-slash path relative to projectsDir when the file lives under it; null otherwise. */
  relativeToProjectsDir: string | null;
}
interface PlanSource {
  id: string;
  label: string;
  absoluteRoot: string;
  files: PlanFile[];
}

const ADR_FILE_RE = /^(\d{1,4})-([\w-]+)\.md$/i;

function readReposJson(projectDir: string): RepoEntry[] {
  const path = join(projectDir, "repos.json");
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function relativeToProjects(abs: string, projectsDir: string): string | null {
  return isPathUnder(abs, projectsDir) ? toPosix(relative(projectsDir, abs)) : null;
}

function listContextFilesInRoot(absoluteRoot: string, sourceId: string, projectsDir: string): ContextFile[] {
  const out: ContextFile[] = [];
  for (const name of ["CONTEXT.md", "CONTEXT-MAP.md"]) {
    const abs = join(absoluteRoot, name);
    if (existsSync(abs) && statSync(abs).isFile()) {
      out.push({
        source: sourceId,
        filename: name,
        absolutePath: abs,
        modified: statSync(abs).mtimeMs,
        relativeToProjectsDir: relativeToProjects(abs, projectsDir),
      });
    }
  }
  return out;
}

function listAdrFilesInRoot(absoluteRoot: string, sourceId: string, projectsDir: string): AdrFile[] {
  // Prefer docs/adr/ over adr/ when both exist
  const candidates = [join(absoluteRoot, "docs", "adr"), join(absoluteRoot, "adr")];
  const adrDir = candidates.find((p) => existsSync(p) && statSync(p).isDirectory());
  if (!adrDir) return [];
  const entries = readdirSync(adrDir, { withFileTypes: true });
  const out: AdrFile[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    const abs = join(adrDir, e.name);
    const match = ADR_FILE_RE.exec(e.name);
    out.push({
      source: sourceId,
      filename: e.name,
      absolutePath: abs,
      modified: statSync(abs).mtimeMs,
      adrNumber: match ? parseInt(match[1], 10) : null,
      slug: match ? match[2] : e.name.replace(/\.md$/i, ""),
      relativeToProjectsDir: relativeToProjects(abs, projectsDir),
    });
  }
  out.sort((a, b) => (a.adrNumber ?? 9999) - (b.adrNumber ?? 9999) || a.filename.localeCompare(b.filename));
  return out;
}

/** List `*.md` files in a single directory, newest first. */
function listPlanFilesInDir(absoluteRoot: string, sourceId: string, projectsDir: string): PlanFile[] {
  if (!existsSync(absoluteRoot) || !statSync(absoluteRoot).isDirectory()) return [];
  const out: PlanFile[] = [];
  for (const e of readdirSync(absoluteRoot, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    const abs = join(absoluteRoot, e.name);
    out.push({
      source: sourceId,
      filename: e.name,
      absolutePath: abs,
      modified: statSync(abs).mtimeMs,
      relativeToProjectsDir: relativeToProjects(abs, projectsDir),
    });
  }
  out.sort((a, b) => b.modified - a.modified);
  return out;
}

/** The ordered plan sources for a project: project plans + .kilo/plans roots + ~/.claude/plans. */
function plansSources(
  projectDir: string,
  projectsDir: string,
  name: string,
): { id: string; label: string; absoluteRoot: string }[] {
  const repoRoot = resolve(projectsDir, "..");
  const repos = readReposJson(projectDir);
  return [
    { id: "project", label: name, absoluteRoot: join(projectDir, "plans") },
    { id: "workspace", label: "workspace (.kilo)", absoluteRoot: join(repoRoot, ".kilo", "plans") },
    ...repos.map((r) => ({
      id: `repo:${r.name}`,
      label: r.name,
      absoluteRoot: join(resolve(expandHome(r.path)), ".kilo", "plans"),
    })),
    { id: "claude", label: "Claude plans (~/.claude/plans)", absoluteRoot: expandHome("~/.claude/plans") },
  ];
}

/** Directories a project may surface plan files from. */
export function buildPlansAllowlist(projectDir: string, projectsDir: string): string[] {
  const repoRoot = resolve(projectsDir, "..");
  const repos = readReposJson(projectDir);
  return [
    join(projectDir, "plans"),
    join(repoRoot, ".kilo", "plans"),
    ...repos.map((r) => join(resolve(expandHome(r.path)), ".kilo", "plans")),
    expandHome("~/.claude/plans"),
  ];
}

/** A path is allowed if it is a `.md` file living strictly under one allowlisted plans dir. */
export function isPlanPathAllowed(absolutePath: string, allowedDirs: string[]): boolean {
  if (absolutePath.includes("\0")) return false;
  if (!/\.md$/i.test(basename(absolutePath))) return false;
  return allowedDirs.some((dir) => isPathUnder(absolutePath, dir) && absolutePath !== dir);
}

/**
 * Compute the allowlist of absolute roots a project may surface context/ADR files from.
 * Used by /context/read to validate paths.
 */
export function buildContextAllowlist(projectDir: string): string[] {
  const repos = readReposJson(projectDir);
  return [projectDir, ...repos.map((r) => resolve(expandHome(r.path)))];
}

/**
 * A path is allowed if (a) it lives under one of the allowlisted roots and
 * (b) it's a well-known context/ADR file shape.
 */
export function isContextPathAllowed(absolutePath: string, allowlist: string[]): boolean {
  if (absolutePath.includes("\0")) return false;
  const containingRoot = allowlist.find((root) => isPathUnder(absolutePath, root));
  if (!containingRoot) return false;
  const name = basename(absolutePath);
  if (name === "CONTEXT.md" || name === "CONTEXT-MAP.md") return true;
  if (!/\.md$/i.test(name)) return false;
  // ADR files must live under <root>/adr/ or <root>/docs/adr/
  const adrRoots = [join(containingRoot, "adr"), join(containingRoot, "docs", "adr")];
  return adrRoots.some((r) => isPathUnder(absolutePath, r) && absolutePath !== r);
}

router.get("/:name/context", (req, res) => {
  const { projectsDir } = getConfig();
  const projectDir = resolve(projectsDir, req.params.name);
  if (!isPathUnder(projectDir, projectsDir) || projectDir === projectsDir || !existsSync(projectDir)) {
    return res.status(404).json({ error: "Project not found" });
  }

  const repos = readReposJson(projectDir);
  const sources: ContextSource[] = [
    { id: "project", label: req.params.name, absoluteRoot: projectDir },
    ...repos.map((r) => ({ id: `repo:${r.name}`, label: r.name, absoluteRoot: resolve(expandHome(r.path)) })),
  ];

  const contexts: ContextFile[] = [];
  const adrs: AdrFile[] = [];
  for (const s of sources) {
    if (!existsSync(s.absoluteRoot)) continue;
    contexts.push(...listContextFilesInRoot(s.absoluteRoot, s.id, projectsDir));
    adrs.push(...listAdrFilesInRoot(s.absoluteRoot, s.id, projectsDir));
  }

  res.json({ project: req.params.name, sources, contexts, adrs });
});

router.get("/:name/context/read", (req, res) => {
  const { projectsDir } = getConfig();
  const projectDir = resolve(projectsDir, req.params.name);
  if (!isPathUnder(projectDir, projectsDir) || projectDir === projectsDir || !existsSync(projectDir)) {
    return res.status(404).json({ error: "Project not found" });
  }
  const pathParam = typeof req.query.path === "string" ? req.query.path : "";
  if (!pathParam) return res.status(400).json({ error: "Missing 'path' query parameter" });

  const absPath = resolve(pathParam);
  const allowlist = buildContextAllowlist(projectDir);
  if (!isContextPathAllowed(absPath, allowlist)) {
    return res.status(403).json({ error: "Path not in this project's context allowlist" });
  }
  if (!existsSync(absPath) || !statSync(absPath).isFile()) {
    return res.status(404).json({ error: "File not found" });
  }
  const content = readFileSync(absPath, "utf-8");
  res.json({ absolutePath: absPath, content });
});

router.get("/:name/plans-tree", (req, res) => {
  const { projectsDir } = getConfig();
  const projectDir = resolve(projectsDir, req.params.name);
  if (!isPathUnder(projectDir, projectsDir) || projectDir === projectsDir || !existsSync(projectDir)) {
    return res.status(404).json({ error: "Project not found" });
  }

  const sources: PlanSource[] = [];
  for (const c of plansSources(projectDir, projectsDir, req.params.name)) {
    const files = listPlanFilesInDir(c.absoluteRoot, c.id, projectsDir);
    if (files.length === 0 && c.id !== "project") continue; // project node always shown
    sources.push({ id: c.id, label: c.label, absoluteRoot: c.absoluteRoot, files });
  }

  res.json({ project: req.params.name, sources });
});

router.get("/:name/plans/read", (req, res) => {
  const { projectsDir } = getConfig();
  const projectDir = resolve(projectsDir, req.params.name);
  if (!isPathUnder(projectDir, projectsDir) || projectDir === projectsDir || !existsSync(projectDir)) {
    return res.status(404).json({ error: "Project not found" });
  }
  const pathParam = typeof req.query.path === "string" ? req.query.path : "";
  if (!pathParam) return res.status(400).json({ error: "Missing 'path' query parameter" });

  const absPath = resolve(pathParam);
  const allowlist = buildPlansAllowlist(projectDir, projectsDir);
  if (!isPlanPathAllowed(absPath, allowlist)) {
    return res.status(403).json({ error: "Path not in this project's plans allowlist" });
  }
  if (!existsSync(absPath)) {
    return res.status(404).json({ error: "File not found" });
  }
  // lstat (no symlink follow): a symlink inside an allowed dir could point outside it (TOCTOU).
  const stats = lstatSync(absPath);
  if (stats.isSymbolicLink()) {
    return res.status(403).json({ error: "Symbolic links are not allowed" });
  }
  if (!stats.isFile()) {
    return res.status(404).json({ error: "File not found" });
  }
  const content = readFileSync(absPath, "utf-8");
  res.json({ absolutePath: absPath, content });
});

// Move a plan file between plan sources (project plans <-> .kilo/plans <-> ~/.claude/plans).
// Body: { from: string (absolute path), toId: string (a plans source id) }
router.post("/:name/plans/move", (req, res) => {
  const { projectsDir } = getConfig();
  const projectDir = resolve(projectsDir, req.params.name);
  if (!isPathUnder(projectDir, projectsDir) || projectDir === projectsDir || !existsSync(projectDir)) {
    return res.status(404).json({ error: "Project not found" });
  }
  const fromParam = typeof req.body?.from === "string" ? req.body.from : "";
  const toId = typeof req.body?.toId === "string" ? req.body.toId : "";
  if (!fromParam || !toId) return res.status(400).json({ error: "Both 'from' and 'toId' are required" });

  const absFrom = resolve(fromParam);
  const allowlist = buildPlansAllowlist(projectDir, projectsDir);
  if (!isPlanPathAllowed(absFrom, allowlist)) {
    return res.status(403).json({ error: "Source not in this project's plans allowlist" });
  }
  if (!existsSync(absFrom)) return res.status(404).json({ error: "Source file not found" });
  const fromStat = lstatSync(absFrom);
  if (fromStat.isSymbolicLink()) return res.status(403).json({ error: "Symbolic links are not allowed" });
  if (!fromStat.isFile()) return res.status(400).json({ error: "Source is not a regular file" });

  const dest = plansSources(projectDir, projectsDir, req.params.name).find((s) => s.id === toId);
  if (!dest) return res.status(400).json({ error: "Unknown destination source" });
  const destDir = dest.absoluteRoot;

  if (dirname(absFrom) === destDir) {
    return res.json({ from: absFrom, to: absFrom, renamed: false, noop: true });
  }

  mkdirSync(destDir, { recursive: true });
  const resolved = resolveCollision(destDir, basename(absFrom));
  if (!resolved) return res.status(409).json({ error: "Too many collisions at destination" });

  try {
    renameSync(absFrom, resolved.absolutePath);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "EXDEV") {
      copyFileSync(absFrom, resolved.absolutePath); // cross-device (e.g. ~/.claude on another fs)
      unlinkSync(absFrom);
    } else {
      return res.status(500).json({ error: `Move failed: ${(e as Error).message}` });
    }
  }

  // Keep the file index fresh when a file enters/leaves projectsDir.
  if (isPathUnder(destDir, projectsDir) || isPathUnder(absFrom, projectsDir)) rebuildIndex();
  res.json({ from: absFrom, to: resolved.absolutePath, renamed: resolved.renamed });
});

router.get("/", (_req, res) => {
  const projects = discoverProjects();
  res.json(projects);
});

router.post("/:name/plans/current/:planFile", (req, res) => {
  const { projectsDir } = getConfig();
  const projectDir = resolve(projectsDir, req.params.name);
  if (!isPathUnder(projectDir, projectsDir) || projectDir === projectsDir || !existsSync(projectDir)) {
    return res.status(404).json({ error: "Project not found" });
  }
  // Only a project-local plan file (by basename) may be marked active.
  const filename = basename(decodeURIComponent(req.params.planFile));
  if (!/\.md$/i.test(filename)) return res.status(400).json({ error: "Not a .md plan file" });
  const planAbs = join(projectDir, "plans", filename);
  if (!existsSync(planAbs) || !statSync(planAbs).isFile()) {
    return res.status(404).json({ error: "Plan file not found" });
  }

  const currentMdPath = join(projectDir, "plans", "CURRENT.md");
  const existing = existsSync(currentMdPath)
    ? readFileSync(currentMdPath, "utf-8").split("\n").map((l) => l.trim()).filter(Boolean)
    : [];
  if (existing.some((l) => l.endsWith(filename))) {
    return res.json({ ok: true }); // already active — idempotent
  }
  const line = `projects/${req.params.name}/plans/${filename}`;
  const header = existing.length === 0 ? "# CURRENT plan\n\n" : "";
  writeFileSync(currentMdPath, header + [...existing, line].join("\n") + "\n");
  res.json({ ok: true });
});

router.delete("/:name/plans/current/:planFile", (req, res) => {
  const { projectsDir } = getConfig();
  const currentMdPath = join(projectsDir, req.params.name, "plans", "CURRENT.md");
  if (!existsSync(currentMdPath)) return res.status(404).json({ error: "CURRENT.md not found" });

  const planFile = decodeURIComponent(req.params.planFile);
  const lines = readFileSync(currentMdPath, "utf-8").split("\n");
  const filtered = lines.filter((l) => {
    const trimmed = l.trim();
    return trimmed !== "" && !trimmed.endsWith(planFile);
  });
  writeFileSync(currentMdPath, filtered.join("\n") + "\n");
  res.json({ ok: true });
});

export default router;
