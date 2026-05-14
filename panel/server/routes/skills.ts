import { Router } from "express";
import { readdirSync, statSync, readFileSync } from "fs";
import { resolve, join } from "path";
import { getConfig } from "../config.js";

const router = Router();

function parseSkillDescription(skillMdPath: string): string {
  try {
    const content = readFileSync(skillMdPath, "utf-8");
    const lines = content.split("\n");
    // YAML frontmatter: --- name: ... description: ... ---
    if (lines[0]?.trim() === "---") {
      for (let i = 1; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed === "---") break;
        const m = trimmed.match(/^description:\s*(.+)$/);
        if (m) return m[1].replace(/^["']|["']$/g, "").slice(0, 240);
      }
    }
    // Fallback: first non-heading, non-fence body line
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("---")) continue;
      return trimmed.slice(0, 240);
    }
  } catch {}
  return "";
}

router.get("/", (_req, res) => {
  const { projectsDir } = getConfig();
  const skillsDir = resolve(projectsDir, "../skills");

  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    const skills = entries
      .map((name) => {
        const skillMd = join(skillsDir, name, "SKILL.md");
        try {
          const stat = statSync(skillMd);
          return {
            name,
            description: parseSkillDescription(skillMd),
            modified: stat.mtimeMs,
          };
        } catch {
          return null;
        }
      })
      .filter((s): s is { name: string; description: string; modified: number } => s !== null);

    res.json(skills);
  } catch {
    res.json([]);
  }
});

export default router;
