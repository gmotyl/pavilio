import { Router, type Response } from "express";
import { execFile, execSync } from "child_process";
import { promisify } from "util";
import { lstatSync, readFileSync, realpathSync, statSync } from "fs";
import { isAbsolute, join, posix, relative, resolve, sep } from "path";
import { getConfig } from "../config.js";
import { broadcast } from "../watcher.js";
import { gitSafeEnv } from "../lib/gitEnv.js";
import { expandHome } from "../lib/paths.js";

const router = Router();

function quoteShellArg(value: string): string {
  return `"${value.replace(/["\\$`]/g, "\\$&")}"`;
}

/**
 * The repository directory does not exist on this machine (e.g. a linked repo
 * registered on another host). Thrown before git is spawned, so callers never
 * see a raw `spawnSync /bin/sh ENOENT`.
 */
export class RepoMissingError extends Error {
  readonly code = "repo-missing";
  constructor(readonly path: string) {
    super(`Repository not on this machine: ${path}`);
    this.name = "RepoMissingError";
  }
}

function getRepoRoot(customRepo?: string): string {
  if (customRepo) return resolve(expandHome(customRepo));
  const { projectsDir } = getConfig();
  return resolve(projectsDir, "..");
}

/**
 * Throw RepoMissingError when `path` is not a directory on this machine. Only
 * "nothing there" (ENOENT, ENOTDIR, or an entry that is not a directory) counts
 * as missing; any other stat failure (EACCES, ELOOP, ...) is rethrown so it
 * surfaces as a plain 500 with its real message.
 */
function assertRepoDirectory(path: string): void {
  let isDir: boolean;
  try {
    isDir = statSync(path).isDirectory();
  } catch (e: any) {
    if (e?.code === "ENOENT" || e?.code === "ENOTDIR") throw new RepoMissingError(path);
    throw e;
  }
  if (!isDir) throw new RepoMissingError(path);
}

function git(cmd: string, repoPath?: string): string {
  const cwd = getRepoRoot(repoPath);
  // Check before spawning: execSync with a missing cwd fails as an opaque ENOENT.
  assertRepoDirectory(cwd);
  return execSync(`git ${cmd}`, {
    cwd,
    // Without this an inherited GIT_DIR would win over cwd and these reads would
    // describe someone else's repository. See lib/gitEnv.ts.
    env: gitSafeEnv(),
    encoding: "utf-8",
  });
}

/** A caller-supplied ref or path that is invalid or unsafe; answered as `status`. */
class GitInputError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Answer a route failure: 404 repo-missing for a missing repo, else `status` with the message. */
function sendGitError(res: Response, e: any, status = 500): void {
  if (e instanceof GitInputError) {
    res.status(e.status).json({ error: e.message });
    return;
  }
  if (e instanceof RepoMissingError) {
    res
      .status(404)
      .json({ code: e.code, path: e.path, error: e.message });
    return;
  }
  res.status(status).json({ error: e?.message ?? String(e) });
}

function gitDiffOutput(cmd: string, repoPath?: string): string {
  try {
    return git(cmd, repoPath);
  } catch (e: any) {
    if (e instanceof RepoMissingError) throw e;
    const stdout = e.stdout?.toString?.() ?? "";
    if (stdout) return stdout;
    throw e;
  }
}

function getWorkingTreeDiff(file: string, repo?: string): string {
  const quotedFile = quoteShellArg(file);
  const diff = git(`diff -- ${quotedFile}`, repo);
  if (diff.trim()) return diff;

  const status = git(`status --porcelain -- ${quotedFile}`, repo)
    .split("\n")
    .find(Boolean)
    ?.slice(0, 2)
    .trim();

  if (status === "??") {
    // Read the file directly and synthesize an add-diff. Avoids the
    // `git diff --no-index` argument-parsing quirks and works the same
    // whether the file is text or otherwise — DiffView falls back
    // gracefully for binary content. If the read fails, fall back to
    // git diff --no-index so the user at least gets git's "Binary files
    // differ" message rather than a 500.
    try {
      const abs = join(getRepoRoot(repo), file);
      const content = readFileSync(abs, "utf-8");
      return synthesizeAddDiff(file, content);
    } catch (e) {
      if (e instanceof RepoMissingError) throw e;
      return gitDiffOutput(`diff --no-index -- /dev/null ${quotedFile}`, repo);
    }
  }

  if (status?.includes("A")) {
    return git(`diff --cached -- ${quotedFile}`, repo);
  }

  return diff;
}

