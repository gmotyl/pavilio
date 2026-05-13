import { Router } from "express";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, resolve, basename, relative, isAbsolute, sep } from "path";
import { discoverProjects, type RepoEntry } from "../lib/discovery.js";
import { expandHome } from "../lib/paths.js";
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

router.get("/", (_req, res) => {
  const projects = discoverProjects();
  res.json(projects);
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
