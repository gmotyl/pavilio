import { Router } from "express";
import {
  existsSync,
  mkdirSync,
  renameSync,
  readdirSync,
  statSync,
  utimesSync,
} from "fs";
import { join } from "path";
import { getConfig } from "../config.js";
import { rebuildIndex } from "../lib/file-index.js";
import { markArchivedInRegistry, markRestoredInRegistry } from "../lib/registry.js";

const router = Router();

/** Single path segment only — no separators, no dot-dirs. */
function isSafeName(name: string): boolean {
  return (
    name.length > 0 &&
    !name.includes("/") &&
    !name.includes("\\") &&
    name !== "." &&
    name !== ".." &&
    name !== "archived"
  );
}

router.get("/", (_req, res) => {
  const { projectsDir } = getConfig();
  const archivedDir = join(projectsDir, "archived");
  if (!existsSync(archivedDir)) return res.json([]);
  const list = readdirSync(archivedDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const stat = statSync(join(archivedDir, e.name));
      return { name: e.name, archivedAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
  res.json(list);
});

router.post("/:name", (req, res) => {
  const { name } = req.params;
  if (!isSafeName(name)) return res.status(400).json({ error: "Invalid project name" });
  const { projectsDir } = getConfig();
  const src = join(projectsDir, name);
  const dest = join(projectsDir, "archived", name);
  if (!existsSync(src)) return res.status(404).json({ error: `Unknown project: ${name}` });
  if (existsSync(dest)) return res.status(409).json({ error: `Already archived: ${name}` });
  try {
    mkdirSync(join(projectsDir, "archived"), { recursive: true });
    renameSync(src, dest);
    // rename preserves mtime; touch so archivedAt reflects the archive time
    const now = new Date();
    utimesSync(dest, now, now);
  } catch (err) {
    return res.status(500).json({ error: `Archive failed: ${(err as Error).message}` });
  }
  try {
    markArchivedInRegistry(projectsDir, name);
  } catch (err) {
    // registry sync is best-effort; the move itself succeeded
    console.warn("[archive] registry update failed:", err);
  }
  try {
    rebuildIndex();
  } catch (err) {
    // move already succeeded; watcher will rebuild shortly
    console.warn("[archive] rebuildIndex failed:", err);
  }
  res.json({ ok: true });
});

router.post("/:name/restore", (req, res) => {
  const { name } = req.params;
  if (!isSafeName(name)) return res.status(400).json({ error: "Invalid project name" });
  const { projectsDir } = getConfig();
  const src = join(projectsDir, "archived", name);
  const dest = join(projectsDir, name);
  if (!existsSync(src)) return res.status(404).json({ error: `Not archived: ${name}` });
  if (existsSync(dest)) return res.status(409).json({ error: `Active project exists: ${name}` });
  try {
    renameSync(src, dest);
  } catch (err) {
    return res.status(500).json({ error: `Restore failed: ${(err as Error).message}` });
  }
  try {
    markRestoredInRegistry(projectsDir, name);
  } catch (err) {
    console.warn("[archive] registry update failed:", err);
  }
  try {
    rebuildIndex();
  } catch (err) {
    console.warn("[archive] rebuildIndex failed:", err);
  }
  res.json({ ok: true });
});

export default router;