export function synthesizeAddDiff(file: string, content: string): string {
  const lines = content.split("\n");
  // A trailing newline produces an empty last element; don't count it in the
  // hunk header but keep the "\ No newline at end of file" convention off —
  // DiffView doesn't need it and it'd just add noise.
  const hasTrailingNewline =
    lines.length > 0 && lines[lines.length - 1] === "";
  const bodyLines = hasTrailingNewline ? lines.slice(0, -1) : lines;
  const count = bodyLines.length;
  const header =
    `diff --git a/${file} b/${file}\n` +
    `new file mode 100644\n` +
    `--- /dev/null\n` +
    `+++ b/${file}\n` +
    `@@ -0,0 +1,${count} @@\n`;
  return header + bodyLines.map((l) => `+${l}`).join("\n");
}

function getBranchDiff(base: string, file: string, repo?: string): string {
  const quotedFile = quoteShellArg(file);
  const diff = git(`diff ${base}...HEAD -- ${quotedFile}`, repo);
  if (diff.trim()) return diff;

  // Empty diff can happen for added files (some git configs + path quirks),
  // renames without content change, or identical content across the branch
  // boundary that still appears in --name-status. Fall back to synthesizing
  // an add-diff from the file's HEAD blob so the viewer shows something
  // meaningful instead of "No changes".
  try {
    const content = git(`show HEAD:${quotedFile}`, repo);
    if (content.length > 0) return synthesizeAddDiff(file, content);
  } catch (e) {
    if (e instanceof RepoMissingError) throw e;
    // file may not exist at HEAD (deleted) — fall through
  }

  return diff;
}

// --- Ref-based reads (argv, no shell: refs and paths come straight from the query) ---

// PR trees and diffs can be large; execFile's 1 MiB default would truncate them.
const REF_MAX_BUFFER = 256 * 1024 * 1024;
const REF_TIMEOUT_MS = 30_000;
const execFileAsync = promisify(execFile);

function refReadEnv(): NodeJS.ProcessEnv {
  return {
    ...gitSafeEnv(),
    // Query paths are file names, never globs or `:(exclude)` magic.
    GIT_LITERAL_PATHSPECS: "1",
    // Reads must not take index.lock (status would refresh the index).
    GIT_OPTIONAL_LOCKS: "0",
  };
}

async function gitArgv(args: string[], cwd: string): Promise<Buffer> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: refReadEnv(),
    encoding: "buffer",
    maxBuffer: REF_MAX_BUFFER,
    timeout: REF_TIMEOUT_MS,
  });
  return stdout;
}

/** git ran and exited non-zero; timeouts, maxBuffer overflow and spawn failures (no git) are not that. */
function gitExitedNonZero(e: any): boolean {
  return !e?.killed && typeof e?.code === "number";
}

/** The repo's top-level dir; every path below is relative to it, whatever subdir `repo` named. */
async function repoToplevel(repo?: string): Promise<string> {
  const dir = getRepoRoot(repo);
  assertRepoDirectory(dir);
  try {
    return (await gitArgv(["rev-parse", "--show-toplevel"], dir)).toString("utf-8").trim();
  } catch (e) {
    if (!gitExitedNonZero(e)) throw e;
    throw new GitInputError(`not a git working tree: ${dir}`);
  }
}

function queryString(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

function requireQuery(v: unknown, name: string): string {
  const s = queryString(v);
  if (s === undefined) throw new GitInputError(`${name} parameter required`);
  return s;
}

/** Resolve a ref to a commit sha; a leading `-` would be parsed as an option. */
async function resolveCommit(ref: string, root: string): Promise<string> {
  if (ref.startsWith("-") || ref.includes("\0")) throw new GitInputError(`invalid ref: ${ref}`);
  try {
    return (await gitArgv(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], root)).toString("utf-8").trim();
  } catch (e) {
    if (!gitExitedNonZero(e)) throw e;
    throw new GitInputError(`unknown ref: ${ref}`);
  }
}

