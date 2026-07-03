import { Router } from "express";
import { getConfig } from "../config.js";
import { getFileIndex } from "../lib/file-index.js";
import { readFileSync } from "fs";
import { resolve } from "path";

const router = Router();

interface SearchMatch {
  line: number;
  text: string;
}

interface SearchResult {
  relativePath: string;
  project: string;
  matches: SearchMatch[];
}

router.get("/grep", (req, res) => {
  const query = req.query.q as string;
  if (!query || query.length < 2) return res.json([]);

  const project = req.query.project as string | undefined;
  const { projectsDir } = getConfig();
  const allFiles = getFileIndex();
  const includeArchived = req.query.includeArchived !== "false";
  const files = (project ? allFiles.filter((f) => f.project === project) : allFiles).filter(
    (f) => includeArchived || !f.archived,
  );
  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();
  const maxResults = 20;
  const maxMatchesPerFile = 3;

  for (const file of files) {
    if (results.length >= maxResults) break;
    // Only search text files
    if (!file.relativePath.match(/\.(md|txt|json|ts|tsx|js|jsx|yaml|yml|toml)$/)) continue;

    try {
      const absPath = resolve(projectsDir, file.relativePath);
      const content = readFileSync(absPath, "utf-8");
      const lines = content.split("\n");
      const matches: SearchMatch[] = [];

      for (let i = 0; i < lines.length && matches.length < maxMatchesPerFile; i++) {
        if (lines[i].toLowerCase().includes(lowerQuery)) {
          matches.push({ line: i + 1, text: lines[i].trim().slice(0, 200) });
        }
      }

      if (matches.length > 0) {
        results.push({ relativePath: file.relativePath, project: file.project, matches });
      }
    } catch {
      // skip unreadable files
    }
  }

  res.json(results);
});

export default router;
