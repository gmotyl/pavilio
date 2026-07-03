import { Router } from "express";
import { existsSync, mkdirSync, renameSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { getConfig } from "../config.js";
import { rebuildIndex } from "../lib/file-index.js";

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
  mkdirSync(join(projectsDir, "archived"), { recursive: true });
  renameSync(src, dest);
  rebuildIndex();
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
  renameSync(src, dest);
  rebuildIndex();
  res.json({ ok: true });
});

export default router;