/** base...head as an explicit merge base, so unrelated histories answer 400 rather than 500. */
async function mergeBase(base: string, head: string, root: string): Promise<string> {
  try {
    return (await gitArgv(["merge-base", base, head], root)).toString("utf-8").trim();
  } catch (e: any) {
    if (e?.code === 1) throw new GitInputError("base and head have no merge base");
    throw e;
  }
}

/** Repo-relative POSIX path, or 400 when absolute, escaping the repo, or inside `.git`. */
function repoRelativePath(raw: string): string {
  if (raw.includes("\0") || isAbsolute(raw) || posix.isAbsolute(raw)) throw new GitInputError("path must be repo-relative");
  const norm = posix.normalize(raw.replace(/\\/g, "/"));
  if (norm === "." || norm === ".." || norm.startsWith("../")) throw new GitInputError("path escapes the repo");
  // Case-insensitive: `.GIT` is the same dir on macOS/Windows filesystems.
  if (norm.split("/").some((seg) => seg.toLowerCase() === ".git")) throw new GitInputError("path is inside .git");
  return norm;
}

function splitZ(buf: Buffer): string[] {
  const parts = buf.toString("utf-8").split("\0");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
}

// Same heuristic as git: a NUL in the first 8000 bytes means binary.
function isBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0);
}

function sendText(res: Response, buf: Buffer): void {
  if (isBinary(buf)) {
    res.status(415).json({ error: "binary file", binary: true });
    return;
  }
  res.type("text/plain; charset=utf-8").send(buf.toString("utf-8"));
}

type TreeStatus = "M" | "A" | "D" | "R" | "?" | null;

function porcelainStatus(xy: string): TreeStatus {
  if (xy === "??") return "?";
  if (xy.includes("D")) return "D";
  if (xy.includes("R")) return "R";
  if (xy.includes("A")) return "A";
  return xy.trim() ? "M" : null;
}

// git's well-known empty tree: the base for a repo with no commits yet.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** HEAD's commit, or the empty tree while HEAD is unborn. */
async function headOrEmptyTree(root: string): Promise<string> {
  try {
    return (await gitArgv(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], root)).toString("utf-8").trim();
  } catch (e) {
    if (!gitExitedNonZero(e)) throw e;
    return EMPTY_TREE;
  }
}

type Counts = { add: number; del: number };

/** `git diff -z -M --numstat` output keyed by (destination) path; binary counts as 0/0. */
function parseNumstat(buf: Buffer): Map<string, Counts> {
  const counts = new Map<string, Counts>();
  const num = splitZ(buf);
  for (let i = 0; i < num.length; ) {
    const [add, del, path] = num[i++].split("\t");
    // Rename: empty path field, then source and destination entries.
    const key = path === "" ? (i++, num[i++]) : path;
    counts.set(key, { add: Number(add) || 0, del: Number(del) || 0 });
  }
  return counts;
}

// Untracked files are counted from disk only when small enough to read on every listing.
const UNTRACKED_COUNT_MAX_BYTES = 64 * 1024;

function untrackedCounts(root: string, path: string): Counts | undefined {
  try {
    const abs = join(root, path);
    const st = lstatSync(abs);
    if (!st.isFile() || st.size > UNTRACKED_COUNT_MAX_BYTES) return undefined;
    const buf = readFileSync(abs);
    if (isBinary(buf)) return { add: 0, del: 0 };
    const text = buf.toString("utf-8");
    const lines = text.split("\n").length - (text.endsWith("\n") || text === "" ? 1 : 0);
    return { add: lines, del: 0 };
  } catch {
    return undefined;
  }
}

type TreeEntry = { path: string; status: TreeStatus } & Partial<Counts>;

async function workingTreeFiles(root: string): Promise<TreeEntry[]> {
  const status = new Map<string, TreeStatus>();
  const entries = splitZ(await gitArgv(["status", "--porcelain=v1", "-z", "-uall"], root));
  for (let i = 0; i < entries.length; i++) {
    const xy = entries[i].slice(0, 2);
    status.set(entries[i].slice(3), porcelainStatus(xy));
    // -z renames/copies (either column) carry the source path as the next entry.
    if (xy.includes("R") || xy.includes("C")) i++;
  }
  // -c keeps unstaged deletions listed; staged ones only come from status.
  const paths = new Set(splitZ(await gitArgv(["ls-files", "-z", "-co", "--exclude-standard"], root)));
  for (const p of status.keys()) paths.add(p);
  const counts = status.size
    ? parseNumstat(await gitArgv(["diff", "-z", "-M", "--numstat", await headOrEmptyTree(root)], root))
    : new Map<string, Counts>();
  return [...paths].sort().map((path) => {
    const st = status.get(path) ?? null;
    if (!st) return { path, status: st };
    const c = st === "?" ? untrackedCounts(root, path) : (counts.get(path) ?? { add: 0, del: 0 });
    return c ? { path, status: st, ...c } : { path, status: st };
  });
}

