import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";

import { isProjectDir } from "../project-dir";

export const PROJECT_KINDS = ["project", "research", "knowledge"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

const FENCE = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

/**
 * The dir holding the project's `PROJECT.md`: `<projectsDir>/<project>` when active, else
 * `<projectsDir>/archived/<project>`, else null. An unsafe name (`..`, a slash) is never a project.
 */
export function projectCardDir(projectsDir: string, project: string): string | null {
  if (isProjectDir(projectsDir, project)) return join(projectsDir, project);
  const archivedDir = join(projectsDir, "archived");
  if (isProjectDir(archivedDir, project)) return join(archivedDir, project);
  return null;
}

/**
 * The project's `kind` from its `PROJECT.md` frontmatter. Missing project, missing or broken
 * frontmatter, and unknown values all mean `project`.
 */
export function projectKind(projectsDir: string, project: string): ProjectKind {
  const dir = projectCardDir(projectsDir, project);
  if (!dir) return "project";
  const card = join(dir, "PROJECT.md");
  if (!existsSync(card)) return "project";
  let text = readFileSync(card, "utf8");
  // Editors on Windows may save a UTF-8 BOM, which would hide the opening fence.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const match = FENCE.exec(text);
  if (!match) return "project";
  let data: unknown;
  try {
    data = parseYaml(match[1] ?? "", { uniqueKeys: false });
  } catch {
    return "project";
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return "project";
  const kind = (data as Record<string, unknown>).kind;
  return typeof kind === "string" && (PROJECT_KINDS as readonly string[]).includes(kind)
    ? (kind as ProjectKind)
    : "project";
}
