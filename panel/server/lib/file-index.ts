import { readdirSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { getConfig } from "../config.js";

export interface FileEntry {
  relativePath: string;
  absolutePath: string;
  project: string;
  modified: number;
  archived: boolean;
}

let index: FileEntry[] = [];

const TEXT_EXTS = [".md", ".txt", ".json", ".html"];
// Images are indexed only inside a mockups/ directory so notes/memo lists
// do not fill up with screenshots
const MOCKUP_IMAGE_EXTS = [".svg", ".png", ".jpg", ".jpeg", ".webp"];

function isIndexable(name: string, inMockups: boolean): boolean {
  const lower = name.toLowerCase();
  if (TEXT_EXTS.some((ext) => name.endsWith(ext))) return true;
  return inMockups && MOCKUP_IMAGE_EXTS.some((ext) => lower.endsWith(ext));
}

function walk(dir: string, projectsDir: string, inMockups = false): FileEntry[] {
  const entries: FileEntry[] = [];
  const items = readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = join(dir, item.name);
    if (item.name.startsWith(".") || item.name === "node_modules") continue;

    if (item.isDirectory()) {
      entries.push(
        ...walk(fullPath, projectsDir, inMockups || item.name === "mockups"),
      );
    } else if (isIndexable(item.name, inMockups)) {
      // POSIX separators everywhere: relativePath is split on "/" here and
      // used verbatim in API responses and URLs by the frontend
      const rel = relative(projectsDir, fullPath).split(sep).join("/");
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