// Files at a ref, or the working tree (incl. untracked, .gitignore honoured) with status
router.get("/tree", async (req, res) => {
  try {
    const root = await repoToplevel(queryString(req.query.repo));
    const ref = queryString(req.query.ref);
    if (!ref) return res.json({ files: await workingTreeFiles(root) });
    const sha = await resolveCommit(ref, root);
    const files = splitZ(await gitArgv(["ls-tree", "-r", "-z", "--name-only", sha], root)).map((path) => ({
      path,
      status: null,
    }));
    res.json({ files });
  } catch (e: any) {
    sendGitError(res, e);
  }
});

// File content at a ref, or from disk; binary answers 415
router.get("/file", async (req, res) => {
  try {
    const path = repoRelativePath(requireQuery(req.query.path, "path"));
    const root = await repoToplevel(queryString(req.query.repo));
    const ref = queryString(req.query.ref);
    if (ref) {
      const sha = await resolveCommit(ref, root);
      let buf: Buffer;
      try {
        // cat-file blob: raw bytes (no textconv), and a tree is not a blob.
        buf = await gitArgv(["cat-file", "blob", `${sha}:${path}`], root);
      } catch (e) {
        if (!gitExitedNonZero(e)) throw e;
        throw new GitInputError(`${path} not found at ${ref}`, 404);
      }
      return sendText(res, buf);
    }
    let real: string;
    try {
      real = realpathSync(join(root, path));
    } catch {
      throw new GitInputError(`${path} not found`, 404);
    }
    // A symlink inside the repo may still point outside it.
    const realRoot = realpathSync(root);
    if (!real.startsWith(realRoot + sep)) throw new GitInputError("path escapes the repo");
    // A committed symlink can still land inside .git.
    if (relative(realRoot, real).split(sep).some((seg) => seg.toLowerCase() === ".git")) {
      throw new GitInputError("path is inside .git");
    }
    if (!statSync(real).isFile()) throw new GitInputError(`${path} is not a file`, 404);
    sendText(res, readFileSync(real));
  } catch (e: any) {
    sendGitError(res, e);
  }
});

// Unified diff of one path, base...head (since divergence)
router.get("/diff-ref", async (req, res) => {
  try {
    const path = repoRelativePath(requireQuery(req.query.path, "path"));
    const root = await repoToplevel(queryString(req.query.repo));
    const base = await resolveCommit(requireQuery(req.query.base, "base"), root);
    const head = await resolveCommit(requireQuery(req.query.head, "head"), root);
    const from = await mergeBase(base, head, root);
    const diff = await gitArgv(["diff", "--no-color", "--no-ext-diff", from, head, "--", path], root);
    res.type("text/plain; charset=utf-8").send(diff.toString("utf-8"));
  } catch (e: any) {
    sendGitError(res, e);
  }
});

// Changed files base...head with name-status and numstat (binary counts as 0/0)
router.get("/changed", async (req, res) => {
  try {
    const root = await repoToplevel(queryString(req.query.repo));
    const base = await resolveCommit(requireQuery(req.query.base, "base"), root);
    const head = await resolveCommit(requireQuery(req.query.head, "head"), root);
    const from = await mergeBase(base, head, root);

    const files: { path: string; status: "M" | "A" | "D" | "R"; add: number; del: number }[] = [];
    const ns = splitZ(await gitArgv(["diff", "-z", "-M", "--name-status", from, head], root));
    for (let i = 0; i < ns.length; ) {
      const code = ns[i++].charAt(0);
      // Rename/copy: source then destination; the row is keyed by destination.
      const path = code === "R" || code === "C" ? (i++, ns[i++]) : ns[i++];
      const status = code === "A" || code === "D" || code === "R" ? code : "M";
      files.push({ path, status, add: 0, del: 0 });
    }

    const counts = parseNumstat(await gitArgv(["diff", "-z", "-M", "--numstat", from, head], root));
    for (const f of files) Object.assign(f, counts.get(f.path));
    res.json(files);
  } catch (e: any) {
    sendGitError(res, e);
  }
});

