/*
 * Ported from clone_repo.py in decodingai-magazine/llm-wiki-workshop
 * (https://github.com/decodingai-magazine/llm-wiki-workshop).
 *
 * MIT License
 *
 * Copyright (c) 2026 Decoding AI Magazine
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { execFile } from "child_process";
import { existsSync, lstatSync, realpathSync, rmSync, statSync, writeFileSync } from "fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { promisify } from "util";

import { ensureContainedDir } from "./contained-dir";

/**
 * Shallow-clone a git repo into `<projectDir>/wiki/raw/repos/<owner>-<repo>/` and
 * report its HEAD SHA. The clone is the raw artifact for a repo source and a
 * regenerable cache: deleting it is always safe, and re-ingesting refreshes it in
 * place. `raw/repos/` carries a `*` .gitignore so clones (nested `.git` dirs)
 * never get committed into the workspace repo.
 */

const run = promisify(execFile);

export const GIT_TIMEOUT_MS = 5 * 60 * 1000;

export type CloneReceipt = {
  /** Clone path relative to the wiki dir, e.g. `raw/repos/<owner>-<repo>`. */
  clonePath: string;
  commitSha: string;
  action: "cloned" | "refreshed";
};

export type CloneRepoOptions = {
  /** Extra env for git (merged over the sanitized process env). */
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
};

export type ParsedRepoUrl = { owner: string; repo: string; cloneUrl: string; branch: string | null };

/** Env vars that pin git to another repository; hooks export them, so they must not leak in. */
const REPO_PINNING_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
];

/** Process env with repo-pinning vars removed, no system config and no interactive prompts. */
export function gitEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of REPO_PINNING_VARS) delete env[name];
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_TERMINAL_PROMPT = "0";
  return { ...env, ...extra };
}

/**
 * `/tree/<branch>` takes the whole rest of the path, since branch names may contain `/`
 * (`/tree/feature/fix` → `feature/fix`); `/blob/<branch>` keeps one segment.
 */
