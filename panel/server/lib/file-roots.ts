import { resolve } from "path";
import { getConfig } from "../config.js";

export type RootId = "projects" | "skills" | "claude-commands" | "opencode-commands";

const VALID: RootId[] = ["projects", "skills", "claude-commands", "opencode-commands"];

export function isValidRoot(s: string): s is RootId {
  return (VALID as string[]).includes(s);
}

export function resolveRoot(id: RootId): string {
  const { projectsDir } = getConfig();
  const repoRoot = resolve(projectsDir, "..");
  switch (id) {
    case "projects":          return projectsDir;
    case "skills":            return resolve(repoRoot, "skills");
    case "claude-commands":   return resolve(repoRoot, ".claude/commands");
    case "opencode-commands": return resolve(repoRoot, ".opencode/commands");
  }
}
