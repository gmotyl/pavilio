import { existsSync, readFileSync } from "fs";
import { join } from "path";

import { isProjectDir } from "../project-dir";
import { splitFrontmatter } from "./frontmatter";

export const PROJECT_KINDS = ["project", "research", "knowledge"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

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
  const kind = splitFrontmatter(readFileSync(card, "utf8")).data.kind;
  return typeof kind === "string" && (PROJECT_KINDS as readonly string[]).includes(kind)
    ? (kind as ProjectKind)
    : "project";
}
