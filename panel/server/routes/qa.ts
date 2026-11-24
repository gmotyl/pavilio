import { Router } from "express";
import { lstat, realpath, rm, stat } from "fs/promises";
import { join, resolve } from "path";
import { getConfig } from "../config.js";
import { requireProject } from "./mockups.js";

/**
 * Delete one QA artifact of a project: a story or review file, or a whole run
 * folder. Nothing else under `qa/` (REVIEW_RULES.md, a run's own files, dot
 * files) can go through here, and only at its canonical path: symlinks (the
 * leaf or any parent dir) are never followed. Plain filesystem removal — no
 * git command runs; auto-sync picks the deletion up like any other change.
 */
const router = Router();

type Shape = { kind: "stories" | "reviews" | "runs"; name: string };

/** One path segment that is a name: no separators, not `.`/`..`, not a dot file. */
const SEGMENT = /^[^./\\][^/\\]*$/;

/** The accepted shape of `parts`, or null for anything else. */
function parseShape(parts: string[]): Shape | null {
  if (parts.length !== 2) return null;
  const [kind, name] = parts;
  if (!SEGMENT.test(name) || name.includes("..")) return null;
  if (kind === "stories" || kind === "reviews") {
    return name.endsWith(".md") && name.length > 3 ? { kind, name } : null;
  }
  if (kind === "runs") return { kind, name };
  return null;
}

router.delete("/:project/qa/*path", requireProject, async (req, res) => {
  const raw = req.params.path as string | string[];
  const parts = Array.isArray(raw) ? raw : raw.split("/");
  const shape = parseShape(parts);
  if (!shape) return res.status(400).json({ error: "Not a deletable QA path" });

  const projectDir = resolve(getConfig().projectsDir, req.params.project as string);
  const target = join(projectDir, "qa", shape.kind, shape.name);

  const link = await lstat(target).catch(() => null);
  if (!link) return res.status(404).json({ error: "Not found" });

  // Resolve every symlink on the way and require the real path to be exactly
  // `<real project>/qa/<kind>/<name>`. A symlinked `qa/`, `qa/<kind>/` (e.g.
  // reviews -> runs) or leaf — even one pointing elsewhere inside qa/ — fails
  // this, so only the artifact at its own canonical path is ever removed.
  let real: string;
  try {
    const expected = join(await realpath(projectDir), "qa", shape.kind, shape.name);
    real = await realpath(target);
    if (real !== expected) {
      return res.status(400).json({ error: "Not a deletable QA path" });
    }
  } catch {
    // A dangling symlink: realpath cannot resolve it.
    return res.status(404).json({ error: "Not found" });
  }
  // Belt and braces: a leaf symlink cannot resolve to its own path, but never
  // delete one regardless.
  if (link.isSymbolicLink()) {
    return res.status(400).json({ error: "Not a deletable QA path" });
  }
  const info = await stat(real);
  const ok = shape.kind === "runs" ? info.isDirectory() : info.isFile();
  if (!ok) return res.status(400).json({ error: "Not a deletable QA path" });

  try {
    await rm(real, { recursive: shape.kind === "runs" });
  } catch (err) {
    console.error("[qa] delete failed:", err);
    return res.status(500).json({ error: "Could not delete" });
  }
  res.status(204).end();
});

export default router;
