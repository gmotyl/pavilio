import { Router } from "express";
import { isAbsolute, posix, resolve } from "path";
import { discoverProjects } from "../lib/discovery.js";
import { expandHome } from "../lib/paths.js";
import { createTsNav, type TsNav } from "../lib/ts-nav.js";
import { listRepoWorktrees } from "../lib/worktrees.js";

/** A present linked repo or one of its worktrees: a language service may only start where the panel already browses. */
function isLinkedRepo(target: string): boolean {
  const roots = discoverProjects().flatMap((p) => p.repos.filter((r) => r.present).map((r) => resolve(expandHome(r.path))));
  if (roots.includes(target)) return true;
  return roots.some((root) => listRepoWorktrees(root).some((w) => resolve(w.path) === target));
}

/** Repo-relative POSIX path, or null when absolute or escaping the repo. */
function repoRelativePath(raw: string): string | null {
  if (raw.includes("\0") || isAbsolute(raw) || posix.isAbsolute(raw)) return null;
  const norm = posix.normalize(raw.replace(/\\/g, "/"));
  return norm === "." || norm === ".." || norm.startsWith("../") ? null : norm;
}

const positiveInt = (v: unknown): number | null => {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

export function createCodeRouter(nav: TsNav, opts: { isLinked?: (repo: string) => boolean } = {}): Router {
  const isLinked = opts.isLinked ?? isLinkedRepo;
  const router = Router();

  router.get("/definition", async (req, res) => {
    const { repo, path, line, col } = req.query;
    if (typeof repo !== "string" || !repo) return res.status(400).json({ error: "repo parameter required" });
    const rel = typeof path === "string" ? repoRelativePath(path) : null;
    if (!rel) return res.status(400).json({ error: "path must be repo-relative" });
    const l = positiveInt(line);
    const c = positiveInt(col);
    if (!l || !c) return res.status(400).json({ error: "line and col must be positive integers" });
    const root = resolve(expandHome(repo));
    if (!isLinked(root)) return res.status(400).json({ error: "repo is not linked to any project" });

    res.json({ locations: await nav.definition(root, rel, l, c) });
  });

  return router;
}

export default createCodeRouter(createTsNav());
