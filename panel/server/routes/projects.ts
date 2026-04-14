import { Router } from "express";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { discoverProjects } from "../lib/discovery.js";
import { getConfig } from "../config.js";

const router = Router();

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