const GITHUB_RE =
  /^(?:https?:\/\/|git@|ssh:\/\/git@)(?:www\.)?github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/tree\/([^\s?#]+?)|\/blob\/([^/\s?#]+))?\/?$/i;
const SCP_RE = /^[\w.-]+@[\w.-]+:(.+)$/;

/**
 * Conservative branch-name check, applied before git ever sees the name: no leading
 * `-` (option injection), only ref-safe characters, none of git's forbidden sequences.
 */
export function isSafeBranch(branch: string): boolean {
  return (
    /^[A-Za-z0-9._/][A-Za-z0-9._/-]*$/.test(branch) &&
    !branch.includes("..") &&
    !branch.includes("//") &&
    !branch.startsWith("/") &&
    !branch.endsWith("/") &&
    !branch.endsWith(".") &&
    !branch.endsWith(".lock")
  );
}

function stripGit(name: string): string {
  return name.replace(/\.git$/i, "");
}

/** Split a path-like string into its last two segments: `[owner, repo]`. */
function ownerRepoFromPath(path: string): [string, string] {
  const trimmed = path.replace(/\/+$/, "");
  const repo = stripGit(basename(trimmed));
  const owner = basename(dirname(trimmed));
  return [owner, repo];
}

/**
 * Parse owner/repo from a GitHub https/ssh URL, any other `scheme://host/o/r(.git)`
 * or scp-like `user@host:o/r.git`, a `file://` URL or a local path (owner = parent
 * dir name). Local paths are cloned via `file://` because git ignores `--depth`
 * for plain paths.
 */
export function parseRepoUrl(url: string): ParsedRepoUrl {
  const input = url.trim();
  const gh = GITHUB_RE.exec(input);
  if (gh) {
    const [, owner, repo, treeBranch, blobBranch] = gh;
    const branch = treeBranch ?? blobBranch;
    if (branch !== undefined && !isSafeBranch(branch)) throw new Error(`unsafe branch name in repo URL: ${url}`);
    return { owner, repo, cloneUrl: `https://github.com/${owner}/${repo}.git`, branch: branch ?? null };
  }

  let owner = "";
  let repo = "";
  let cloneUrl = input;
  if (/^file:\/\//i.test(input)) {
    [owner, repo] = ownerRepoFromPath(fileURLToPath(input));
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    [owner, repo] = ownerRepoFromPath(new URL(input).pathname);
  } else if (SCP_RE.test(input) && !isAbsolute(input)) {
    [owner, repo] = ownerRepoFromPath(SCP_RE.exec(input)![1]);
  } else {
    const local = resolve(input);
    if (!existsSync(local)) throw new Error(`not a recognizable repo URL or path: ${url}`);
    [owner, repo] = ownerRepoFromPath(local);
    cloneUrl = pathToFileURL(local).href;
  }
  if (!owner || !repo || owner === "/" || owner === ".") {
    throw new Error(`cannot derive owner/repo from: ${url}`);
  }
  return { owner, repo, cloneUrl, branch: null };
}

/** Filesystem-safe, deterministic `<owner>-<repo>` dir name. */
export function cloneDirName(owner: string, repo: string): string {
  const safe = (s: string) =>
    s
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^[-.]+|-+$/g, "")
      .toLowerCase();
  return `${safe(owner)}-${safe(repo)}`;
}

async function git(args: string[], cwd: string, options: CloneRepoOptions): Promise<string> {
  const { stdout } = await run("git", args, {
    cwd,
    env: gitEnv(options.env),
    timeout: options.timeoutMs ?? GIT_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

/** True only when `dir` is itself the top level of a git work tree (never a parent repo). */
async function isOwnClone(dir: string, options: CloneRepoOptions): Promise<boolean> {
  if (!existsSync(join(dir, ".git")) || !statSync(join(dir, ".git")).isDirectory()) return false;
  try {
    const top = await git(["rev-parse", "--show-toplevel"], dir, options);
    return realpathSync(top) === realpathSync(dir);
  } catch {
    return false;
  }
}

/** The clone's `origin` URL, or null when it cannot be read. */
async function originUrl(dir: string, options: CloneRepoOptions): Promise<string | null> {
  try {
    return await git(["remote", "get-url", "origin"], dir, options);
  } catch {
    return null;
  }
}

async function freshClone(parsed: ParsedRepoUrl, target: string, options: CloneRepoOptions): Promise<void> {
  const args = ["clone", "--depth", "1", "--quiet"];
  if (parsed.branch) args.push("--branch", parsed.branch);
  args.push("--", parsed.cloneUrl, target);
  await git(args, dirname(target), options);
}

async function refresh(parsed: ParsedRepoUrl, target: string, options: CloneRepoOptions): Promise<void> {
  const branch = parsed.branch ?? (await git(["rev-parse", "--abbrev-ref", "HEAD"], target, options));
  if (!isSafeBranch(branch)) throw new Error(`unsafe branch name: ${branch}`);
  // `--` ends option parsing, so neither remote nor refspec can be read as a flag.
  await git(["fetch", "--depth", "1", "--quiet", "--", "origin", branch], target, options);
  await git(["reset", "--hard", "--quiet", "FETCH_HEAD"], target, options);
}

/** Create `wiki/raw/repos/` (containment-checked) with its catch-all `.gitignore`. */
function ensureReposDir(projectDir: string): string {
  const reposDir = ensureContainedDir(projectDir, ["wiki", "raw", "repos"]);
  const ignore = join(reposDir, ".gitignore");
  if (!existsSync(ignore)) {
    writeFileSync(ignore, "# Shallow clones are a regenerable cache with their own .git — never commit them.\n*\n");
  }
  return reposDir;
}

/** Clone `url` (shallow) into the project's wiki raw layer, or refresh an existing clone. */
export async function cloneRepo(projectDir: string, url: string, options: CloneRepoOptions = {}): Promise<CloneReceipt> {
  const parsed = parseRepoUrl(url);
  const reposDir = ensureReposDir(projectDir);
  const clonePath = `raw/repos/${cloneDirName(parsed.owner, parsed.repo)}`;
  const target = join(projectDir, "wiki", clonePath);
  // Every rm below is confined to a direct child of raw/repos/.
  const rel = relative(reposDir, target);
  if (!rel || rel.startsWith("..") || rel.includes(sep)) throw new Error(`clone path escapes raw/repos: ${clonePath}`);
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
    throw new Error(`refusing a symlinked clone dir: ${clonePath}`);
  }

  let action: CloneReceipt["action"];
  // Different sources can map to one dir name (case, host, a-b/c vs a/b-c): only
  // refresh a clone whose origin is exactly the requested URL, otherwise re-clone.
  if ((await isOwnClone(target, options)) && (await originUrl(target, options)) === parsed.cloneUrl) {
    try {
      await refresh(parsed, target, options);
      action = "refreshed";
    } catch {
      // A broken or diverged cache is safe to drop: re-clone from scratch.
      rmSync(target, { recursive: true, force: true });
      await freshClone(parsed, target, options);
      action = "cloned";
    }
  } else {
    // Leftover non-clone content would make `git clone` refuse the target.
    rmSync(target, { recursive: true, force: true });
    await freshClone(parsed, target, options);
    action = "cloned";
  }

  const commitSha = await git(["rev-parse", "HEAD"], target, options);
  return { clonePath, commitSha, action };
}
