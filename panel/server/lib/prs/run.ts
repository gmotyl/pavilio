import { execFile } from "node:child_process";
import { gitSafeEnv } from "../gitEnv.js";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Resolves with the exit code for any exit; rejects only when the process could not start (e.g. ENOENT). */
export type Runner = (
  cmd: string,
  args: string[],
  opts: { cwd: string; env?: Record<string, string> },
) => Promise<RunResult>;

const TIMEOUT_MS = 30_000;

// A credential prompt would hang the request until the timeout; fail fast instead.
export const GIT_ENV: Record<string, string> = { GIT_TERMINAL_PROMPT: "0" };

export const defaultRunner: Runner = (cmd, args, { cwd, env }) =>
  new Promise((resolve, reject) => {
    // gitSafeEnv: an inherited GIT_DIR would retarget git (and gh's git calls) away from `cwd`.
    execFile(
      cmd,
      args,
      { cwd, env: { ...gitSafeEnv(), ...env }, timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, encoding: "utf-8" },
      (err, stdout, stderr) => {
        if (err && typeof err.code === "string") return reject(err);
        const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
