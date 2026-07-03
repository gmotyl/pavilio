import { readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { getConfig } from "../config.js";

export interface FileEntry {
  relativePath: string;
  absolutePath: string;
  project: string;
  modified: number;
  archived: boolean;
}

let index: FileEntry[] = [];

function walk(dir: string, projectsDir: string): FileEntry[] {
  const entries: FileEntry[] = [];
  const items = readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = join(dir, item.name);
    if (item.name.startsWith(".") || item.name === "node_modules") continue;

    if (item.isDirectory()) {
      entries.push(...walk(fullPath, projectsDir));
    } else if (
      item.name.endsWith(".md") ||
      item.name.endsWith(".txt") ||
      item.name.endsWith(".json")
    ) {
      const rel = relative(projectsDir, fullPath);
      const segs = rel.split("/");
      const archived = segs[0] === "archived";
      const project = archived ? (segs[1] ?? "archived") : segs[0];
      const stat = statSync(fullPath);
      entries.push({
        relativePath: rel,
        absolutePath: fullPath,
        project,
        modified: stat.mtimeMs,
        archived,
      });
    }
  }
  return entries;
}

export function rebuildIndex(): void {
  const { projectsDir } = getConfig();
  index = walk(projectsDir, projectsDir).sort((a, b) => b.modified - a.modified);
  console.log(`File index rebuilt: ${index.length} files`);
}

export function getFileIndex(): FileEntry[] {
  return index;
}