// Git status
router.get("/status", (req, res) => {
  try {
    const repo = req.query.repo as string | undefined;
    // -uall expands untracked directories into their individual files;
    // without it a new dir arrives as a single "?? dir/" entry.
    const status = git("status --porcelain -uall", repo);
    const files = status
      .split("\n")
      .filter(Boolean)
      .map((line) => ({
        status: line.slice(0, 2).trim(),
        path: line.slice(3),
      }));
    res.json(files);
  } catch (e: any) {
    sendGitError(res, e);
  }
});

/** Working tree vs HEAD (staged + unstaged); untracked files as a synthesized add. */
async function diffAgainstHead(file: string, repo?: string): Promise<string> {
  const path = repoRelativePath(file);
  const root = await repoToplevel(repo);
  const base = await headOrEmptyTree(root);
  const diff = (await gitArgv(["diff", "--no-color", "--no-ext-diff", base, "--", path], root)).toString("utf-8");
  if (diff.trim()) return diff;
  const status = (await gitArgv(["status", "--porcelain=v1", "-z", "--", path], root)).toString("utf-8");
  if (!status.startsWith("??")) return diff;
  // An untracked symlink may point outside the repo.
  const real = realpathSync(join(root, path));
  if (!real.startsWith(realpathSync(root) + sep)) throw new GitInputError("path escapes the repo");
  return synthesizeAddDiff(path, readFileSync(real, "utf-8"));
}

/** A commit's first parent, or the empty tree for a root commit. */
function commitParent(sha: string, repo?: string): string {
  try {
    git(`rev-parse --verify --quiet ${sha}^`, repo);
    return `${sha}^`;
  } catch {
    return EMPTY_TREE;
  }
}

// Diff for a specific file (working tree or specific commit); against=HEAD includes staged changes
router.get("/diff", async (req, res) => {
  try {
    const file = req.query.file as string;
    const sha = req.query.sha as string | undefined;
    const repo = req.query.repo as string | undefined;
    if (!file)
      return res.status(400).json({ error: "file parameter required" });
    const against = queryString(req.query.against);
    if (against !== undefined) {
      if (against !== "HEAD") throw new GitInputError("against must be HEAD");
      return res.json({ diff: await diffAgainstHead(file, repo) });
    }
    const quotedFile = quoteShellArg(file);
    const diff = sha
      ? git(`diff ${commitParent(sha, repo)} ${sha} -- ${quotedFile}`, repo)
      : getWorkingTreeDiff(file, repo);
    res.json({ diff });
  } catch (e: any) {
    sendGitError(res, e);
  }
});

// Commit log
router.get("/log", (req, res) => {
  try {
    const repo = req.query.repo as string | undefined;
    const limit = parseInt(req.query.limit as string) || 30;
    const raw = git(
      `log --format="%H%x1f%h%x1f%s%x1f%an%x1f%ai" -n ${limit}`,
      repo,
    );
    const commits = raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, shortSha, message, author, date] = line.split("\x1f");
        return { sha, shortSha, message, author, date };
      });
    res.json(commits);
  } catch (e: any) {
    sendGitError(res, e);
  }
});

// Files changed in a specific commit
router.get("/commit-files", (req, res) => {
  try {
    const sha = req.query.sha as string;
    const repo = req.query.repo as string | undefined;
    if (!sha) return res.status(400).json({ error: "sha parameter required" });
    const raw = git(`diff-tree --root --no-commit-id -r --name-status ${sha}`, repo);
    const files = raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [status, ...pathParts] = line.split("\t");
        return { status: status.charAt(0), path: pathParts.join("\t") };
      });
    res.json(files);
  } catch (e: any) {
    sendGitError(res, e);
  }
});

