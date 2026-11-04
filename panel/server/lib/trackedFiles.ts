// Which files git tracks in one directory — "committed", as opposed to merely
// present in the working tree.
import { execFile } from "node:child_process";
import { gitSafeEnv } from "./gitEnv.js";

/**
 * The names of the files git tracks directly in `dir` (not in its
 * subdirectories). Undefined when `dir` is missing or not inside a git
 * repository, so a caller can fall back to what is on disk; an empty list when
 * the repository simply tracks nothing there (an ignored directory included).
 */
export function trackedFileNames(dir: string): Promise<string[] | undefined> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", dir, "ls-files", "-z", "--", "."],
      { env: gitSafeEnv(), maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve(undefined);
        // Paths come back relative to `dir`; nested ones carry a `/`.
        resolve(String(stdout).split("\0").filter((p) => p !== "" && !p.includes("/")));
      },
    );
  });
}
