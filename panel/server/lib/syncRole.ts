// A machine's sync role, derived from the workspace as committed on a ref (in
// practice origin/main), never from the working tree: a promotion pushed from
// another machine counts as soon as it has been fetched.
import { spawn } from "node:child_process";
import { gitSafeEnv } from "./gitEnv.js";
import { sanitizeHostname } from "./hostname.js";

export type SyncRole = "mirror" | "consumer" | "single" | "unassigned";
// single = no mirror file and no other machine id in the last `days` of history;
// unassigned = no mirror file but another machine id is present.

/** Workspace-relative path of the committed mirror record. */
export const SYNC_MIRROR_FILE = ".pavilio/sync-mirror.json";

const AUTO_SYNC_SUBJECT = /^auto-sync (\S+)/;
const TIME_FILE = /^projects\/(?:.+\/)?time\/([^/]+)\.jsonl$/;

function git(repo: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: repo, env: gitSafeEnv() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** The mirror id recorded on `ref`; undefined when there is no file, null when it is malformed. */
async function readMirror(repo: string, ref: string): Promise<string | undefined | null> {
  const spec = `${ref}:${SYNC_MIRROR_FILE}`;
  if ((await git(repo, ["cat-file", "-e", spec])).code !== 0) return undefined;
  const shown = await git(repo, ["show", spec]);
  if (shown.code !== 0) return null;
  try {
    const parsed: unknown = JSON.parse(shown.stdout);
    const mirror = (parsed as { mirror?: unknown } | null)?.mirror;
    if (typeof mirror !== "string" || mirror.trim() === "") return null;
    return sanitizeHostname(mirror);
  } catch {
    return null;
  }
}

/** Machine ids (sanitized) that left auto-sync commits or time files on `ref` in the last `days`. */
async function recentMachineIds(repo: string, ref: string, days: number): Promise<Set<string>> {
  const res = await git(repo, ["log", `--since=${days}.days.ago`, "--format=%x00%s", "--name-only", ref, "--"]);
  if (res.code !== 0) throw new Error(`git log ${ref} failed in ${repo}: ${res.stderr.trim()}`);
  const ids = new Set<string>();
  for (const entry of res.stdout.split("\0").slice(1)) {
    const [subject = "", ...paths] = entry.split("\n");
    const fromSubject = AUTO_SYNC_SUBJECT.exec(subject)?.[1];
    if (fromSubject) ids.add(sanitizeHostname(fromSubject));
    for (const path of paths) {
      const fromPath = TIME_FILE.exec(path.trim())?.[1];
      if (fromPath) ids.add(sanitizeHostname(fromPath));
    }
  }
  return ids;
}

export async function resolveSyncRole(opts: {
  repo: string;
  ref: string;
  machineId: string;
  days?: number /* 30 */;
}): Promise<SyncRole> {
  const { repo, ref, days = 30 } = opts;
  const me = sanitizeHostname(opts.machineId);
  const verified = await git(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  if (verified.code !== 0) throw new Error(`sync role: ref ${ref} not found in ${repo}`);

  const mirror = await readMirror(repo, ref);
  if (mirror === null) return "unassigned";
  if (mirror !== undefined) return mirror === me ? "mirror" : "consumer";

  for (const id of await recentMachineIds(repo, ref, days)) if (id !== me) return "unassigned";
  return "single";
}
