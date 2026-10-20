import { existsSync } from "fs";
import { join } from "path";

/**
 * A project is a direct child dir of `projectsDir` with a `PROJECT.md` — the rule project
 * discovery (the panel's project list) and the wiki CLI's project resolution share.
 */
export function isProjectDir(projectsDir: string, name: string): boolean {
  if (!name || name === "." || name === ".." || /[/\\]/.test(name)) return false;
  return existsSync(join(projectsDir, name, "PROJECT.md"));
}
