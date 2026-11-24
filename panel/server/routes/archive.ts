import { Router } from "express";
import {
  existsSync,
  mkdirSync,
  renameSync,
  readdirSync,
  utimesSync,
} from "fs";
import { join } from "path";
import { getConfig } from "../config.js";
import { rebuildIndex } from "../lib/file-index.js";
import { markArchivedInRegistry, markRestoredInRegistry } from "../lib/registry.js";
import { projectDescription } from "../lib/projects/description.js";
import { projectKind } from "../lib/projects/kind.js";
import { projectGroup } from "../lib/projects/group.js";
import { KNOWLEDGE_PROJECT, knowledgeTargetsIn } from "../lib/wiki/harvest.js";
import { archivedAt, archivedRoot } from "../lib/discovery.js";

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
  const archivedDir = archivedRoot(projectsDir);
  if (!existsSync(archivedDir)) return res.json([]);
  const list = readdirSync(archivedDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const dir = join(archivedDir, e.name);
      return {
        name: e.name,
        archivedAt: archivedAt(dir),
        // Resolve against archived/ so a live project of the same name never answers.
        kind: projectKind(archivedDir, e.name),
        description: projectDescription(dir),
      };
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

/**
 * Why archived `name` may not come back, mirroring scaffold's rules: it is `knowledge` with a
 * group (any kind), an ungrouped knowledge wiki not named `knowledge`, or a knowledge wiki whose
 * harvest target (the ungrouped one, or its group's) is held by an active wiki — e.g. the `-2`
 * the harvest made while it was archived. Two would make `scripts/wiki targets` ambiguous and
 * block every harvest.
 */
function takenKnowledgeTarget(projectsDir: string, name: string): string | null {
  const archivedDir = archivedRoot(projectsDir);
  const group = projectGroup(archivedDir, name);
  if (name === KNOWLEDGE_PROJECT && group !== null) {
    return (
      `Cannot restore ${name}: ${KNOWLEDGE_PROJECT} is the workspace-wide knowledge wiki and takes ` +
      `no group — remove group: ${group} from its PROJECT.md first`
    );
  }
  if (projectKind(archivedDir, name) !== "knowledge") return null;
  // Same rule as scaffold: the harvest locks, logs and commits the ungrouped wiki by name, so any
  // other name would take the global slot and block both the harvest and a later `knowledge`.
  if (group === null && name !== KNOWLEDGE_PROJECT) {
    return (
      `Cannot restore knowledge wiki ${name}: an ungrouped knowledge wiki must be named ` +
      `${KNOWLEDGE_PROJECT} — rename it to ${KNOWLEDGE_PROJECT} or give it a group in its PROJECT.md first`
    );
  }
  let holder: string | null;
  try {
    const targets = knowledgeTargetsIn(projectsDir);
    holder = group === null ? targets.global : (targets.groups[group] ?? null);
  } catch (err) {
    return `Cannot restore knowledge wiki ${name}: ${(err as Error).message}`;
  }
  if (holder === null) return null;
  return group === null
    ? `Cannot restore knowledge wiki ${name}: the ungrouped knowledge wiki is ${holder}`
    : `Cannot restore knowledge wiki ${name}: group ${group} already has ${holder}`;
}

router.post("/:name/restore", (req, res) => {
  const { name } = req.params;
  if (!isSafeName(name)) return res.status(400).json({ error: "Invalid project name" });
  const { projectsDir } = getConfig();
  const src = join(projectsDir, "archived", name);
  const dest = join(projectsDir, name);
  if (!existsSync(src)) return res.status(404).json({ error: `Not archived: ${name}` });
  if (existsSync(dest)) return res.status(409).json({ error: `Active project exists: ${name}` });
  const taken = takenKnowledgeTarget(projectsDir, name);
  if (taken) return res.status(409).json({ error: taken });
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