// Stage files
router.post("/stage", (req, res) => {
  try {
    const { files, repo } = req.body;
    if (!Array.isArray(files))
      return res.status(400).json({ error: "files array required" });
    // Checked once up front: an empty batch spawns no git, yet a missing repo
    // must still answer repo-missing rather than "staged: 0".
    assertRepoDirectory(getRepoRoot(repo));
    for (const f of files) {
      git(`add "${f}"`, repo);
    }
    res.json({ ok: true, staged: files.length });
  } catch (e: any) {
    sendGitError(res, e);
  }
});

// Commit
router.post("/commit", (req, res) => {
  try {
    const { message, repo } = req.body;
    if (!message) return res.status(400).json({ error: "message required" });
    const safe = message.replace(/"/g, '\\"');
    git(`commit -m "${safe}"`, repo);
    broadcast({ type: "git-change" });
    res.json({ ok: true });
  } catch (e: any) {
    sendGitError(res, e);
  }
});

// Push
router.post("/push", (req, res) => {
  try {
    const { repo } = req.body || {};
    git("push", repo);
    broadcast({ type: "git-change" });
    res.json({ ok: true });
  } catch (e: any) {
    sendGitError(res, e);
  }
});

// Branch info
router.get("/branch", (req, res) => {
  try {
    const repo = req.query.repo as string | undefined;
    const branch = git("rev-parse --abbrev-ref HEAD", repo).trim();
    res.json({ branch });
  } catch (e: any) {
    sendGitError(res, e);
  }
});

// Grep within repo files — scoped to specific paths
router.get("/grep", (req, res) => {
  try {
    const q = req.query.q as string;
    const repo = req.query.repo as string | undefined;
    const filesParam = req.query.files as string | undefined; // comma-separated paths
    if (!q) return res.status(400).json({ error: "q parameter required" });
    const safeQ = q.replace(/"/g, '\\"');
    const fileArgs = filesParam
      ? filesParam
          .split(",")
          .map((f) => `"${f.replace(/"/g, '\\"')}"`)
          .join(" ")
      : "";
    const cmd = fileArgs
      ? `grep -rn --color=never "${safeQ}" -- ${fileArgs}`
      : `grep -rn --color=never "${safeQ}"`;
    let raw = "";
    try {
      raw = git(cmd, repo);
    } catch (e: any) {
      // git grep returns exit 1 when no matches — that's fine
      if (e.status === 1) {
        res.json([]);
        return;
      }
      throw e;
    }
    // Parse: file:line:text
    const byFile = new Map<string, { line: number; text: string }[]>();
    for (const line of raw.split("\n").filter(Boolean)) {
      const m = line.match(/^(.+?):(\d+):(.*)$/);
      if (!m) continue;
      const [, path, lineNum, text] = m;
      if (!byFile.has(path)) byFile.set(path, []);
      const matches = byFile.get(path)!;
      if (matches.length < 3)
        matches.push({ line: +lineNum, text: text.trim() });
    }
    const results = [...byFile.entries()]
      .slice(0, 50)
      .map(([path, matches]) => ({
        relativePath: path,
        project: "",
        matches,
      }));
    res.json(results);
  } catch (e: any) {
    sendGitError(res, e);
  }
});

// Checkout branch
router.post("/checkout", (req, res) => {
  const { branch, repo } = req.body ?? {};
  if (!branch)
    return res.status(400).json({ error: "branch parameter required" });
  // Check the repo before the checkout try: a missing repo is a 404 and any
  // other stat failure (EACCES, ELOOP) a 500, never a 409 checkout conflict.
  try {
    assertRepoDirectory(getRepoRoot(repo));
  } catch (e: any) {
    return sendGitError(res, e);
  }
  try {
    const safe = branch.replace(/[;&|`$]/g, "");
    const output = git(`checkout "${safe}"`, repo);
    const current = git("rev-parse --abbrev-ref HEAD", repo).trim();
    broadcast({ type: "git-change" });
    res.json({ ok: true, branch: current, output: output.trim() });
  } catch (e: any) {
    if (e instanceof RepoMissingError) return sendGitError(res, e);
    // Git checkout errors (uncommitted changes, etc.) — return the stderr message
    const msg = e.stderr?.toString() || e.message || "Checkout failed";
    res.status(409).json({ error: msg.trim() });
  }
});

// List worktrees
router.get("/worktrees", (req, res) => {
  try {
    const repo = req.query.repo as string | undefined;
    const raw = git("worktree list --porcelain", repo);
    // Parse porcelain output into [{path, head, branch}]
    const worktrees: { path: string; head: string; branch: string | null }[] = [];
    let current: Partial<{ path: string; head: string; branch: string | null }> = {};
    for (const line of raw.split("\n")) {
      if (line.startsWith("worktree ")) {
        if (current.path) worktrees.push({ path: current.path, head: current.head ?? "", branch: current.branch ?? null });
        current = { path: line.slice("worktree ".length).trim() };
      } else if (line.startsWith("HEAD ")) {
        current.head = line.slice("HEAD ".length).trim();
      } else if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length).trim();
        if (ref.startsWith("refs/heads/")) {
          current.branch = ref.slice("refs/heads/".length);
        } else if (ref.startsWith("refs/remotes/")) {
          current.branch = ref.slice("refs/remotes/".length);
        } else {
          current.branch = ref || null;
        }
      } else if (line.trim() === "detached") {
        current.branch = null;
      }
    }
    if (current.path) worktrees.push({ path: current.path, head: current.head ?? "", branch: current.branch ?? null });
    res.json(worktrees);
  } catch (e: any) {
    sendGitError(res, e);
  }
});

// List branches
router.get("/branches", (req, res) => {
  try {
    const repo = req.query.repo as string | undefined;
    const raw = git("branch -a --format='%(refname:short)'", repo);
    const branches = raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((b) => b.trim());
    const current = git("rev-parse --abbrev-ref HEAD", repo).trim();
    res.json({ current, branches });
  } catch (e: any) {
    sendGitError(res, e);
  }
});

// Files changed between base branch and HEAD (three-dot diff = since divergence)
router.get("/branch-diff-files", (req, res) => {
  try {
    const base = req.query.base as string;
    const repo = req.query.repo as string | undefined;
    if (!base)
      return res.status(400).json({ error: "base parameter required" });
    const raw = git(`diff --name-status ${base}...HEAD`, repo);
    const files = raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [status, ...pathParts] = line.split("\t");
        return { status: status.charAt(0), path: pathParts.join("\t") };
      });
    // Also get commit count ahead
    let commitsAhead = 0;
    try {
      commitsAhead =
        parseInt(git(`rev-list --count ${base}..HEAD`, repo).trim()) || 0;
    } catch (e) {
      if (e instanceof RepoMissingError) throw e;
    }
    res.json({ files, commitsAhead });
  } catch (e: any) {
    sendGitError(res, e);
  }
});

// Diff for a specific file between branches
router.get("/branch-diff", (req, res) => {
  try {
    const file = req.query.file as string;
    const base = req.query.base as string;
    const repo = req.query.repo as string | undefined;
    if (!file)
      return res.status(400).json({ error: "file parameter required" });
    if (!base)
      return res.status(400).json({ error: "base parameter required" });
    const diff = getBranchDiff(base, file, repo);
    res.json({ diff });
  } catch (e: any) {
    sendGitError(res, e);
  }
});

// Suggest commit message based on changed files
router.get("/suggest-message", (req, res) => {
  try {
    const repo = req.query.repo as string | undefined;
    const status = git("status --porcelain -uall", repo);
    const files = status
      .split("\n")
      .filter(Boolean)
      .map((l) => l.slice(3));

    // Detect projects from file paths (files are like "projects/my-project/notes/...")
    const projects = [
      ...new Set(
        files
          .filter((f) => f.startsWith("projects/"))
          .map((f) => f.split("/")[1])
          .filter(Boolean),
      ),
    ];

    // Detect types
    const types = [
      ...new Set(
        files.map((f) => {
          if (f.includes("/notes/")) return "note";
          if (f.includes("/progress/")) return "progress";
          if (f.includes("/plans/")) return "plan";
          if (f.includes("/memo/")) return "memo";
          return "update";
        }),
      ),
    ];

    const type = types.length === 1 ? types[0] : "update";
    const project =
      projects.length === 1
        ? projects[0]
        : projects.length > 0
          ? projects.join("+")
          : "workspace";

    res.json({ suggestion: `${type}(${project}): ` });
  } catch (e: any) {
    sendGitError(res, e);
  }
});

export default router;
