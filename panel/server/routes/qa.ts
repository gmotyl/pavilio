import { Router } from "express";
import { lstat, realpath, rm, stat } from "fs/promises";
import { join, resolve } from "path";
import { getConfig } from "../config.js";
import { isPathUnder } from "../lib/mockup-import.js";
import { requireProject } from "./mockups.js";

/**
 * Delete one QA artifact of a project: a story or review file, or a whole run
 * folder. Nothing else under `qa/` (REVIEW_RULES.md, a run's own files, dot
 * files) can go through here. Plain filesystem removal — no git command runs;
 * auto-sync picks the deletion up like any other change.
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

  // Follow symlinks before deciding: the real target must sit inside qa/.
  let real: string;
  try {
    const qaRoot = join(await realpath(projectDir), "qa");
    real = await realpath(target);
    if (real === qaRoot || !isPathUnder(real, qaRoot)) {
      return res.status(400).json({ error: "Path is outside the project's qa folder" });
    }
  } catch {
    // A dangling symlink: realpath cannot resolve it.
    return res.status(404).json({ error: "Not found" });
  }
  // A symlink is never deleted, even one pointing inside qa/: only the
  // artifact itself is a valid target.
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
