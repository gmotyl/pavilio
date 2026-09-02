import { Router } from "express";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  lstatSync,
  realpathSync,
} from "fs";
import { join, resolve, basename, relative, dirname, isAbsolute, sep } from "path";
import { discoverProjects, type RepoEntry } from "../lib/discovery.js";
import { expandHome } from "../lib/paths.js";
import { getConfig } from "../config.js";
import { parseOpenSpecConfig, resolveOpenSpecRoot } from "../lib/openspec.js";
import { resolveProjectColors, setProjectColor } from "../lib/project-colors.js";

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
/** Living spec (current behavior of a feature area) under <root>/specs/. */
type SpecFile = ContextFile;

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

function listSpecFilesInRoot(absoluteRoot: string, sourceId: string, projectsDir: string): SpecFile[] {
  const specsDir = join(absoluteRoot, "specs");
  if (!existsSync(specsDir) || !statSync(specsDir).isDirectory()) return [];
  const out: SpecFile[] = [];
  for (const e of readdirSync(specsDir, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    const abs = join(specsDir, e.name);
    out.push({
      source: sourceId,
      filename: e.name,
      absolutePath: abs,
      modified: statSync(abs).mtimeMs,
      relativeToProjectsDir: relativeToProjects(abs, projectsDir),
    });
  }
  out.sort((a, b) => a.filename.localeCompare(b.filename));
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

/**
 * The ordered legacy (flat) plan sources for a project: the project's own plans/
 * directory and its archived/ subdirectory. Kept readable during migration to OpenSpec;
 * the previous `.kilo`/`~/.claude/plans` roots have been dropped.
 */
function plansSources(
  projectDir: string,
  name: string,
): { id: string; label: string; absoluteRoot: string }[] {
  return [
    { id: "project", label: name, absoluteRoot: join(projectDir, "plans") },
    // Archived plans, moved here by /pavilio-archive-plan. Listed right after the
    // active project plans; the panel renders it as a default-collapsed group.
    { id: "project:archived", label: "Archived", absoluteRoot: join(projectDir, "plans", "archived") },
  ];
}

/** A resolved OpenSpec source: the project's own store plus each configured linked repo. */
interface OpenSpecSourceDesc {
  id: string;
  label: string;
  mode: "native" | "store";
  openspecDir: string;
  /**
   * True when the source comes from an explicit `openspec` entry in repos.json.
   * The project-local store is implicit, so its absence is normal — a configured
   * root that does not exist is a typo worth surfacing.
   */
  configured: boolean;
}

/** A repos.json `openspec` config that could not be resolved into a source. */
interface InvalidOpenSpecSourceDesc {
  id: string;
  label: string;
  /** The `root` exactly as written in repos.json; null when it wasn't a string. */
  configuredRoot: string | null;
  message: string;
}

/** The `root` a repos.json entry asked for, before resolution. */
function configuredRootOf(entry: unknown): string | null {
  const raw = (entry as { openspec?: { root?: unknown } })?.openspec?.root;
  return typeof raw === "string" ? raw : null;
}

/**
 * The OpenSpec roots a project surfaces: its own project-local store
 * (`plans/openspec/`) plus one per linked repo whose repos.json entry carries an
 * `openspec` config (resolved to a native `<repo>/openspec` or a store
 * `plans/<repo>/openspec`). Repos without an `openspec` key contribute nothing.
 *
 * A malformed or boundary-escaping config never becomes a source — it is
 * returned under `invalid` instead, so callers that read the filesystem stay on
 * validated roots while the Plans tab can still show the user their typo.
 */
function openSpecSources(projectDir: string): {
  sources: OpenSpecSourceDesc[];
  invalid: InvalidOpenSpecSourceDesc[];
} {
  const invalid: InvalidOpenSpecSourceDesc[] = [];
  const out: OpenSpecSourceDesc[] = [
    {
      id: "openspec:project",
      label: `${basename(projectDir)} (OpenSpec)`,
      mode: "store",
      openspecDir: join(projectDir, "plans", "openspec"),
      configured: false,
    },
  ];
  for (const r of readReposJson(projectDir)) {
    let openspecDir: string;
    let mode: "native" | "store";
    try {
      const config = parseOpenSpecConfig(r);
      const resolution = resolveOpenSpecRoot({
        projectPath: projectDir,
        repo: { name: r.name, path: resolve(expandHome(r.path)) },
        config,
      });
      if (resolution.mode === "unconfigured") continue;
      mode = resolution.mode;
      openspecDir = resolution.openspecDir;
    } catch (err) {
      // Unknown mode / root escaping its boundary → not a valid source, so it is
      // never read from. Reported (not silently skipped) so a typo'd
      // `openspec.root` doesn't disappear a repo's specs with zero signal.
      const message = (err as Error).message;
      console.warn(`[openSpecSources] ${basename(projectDir)}: skipping repo ${r.name}:`, message);
      invalid.push({
        id: `openspec:repo:${r.name}`,
        label: `${r.name} (OpenSpec)`,
        configuredRoot: configuredRootOf(r),
        message,
      });
      continue;
    }
    out.push({
      id: `openspec:repo:${r.name}`,
      label: `${r.name} (OpenSpec)`,
      mode,
      openspecDir,
      configured: true,
    });
  }
  return { sources: out, invalid };
}

interface PlanArtifact {
  /** proposal | design | tasks | spec (spec = a change's delta spec for a capability). */
  kind: "proposal" | "design" | "tasks" | "spec";
  /** Capability name for delta specs; null for proposal/design/tasks. */
  capability: string | null;
  filename: string;
  absolutePath: string;
  modified: number;
  relativeToProjectsDir: string | null;
}
interface ChangeRecord {
  /** Stable change identifier — the change directory name (shared across sources). */
  changeId: string;
  /** The owning source id, for UI grouping. */
  source: string;
  /** active = under changes/; archived = under changes/archive/. */
  status: "active" | "archived";
  /** YYYY-MM-DD prefix of an archived change dir, when present; null otherwise. */
  archiveDate: string | null;
  artifacts: PlanArtifact[];
}
interface OpenSpecSource {
  id: string;
  label: string;
  kind: "openspec";
  mode: "native" | "store";
  openspecDir: string;
  changes: ChangeRecord[];
  /**
   * Set when repos.json configures this source but `openspecDir` does not exist.
   * An empty configured tree is normal (nothing written yet) and stays hidden; a
   * missing one is almost always a wrong `openspec.root`, so it is surfaced
   * rather than rendered as "no changes".
   */
  missing?: true;
}
/**
 * A repos.json `openspec` config the server refused to resolve (unknown mode, or
 * a root escaping its repository/project). Carries no path to read — only what
 * was configured and why it was rejected.
 */
interface InvalidOpenSpecSource {
  id: string;
  label: string;
  kind: "openspec-error";
  configuredRoot: string | null;
  message: string;
}
/** A living capability spec under `<openspec>/specs/<capability>/spec.md`. */
interface LivingSpecFile {
  source: string;
  capability: string;
  filename: string;
  absolutePath: string;
  modified: number;
  relativeToProjectsDir: string | null;
}

/** Read the known Markdown artifacts of one change directory. */
function readChangeArtifacts(changeDir: string, projectsDir: string): PlanArtifact[] {
  const out: PlanArtifact[] = [];
  for (const kind of ["proposal", "design", "tasks"] as const) {
    const abs = join(changeDir, `${kind}.md`);
    if (existsSync(abs) && statSync(abs).isFile()) {
      out.push({
        kind,
        capability: null,
        filename: `${kind}.md`,
        absolutePath: abs,
        modified: statSync(abs).mtimeMs,
        relativeToProjectsDir: relativeToProjects(abs, projectsDir),
      });
    }
  }
  // Delta specs: changes/<id>/specs/<capability>/spec.md
  const specsDir = join(changeDir, "specs");
  if (existsSync(specsDir) && statSync(specsDir).isDirectory()) {
    for (const cap of readdirSync(specsDir, { withFileTypes: true })) {
      if (!cap.isDirectory()) continue;
      const abs = join(specsDir, cap.name, "spec.md");
      if (existsSync(abs) && statSync(abs).isFile()) {
        out.push({
          kind: "spec",
          capability: cap.name,
          filename: "spec.md",
          absolutePath: abs,
          modified: statSync(abs).mtimeMs,
          relativeToProjectsDir: relativeToProjects(abs, projectsDir),
        });
      }
    }
  }
  return out;
}

const ARCHIVE_DATE_RE = /^(\d{4}-\d{2}-\d{2})-.+$/;

/** Discover active and archived change records under one `openspec/` tree. */
function listOpenSpecChanges(openspecDir: string, sourceId: string, projectsDir: string): ChangeRecord[] {
  const changesDir = join(openspecDir, "changes");
  if (!existsSync(changesDir) || !statSync(changesDir).isDirectory()) return [];
  const out: ChangeRecord[] = [];
  for (const e of readdirSync(changesDir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === "archive") continue;
    const artifacts = readChangeArtifacts(join(changesDir, e.name), projectsDir);
    if (artifacts.length === 0) continue;
    out.push({ changeId: e.name, source: sourceId, status: "active", archiveDate: null, artifacts });
  }
  const archiveDir = join(changesDir, "archive");
  if (existsSync(archiveDir) && statSync(archiveDir).isDirectory()) {
    for (const e of readdirSync(archiveDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const artifacts = readChangeArtifacts(join(archiveDir, e.name), projectsDir);
      if (artifacts.length === 0) continue;
      const m = ARCHIVE_DATE_RE.exec(e.name);
      out.push({
        changeId: e.name,
        source: sourceId,
        status: "archived",
        archiveDate: m ? m[1] : null,
        artifacts,
      });
    }
  }
  out.sort((a, b) => a.changeId.localeCompare(b.changeId));
  return out;
}

/** Discover living capability specs under `<openspec>/specs/<capability>/spec.md`. */
function listOpenSpecLivingSpecs(openspecDir: string, sourceId: string, projectsDir: string): LivingSpecFile[] {
  const specsDir = join(openspecDir, "specs");
  if (!existsSync(specsDir) || !statSync(specsDir).isDirectory()) return [];
  const out: LivingSpecFile[] = [];
  for (const cap of readdirSync(specsDir, { withFileTypes: true })) {
    if (!cap.isDirectory()) continue;
    const abs = join(specsDir, cap.name, "spec.md");
    if (existsSync(abs) && statSync(abs).isFile()) {
      out.push({
        source: sourceId,
        capability: cap.name,
        filename: "spec.md",
        absolutePath: abs,
        modified: statSync(abs).mtimeMs,
        relativeToProjectsDir: relativeToProjects(abs, projectsDir),
      });
    }
  }
  out.sort((a, b) => a.capability.localeCompare(b.capability));
  return out;
}

/**
 * Directories a project may surface plan files from: the legacy flat `plans/` tree
 * (also covering `plans/archived/` and the project-local `plans/openspec/` store,
 * which nest under it) plus each configured OpenSpec root (native repo trees live
 * outside `plans/`). Unconfigured repos contribute nothing, so an `openspec/`-shaped
 * path under them is rejected as traversal.
 *
 * NOTE: `isPlanPathAllowed` uses a depth-agnostic `isPathUnder` check, so nested
 * artifacts (archived plans, `openspec/changes/<id>/...`) are admitted without listing
 * every subdirectory here.
 */
export function buildPlansAllowlist(projectDir: string, _projectsDir?: string): string[] {
  return [join(projectDir, "plans"), ...openSpecSources(projectDir).sources.map((s) => s.openspecDir)];
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
 * (b) it's a well-known context/ADR file shape, OR it is a living OpenSpec
 * capability spec (`<openspecDir>/specs/<capability>/spec.md`) under one of the
 * configured `openspecDirs`. OpenSpec living specs are gated only on the
 * configured roots, so an `openspec/`-shaped path under an unconfigured repo is
 * rejected even though the repo may appear in `allowlist` for its CONTEXT/ADRs.
 */
export function isContextPathAllowed(
  absolutePath: string,
  allowlist: string[],
  openspecDirs: string[] = [],
): boolean {
  if (absolutePath.includes("\0")) return false;
  // OpenSpec living spec: <openspecDir>/specs/<capability>/spec.md (exact depth).
  if (basename(absolutePath) === "spec.md") {
    for (const openspecDir of openspecDirs) {
      const specsRoot = join(openspecDir, "specs");
      if (isPathUnder(absolutePath, specsRoot) && dirname(dirname(absolutePath)) === specsRoot) {
        // The depth/prefix check above is pure string math — a symlinked
        // capability dir or spec.md file would otherwise sail through it and
        // resolve outside specsRoot on read. Reject when the path exists and
        // its realpath differs (i.e. a symlink is in the chain).
        if (existsSync(absolutePath)) {
          try {
            if (realpathSync(absolutePath) !== absolutePath) continue;
          } catch {
            continue;
          }
        }
        return true;
      }
    }
  }
  const containingRoot = allowlist.find((root) => isPathUnder(absolutePath, root));
  if (!containingRoot) return false;
  const name = basename(absolutePath);
  if (name === "CONTEXT.md" || name === "CONTEXT-MAP.md") return true;
  if (!/\.md$/i.test(name)) return false;
  // ADR files must live under <root>/adr/ or <root>/docs/adr/
  const adrRoots = [join(containingRoot, "adr"), join(containingRoot, "docs", "adr")];
  if (adrRoots.some((r) => isPathUnder(absolutePath, r) && absolutePath !== r)) return true;
  // Living specs: direct children of <root>/specs/ only — mirrors the top-level-only listing,
  // so nothing is readable that the sidebar can't surface.
  return dirname(absolutePath) === join(containingRoot, "specs");
}

/** Same shapes the colour store accepts; kept here so a bad body is a 400, not a 500. */
const COLOR_HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Literal path, registered ahead of every `/:name/...` pattern so it can never be
// read as a project named "colors".
router.get("/colors", (_req, res) => {
  try {
    const names = discoverProjects().map((p) => p.name);
    // The store returns the whole persisted map, which can still hold entries for
    // projects that have since been deleted. Narrow to the discovered set: this is
    // the client's list of known projects, and a stale name would render a chip for
    // something that no longer exists. The entry stays on disk, so a project that
    // comes back keeps its colour.
    const resolved = resolveProjectColors(names);
    const colors: Record<string, string> = {};
    for (const name of names) colors[name] = resolved[name];
    res.json({ colors });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.put("/:name/color", (req, res) => {
  // Existence comes from discovery — the same source `GET /` and `GET /colors` use —
  // so a traversal-shaped name is rejected here instead of reaching the store.
  if (!discoverProjects().some((p) => p.name === req.params.name)) {
    return res.status(404).json({ error: "Project not found" });
  }
  const hex = typeof req.body?.hex === "string" ? req.body.hex : "";
  if (!COLOR_HEX_RE.test(hex)) return res.status(400).json({ error: "Invalid colour" });
  try {
    setProjectColor(req.params.name, hex);
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
  res.json({ ok: true });
});

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
  const specs: SpecFile[] = [];
  for (const s of sources) {
    if (!existsSync(s.absoluteRoot)) continue;
    contexts.push(...listContextFilesInRoot(s.absoluteRoot, s.id, projectsDir));
    adrs.push(...listAdrFilesInRoot(s.absoluteRoot, s.id, projectsDir));
    specs.push(...listSpecFilesInRoot(s.absoluteRoot, s.id, projectsDir));
  }

  // Living OpenSpec capability specs, grouped by source (project store + linked repos).
  const openspecSpecs: LivingSpecFile[] = [];
  const openspecSources: ContextSource[] = [];
  for (const os of openSpecSources(projectDir).sources) {
    const living = listOpenSpecLivingSpecs(os.openspecDir, os.id, projectsDir);
    if (living.length === 0) continue;
    openspecSources.push({ id: os.id, label: os.label, absoluteRoot: os.openspecDir });
    openspecSpecs.push(...living);
  }

  res.json({
    project: req.params.name,
    sources: [...sources, ...openspecSources],
    contexts,
    adrs,
    specs,
    openspecSpecs,
  });
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
  const openspecDirs = openSpecSources(projectDir).sources.map((s) => s.openspecDir);
  if (!isContextPathAllowed(absPath, allowlist, openspecDirs)) {
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

  // OpenSpec sources are collected first: whether any of them actually
  // contributed a change decides if the (often permanently empty) legacy flat
  // node is worth a row. Wire order stays legacy-then-openspec below.
  const openspecSources: (OpenSpecSource | InvalidOpenSpecSource)[] = [];
  // Only a real, listed change counts — a `missing: true` source or a rejected
  // config surfaces for visibility but contributes nothing.
  let contributedChanges = 0;
  const openspec = openSpecSources(projectDir);
  // Rejected configs first — an invisible typo is the whole reason they surface.
  for (const bad of openspec.invalid) {
    openspecSources.push({
      id: bad.id,
      label: bad.label,
      kind: "openspec-error",
      configuredRoot: bad.configuredRoot,
      message: bad.message,
    });
  }
  for (const os of openspec.sources) {
    const base = {
      id: os.id,
      label: os.label,
      kind: "openspec" as const,
      mode: os.mode,
      openspecDir: os.openspecDir,
    };
    // A configured root that isn't there: surface it, don't let a typo look like
    // an empty backend.
    if (os.configured && !existsSync(os.openspecDir)) {
      openspecSources.push({ ...base, changes: [], missing: true });
      continue;
    }
    const changes = listOpenSpecChanges(os.openspecDir, os.id, projectsDir);
    if (changes.length === 0) continue;
    contributedChanges += changes.length;
    openspecSources.push({ ...base, changes });
  }

  const legacySources: PlanSource[] = [];
  for (const c of plansSources(projectDir, req.params.name)) {
    const files = listPlanFilesInDir(c.absoluteRoot, c.id, projectsDir);
    // The flat project node is kept when empty only as a fallback — once
    // OpenSpec carries the plans it is pure noise.
    if (files.length === 0 && (c.id !== "project" || contributedChanges > 0)) continue;
    legacySources.push({ id: c.id, label: c.label, absoluteRoot: c.absoluteRoot, files });
  }

  const sources: (PlanSource | OpenSpecSource | InvalidOpenSpecSource)[] = [
    ...legacySources,
    ...openspecSources,
  ];

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
  const projectDir = resolve(projectsDir, req.params.name);
  if (!isPathUnder(projectDir, projectsDir) || projectDir === projectsDir || !existsSync(projectDir)) {
    return res.status(404).json({ error: "Project not found" });
  }
  const currentMdPath = join(projectDir, "plans", "CURRENT.md");
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
