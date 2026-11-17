import { execFileSync } from "node:child_process";
import { relative } from "node:path";

import { gitSafeEnv } from "../gitEnv.js";

/**
 * Commit exactly `paths` (absolute, inside the repo containing `cwd`) with `message`.
 * `--only` keeps anything else already staged out of the commit. Throws with git's
 * stderr on failure.
 */
export function commitPaths(cwd: string, paths: string[], message: string): void {
  const rel = paths.map((p) => relative(cwd, p) || ".");
  try {
    execFileSync("git", ["commit", "--only", "-q", "-m", message, "--", ...rel], {
      cwd,
      env: gitSafeEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message: string };
    const detail = `${e.stderr ?? ""}${e.stdout ?? ""}`.trim();
    throw new Error(detail || e.message);
  }
}
