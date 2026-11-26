import { Router, type Response } from "express";
import { execFile, execSync } from "child_process";
import { promisify } from "util";
import { readFileSync, realpathSync, statSync } from "fs";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, rmdir } from "fs/promises";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "path";
import { getConfig } from "../config.js";
import { broadcast } from "../watcher.js";
import { isLiveProject, readLinkedRepos, readRepos } from "../lib/discovery.js";
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
    /** Machine-readable reason for a client that answers it differently. */
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Answer a route failure: 404 repo-missing for a missing repo, else `status` with the message. */
function sendGitError(res: Response, e: any, status = 500): void {
  if (e instanceof GitInputError) {
    res.status(e.status).json(e.code ? { error: e.message, code: e.code } : { error: e.message });
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
    // whether the file is text or otherwise — the file viewer falls back
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
  // the file viewer doesn't need it and it'd just add noise.
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

async function gitArgv(args: string[], cwd: string, timeout = REF_TIMEOUT_MS): Promise<Buffer> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: refReadEnv(),
    encoding: "buffer",
    maxBuffer: REF_MAX_BUFFER,
    timeout,
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
    // Also what a shallow clone missing the shared history answers.
    if (e?.code === 1) throw new GitInputError("base and head have no merge base", 400, "no-merge-base");
    throw e;
  }
}

/** Repo-relative POSIX path, or 400 when absolute, escaping the repo, or inside `.git`. */
function repoRelativePath(raw: string): string {
  if (raw.includes("\0") || isAbsolute(raw) || posix.isAbsolute(raw)) throw new GitInputError("path must be repo-relative");
  // A backslash is a separator only on Windows; on POSIX it is a filename character.
  const norm = posix.normalize(sep === "\\" ? raw.replace(/\\/g, "/") : raw);
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

// The viewer renders whole files; past this a read would stall the browser.
const FILE_READ_MAX_BYTES = 2 * 1024 * 1024;

function sendTooLarge(res: Response, size: number): void {
  res.status(413).json({ error: "file too large", tooLarge: true, size });
}

/** Realpath of an on-disk repo file, or 400 when it lands outside the repo or inside `.git`. */
function realInRepo(root: string, path: string): string {
  let real: string;
  try {
    real = realpathSync(join(root, path));
  } catch (e: any) {
    if (e?.code === "ENOENT") throw new GitInputError(`${path} not found`, 404);
    throw e;
  }
  // A symlink inside the repo may still point outside it, or into .git.
  const realRoot = realpathSync(root);
  if (!real.startsWith(realRoot + sep)) throw new GitInputError("path escapes the repo");
  if (relative(realRoot, real).split(sep).some((seg) => seg.toLowerCase() === ".git")) {
    throw new GitInputError("path is inside .git");
  }
  return real;
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
  // Unmerged (UD/DU/AU/UA/UU/AA) keeps a copy on disk; only DD is gone from both sides.
  if (xy === "DD") return "D";
  if (xy.includes("U") || xy === "AA") return "M";
  if (xy.includes("D")) return "D";
  if (xy.includes("R")) return "R";
  if (xy.includes("A")) return "A";
  return xy.trim() ? "M" : null;
}

// git's well-known empty tree per object format: the base for a repo with no commits yet.
const EMPTY_TREE_SHA1 = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const EMPTY_TREE_SHA256 = "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321";

async function emptyTree(root: string): Promise<string> {
  const format = (await gitArgv(["rev-parse", "--show-object-format"], root)).toString("utf-8").trim();
  return format === "sha256" ? EMPTY_TREE_SHA256 : EMPTY_TREE_SHA1;
}

/** HEAD's commit, or the empty tree while HEAD is unborn. */
async function headOrEmptyTree(root: string): Promise<string> {
  try {
    return (await gitArgv(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], root)).toString("utf-8").trim();
  } catch (e) {
    if (!gitExitedNonZero(e)) throw e;
    return emptyTree(root);
  }
}

type Counts = { add: number; del: number };

/** `git diff -z -M --numstat` output keyed by (destination) path; binary counts as 0/0. */
function parseNumstat(buf: Buffer): Map<string, Counts> {
  const counts = new Map<string, Counts>();
  const num = splitZ(buf);
  for (let i = 0; i < num.length; ) {
    // Only the first two tabs separate fields; the path may itself hold tabs.
    const [, add, del, path] = /^([^\t]*)\t([^\t]*)\t([\s\S]*)$/.exec(num[i++]) ?? [];
    // Rename: empty path field, then source and destination entries.
    const key = path === "" ? (i++, num[i++]) : path;
    counts.set(key, { add: Number(add) || 0, del: Number(del) || 0 });
  }
  return counts;
}

// Untracked files are counted from disk only when small enough to read on every listing.
const UNTRACKED_COUNT_MAX_BYTES = 64 * 1024;
// Per listing: a tree full of generated files must not stall the request.
const UNTRACKED_COUNT_MAX_FILES = 500;
const UNTRACKED_COUNT_MAX_TOTAL = 4 * 1024 * 1024;

type CountBudget = { files: number; bytes: number; spent: boolean };

/** Line count of an untracked file, or undefined when unreadable, too big or past the budget. */
async function untrackedCounts(root: string, path: string, budget: CountBudget): Promise<Counts | undefined> {
  if (budget.spent) return undefined;
  if (budget.files >= UNTRACKED_COUNT_MAX_FILES) {
    budget.spent = true;
    return undefined;
  }
  budget.files++;
  try {
    const abs = join(root, path);
    const st = await lstat(abs);
    if (!st.isFile() || st.size > UNTRACKED_COUNT_MAX_BYTES) return undefined;
    if (budget.bytes + st.size > UNTRACKED_COUNT_MAX_TOTAL) {
      budget.spent = true;
      return undefined;
    }
    budget.bytes += st.size;
    const buf = await readFile(abs);
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
  const budget: CountBudget = { files: 0, bytes: 0, spent: false };
  const out: TreeEntry[] = [];
  // Sequential so the budget is spent in listing order.
  for (const path of [...paths].sort()) {
    const st = status.get(path) ?? null;
    if (!st) {
      out.push({ path, status: st });
      continue;
    }
    const c = st === "?" ? await untrackedCounts(root, path, budget) : (counts.get(path) ?? { add: 0, del: 0 });
    out.push(c ? { path, status: st, ...c } : { path, status: st });
  }
  return out;
}

// A ref pinned to its commit sha, so a multi-read view reads one fixed version
router.get("/resolve", async (req, res) => {
  try {
    const root = await repoToplevel(queryString(req.query.repo));
    res.json({ sha: await resolveCommit(requireQuery(req.query.ref, "ref"), root) });
  } catch (e: any) {
    sendGitError(res, e);
  }
});

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
      const object = `${sha}:${path}`;
      let size: number;
      try {
        // A tree is not a blob; size first so a huge blob is never buffered.
        if ((await gitArgv(["cat-file", "-t", object], root)).toString("utf-8").trim() !== "blob") throw new GitInputError(`${path} not found at ${ref}`, 404);
        size = Number((await gitArgv(["cat-file", "-s", object], root)).toString("utf-8").trim());
      } catch (e) {
        if (e instanceof GitInputError || !gitExitedNonZero(e)) throw e;
        throw new GitInputError(`${path} not found at ${ref}`, 404);
      }
      if (size > FILE_READ_MAX_BYTES) return sendTooLarge(res, size);
      // cat-file blob: raw bytes (no textconv).
      return sendText(res, await gitArgv(["cat-file", "blob", object], root));
    }
    let real: string;
    try {
      real = realInRepo(root, path);
    } catch (e) {
      // Any unreadable path (dangling link, permission) reads as missing.
      if (e instanceof GitInputError && e.status === 400) throw e;
      throw new GitInputError(`${path} not found`, 404);
    }
    const st = statSync(real);
    if (!st.isFile()) throw new GitInputError(`${path} is not a file`, 404);
    if (st.size > FILE_READ_MAX_BYTES) return sendTooLarge(res, st.size);
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
    res.type("text/plain; charset=utf-8").send(await pathDiff(root, path, [from, head]));
  } catch (e: any) {
    sendGitError(res, e);
  }
});

/** Where `path` was renamed from in `git diff -M <revs>`, if it was. */
async function renameSource(root: string, path: string, revs: string[]): Promise<string | undefined> {
  const ns = splitZ(await gitArgv(["diff", "-z", "-M", "--name-status", ...revs], root));
  for (let i = 0; i < ns.length; ) {
    const code = ns[i++].charAt(0);
    if (code !== "R" && code !== "C") {
      i++;
      continue;
    }
    const [src, dst] = [ns[i++], ns[i++]];
    if (code === "R" && dst === path) return src;
  }
  return undefined;
}

/**
 * Unified diff of one path over `revs`. A pathspec of just the destination hides
 * a rename's source from detection, so an added file is retried with its source.
 * Context is pinned at three lines (git's and GitHub's default): a user's
 * `diff.context` must not drop the unchanged lines review comments anchor to.
 */
async function pathDiff(root: string, path: string, revs: string[]): Promise<string> {
  const base = ["diff", "--no-color", "--no-ext-diff", "-M", "-U3", ...revs, "--"];
  const diff = (await gitArgv([...base, path], root)).toString("utf-8");
  if (!/^new file mode /m.test(diff)) return diff;
  const src = await renameSource(root, path, revs);
  return src ? (await gitArgv([...base, src, path], root)).toString("utf-8") : diff;
}

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
router.get("/status", async (req, res) => {
  try {
    const cwd = getRepoRoot(req.query.repo as string | undefined);
    assertRepoDirectory(cwd);
    // -uall expands untracked directories into their individual files;
    // without it a new dir arrives as a single "?? dir/" entry. -z gives
    // literal (unquoted) paths and the rename source as its own entry.
    const entries = splitZ(await gitArgv(["status", "--porcelain=v1", "-z", "-uall"], cwd));
    const files: { status: string; path: string; from?: string }[] = [];
    for (let i = 0; i < entries.length; i++) {
      const xy = entries[i].slice(0, 2);
      const file: { status: string; path: string; from?: string } = { status: xy.trim(), path: entries[i].slice(3) };
      if (xy.includes("R") || xy.includes("C")) file.from = entries[++i];
      files.push(file);
    }
    res.json(files);
  } catch (e: any) {
    sendGitError(res, e);
  }
});

// Larger untracked files get a marker instead of a synthesized diff.
const UNTRACKED_DIFF_MAX_BYTES = 1024 * 1024;

type HeadDiff = { diff: string; tooLarge?: true; size?: number; binary?: true };

/** Working tree vs HEAD (staged + unstaged); untracked files as a synthesized add. */
async function diffAgainstHead(file: string, repo?: string): Promise<HeadDiff> {
  const path = repoRelativePath(file);
  const root = await repoToplevel(repo);
  const base = await headOrEmptyTree(root);
  const diff = await pathDiff(root, path, [base]);
  if (diff.trim()) return { diff };
  // -uall: listing forces it too, so status.showUntrackedFiles=no must not hide the file here.
  const status = (await gitArgv(["status", "--porcelain=v1", "-z", "-uall", "--", path], root)).toString("utf-8");
  if (!status.startsWith("??")) return { diff };
  const real = realInRepo(root, path);
  const st = statSync(real);
  if (!st.isFile()) throw new GitInputError(`${path} is not a file`, 404);
  if (st.size > UNTRACKED_DIFF_MAX_BYTES) return { diff: "", tooLarge: true, size: st.size };
  const buf = readFileSync(real);
  if (isBinary(buf)) return { diff: "", binary: true };
  return { diff: synthesizeAddDiff(path, buf.toString("utf-8")) };
}

/**
 * A commit's first parent (merges diff against it), or the empty tree for a root
 * commit. A shallow boundary has a parent that is just not here: 409, never "added everything".
 */
async function commitParent(sha: string, root: string): Promise<string> {
  try {
    return (await gitArgv(["rev-parse", "--verify", "--quiet", `${sha}^1`], root)).toString("utf-8").trim();
  } catch (e) {
    if (!gitExitedNonZero(e)) throw e;
    const raw = (await gitArgv(["cat-file", "commit", sha], root)).toString("utf-8");
    const header = raw.slice(0, raw.indexOf("\n\n"));
    if (/^parent /m.test(header)) throw new GitInputError(`parent of ${sha} is not in this shallow clone`, 409);
    return emptyTree(root);
  }
}

// Diff for a specific file (working tree or specific commit); against=HEAD includes staged changes
router.get("/diff", async (req, res) => {
  try {
    const file = req.query.file as string;
    const sha = queryString(req.query.sha);
    const repo = req.query.repo as string | undefined;
    if (!file)
      return res.status(400).json({ error: "file parameter required" });
    const against = queryString(req.query.against);
    if (against !== undefined) {
      if (against !== "HEAD") throw new GitInputError("against must be HEAD");
      return res.json(await diffAgainstHead(file, repo));
    }
    if (sha === undefined) return res.json({ diff: getWorkingTreeDiff(file, repo) });
    const root = await repoToplevel(repo);
    const commit = await resolveCommit(sha, root);
    // Rename-aware, like /diff-ref: a renamed file is not shown as wholly added.
    res.json({ diff: await pathDiff(root, file, [await commitParent(commit, root), commit]) });
  } catch (e: any) {
    sendGitError(res, e);
  }
});

// Commit log
/** A git repository whose HEAD names no commit yet (before the first commit). */
function unbornHead(repo?: string): boolean {
  const ok = (cmd: string) => {
    try {
      git(cmd, repo);
      return true;
    } catch {
      return false;
    }
  };
  return ok("rev-parse --git-dir") && !ok("rev-parse --verify -q HEAD");
}

router.get("/log", (req, res) => {
  try {
    const repo = req.query.repo as string | undefined;
    const limit = parseInt(req.query.limit as string) || 30;
    let raw: string;
    try {
      raw = git(`log --format="%H%x1f%h%x1f%s%x1f%an%x1f%ai" -n ${limit}`, repo);
    } catch (e) {
      // Before the first commit HEAD is unborn: that's an empty history, not a failure.
      if (e instanceof RepoMissingError || !unbornHead(repo)) throw e;
      raw = "";
    }
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
router.get("/commit-files", async (req, res) => {
  try {
    const repo = req.query.repo as string | undefined;
    const root = await repoToplevel(repo);
    const sha = await resolveCommit(requireQuery(req.query.sha, "sha"), root);
    // Against the first parent, as /diff does: a merge lists what it brought in, not nothing.
    // -z: literal paths, not core.quotePath-escaped ones the blob/diff reads cannot open.
    const ns = splitZ(await gitArgv(["diff-tree", "-z", "-r", "--name-status", await commitParent(sha, root), sha], root));
    const files: { status: string; path: string }[] = [];
    for (let i = 0; i + 1 < ns.length; i += 2) files.push({ status: ns[i].charAt(0), path: ns[i + 1] });
    res.json(files);
  } catch (e: any) {
    sendGitError(res, e);
  }
});

// Writes run hooks (pre-commit, post-checkout) that may legitimately take long.
const WRITE_TIMEOUT_MS = 0;

// Stage files
router.post("/stage", async (req, res) => {
  try {
    const { files, repo } = req.body;
    if (!Array.isArray(files) || !files.every((f) => typeof f === "string" && f !== "" && !f.includes("\0")))
      return res.status(400).json({ error: "files array required" });
    // Checked once up front: an empty batch spawns no git, yet a missing repo
    // must still answer repo-missing rather than "staged: 0".
    const cwd = getRepoRoot(repo);
    assertRepoDirectory(cwd);
    // argv after `--`: names are never shell-parsed nor read as options.
    if (files.length) await gitArgv(["add", "--", ...files], cwd, WRITE_TIMEOUT_MS);
    res.json({ ok: true, staged: files.length });
  } catch (e: any) {
    sendGitError(res, e);
  }
});

// Commit
router.post("/commit", async (req, res) => {
  try {
    const { message, repo } = req.body;
    if (typeof message !== "string" || !message || message.includes("\0"))
      return res.status(400).json({ error: "message required" });
    const cwd = getRepoRoot(repo);
    assertRepoDirectory(cwd);
    await gitArgv(["commit", "-m", message], cwd, WRITE_TIMEOUT_MS);
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

const CLONE_TIMEOUT_MS = 10 * 60_000;
// Transports a linked repo may name; anything else (git://, ext::, …) is refused.
// Set in the child env too: an inherited GIT_ALLOW_PROTOCOL would otherwise override the -c allowlist.
const CLONE_PROTOCOLS = "https:ssh:file";
const CLONE_CONFIG = [
  "protocol.allow=never",
  ...CLONE_PROTOCOLS.split(":").map((p) => `protocol.${p}.allow=always`),
  // No tty to answer a host-key or passphrase prompt; GIT_SSH_COMMAND, when set, still wins.
  "core.sshCommand=ssh -o BatchMode=yes",
].flatMap((c) => ["-c", c]);
/** Targets with a clone running; a second request would race the existence check. */
const cloning = new Set<string>();

const exists = (p: string) => lstat(p).then(() => true, () => false);

/** Remove the now-empty dirs from `dir` up to `top` (the first dir this request made); stops at one still in use. */
async function pruneEmpty(dir: string, top: string, self: string): Promise<void> {
  for (let d = dir; d === top || d.startsWith(top + sep); d = dirname(d)) {
    // Another clone may have made `d` its parent and not staged into it yet.
    if ([...cloning].some((t) => t !== self && t.startsWith(d + sep))) return;
    if (!(await rmdir(d).then(() => true, () => false))) return;
  }
}

/**
 * Short client-safe causes, matched against whole stderr lines: the reason must sit where git
 * or ssh puts it (after the quoted remote or path), so words inside either cannot pose as one.
 */
const CLONE_CAUSES: [RegExp, string][] = [
  [/^fatal: transport '[^']*' not allowed$/, "transport not allowed"],
  [
    /^ssh: Could not resolve hostname [^\s:]+: |^ssh: connect to host \S+ port \d+: |^fatal: unable to access '.*': (Could not resolve host|Failed to connect|Couldn't connect|Connection timed out|Resolving timed out)/,
    "remote unreachable",
  ],
  [
    /^[^\s']+: Permission denied \(publickey|^fatal: Authentication failed for '.*'$|^fatal: could not read (Username|Password) for '.*': |^Host key verification failed\.$/,
    "authentication failed",
  ],
  [/^fatal: repository '.*' (not found|does not exist)$|^fatal: '.*' does not appear to be a git repository$|^(ERROR|remote): Repository not found\.?$/, "repository not found"],
];

function cloneCause(e: any): string | undefined {
  if (e?.killed) return "timed out";
  const lines = String(e?.stderr ?? "")
    .split(/\r?\n|\r/)
    .map((l) => l.trim());
  return CLONE_CAUSES.find(([re]) => lines.some((l) => re.test(l)))?.[1];
}

/**
 * Clone a linked repo that is missing here. The client names one repos.json entry by
 * `{ project, repo, path }`; URL and target both come from that single validated entry,
 * so no caller-chosen URL or path is cloned.
 */
router.post("/clone", async (req, res) => {
  try {
    const { project, repo, path } = req.body || {};
    if ([project, repo, path].some((v) => typeof v !== "string" || !v))
      return res.status(400).json({ error: "project, repo and path required" });
    const { projectsDir } = getConfig();
    if (!isLiveProject(projectsDir, project)) return res.status(404).json({ error: `unknown project: ${project}` });
    const hits = readLinkedRepos(join(projectsDir, project), project).filter((r) => r.entry.name === repo && r.entry.path === path);
    if (!hits.length) return res.status(404).json({ error: `${project} links no repo named ${repo} at ${path}` });
    if (hits.length > 1)
      return res.status(409).json({ code: "ambiguous-repo", error: `${project} links ${repo} at ${path} more than once` });
    const { remote } = hits[0];
    if (!remote) return res.status(409).json({ code: "no-remote", error: `${repo} has no remote in repos.json` });
    const target = resolve(expandHome(path));
    if (cloning.has(target))
      return res.status(409).json({ code: "clone-in-progress", path: target, error: `${target} is already being cloned` });
    // Reserved before the first await, so a concurrent request sees it.
    cloning.add(target);
    try {
      if (await exists(target))
        return res.status(409).json({ code: "target-exists", path: target, error: `${target} already exists` });
      const parent = dirname(target);
      // The first dir mkdir made, if any: pruned again (only while empty) when the clone fails.
      const created = await mkdir(parent, { recursive: true });
      // Cloned privately next to the target and renamed into place, so a failure never leaves a half-made checkout.
      let staging: string | undefined;
      let failure: { status: number; body: object } | undefined;
      // Which step threw: git itself (502) or this disk staging/publishing (500).
      let inGit = false;
      try {
        // Short fixed prefix: a target name near the 255-byte limit must still fit.
        staging = await mkdtemp(join(parent, ".pvc-"));
        // argv after `--`: the URL is never shell-parsed nor read as an option.
        inGit = true;
        await execFileAsync("git", [...CLONE_CONFIG, "clone", "--", remote, staging], {
          cwd: parent,
          env: { ...gitSafeEnv(), GIT_TERMINAL_PROMPT: "0", GIT_ALLOW_PROTOCOL: CLONE_PROTOCOLS },
          timeout: CLONE_TIMEOUT_MS,
        });
        inGit = false;
        if (await exists(target)) failure = { status: 409, body: { code: "target-exists", path: target, error: `${target} already exists` } };
        else {
          await rename(staging, target);
          staging = undefined;
        }
      } catch (e: any) {
        // Fixed facts only: git's output and argv may carry the remote's secrets.
        const cause = inGit ? cloneCause(e) : undefined;
        const status = typeof e?.code === "number" ? `exit ${e.code}` : e?.signal ? `signal ${e.signal}` : String(e?.code ?? "error");
        console.error(`[git] clone of ${project}/${repo} into ${target} failed in ${inGit ? "git" : "staging"}: ${status}, ${cause ?? "unclassified"}`);
        failure = inGit
          ? { status: 502, body: { error: cause ? `git clone failed: ${cause}` : "git clone failed — see server log" } }
          : { status: 500, body: { error: `clone could not be written to ${target}` } };
      }
      if (staging) await rm(staging, { recursive: true, force: true }).catch(() => {});
      if (failure) {
        if (created) await pruneEmpty(parent, created, target);
        return res.status(failure.status).json(failure.body);
      }
    } finally {
      cloning.delete(target);
    }
    broadcast({ type: "git-change" });
    // Repo presence changed; the checkout may sit outside the watched projects dir.
    broadcast({ type: "projects-change" });
    res.json({ ok: true, path: target });
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
router.get("/grep", async (req, res) => {
  try {
    const q = queryString(req.query.q);
    const repo = req.query.repo as string | undefined;
    const filesParam = queryString(req.query.files); // comma-separated paths
    if (!q) return res.status(400).json({ error: "q parameter required" });
    // Top-level, like /tree and /file: hit paths must open the same file for a subdirectory link.
    const cwd = await repoToplevel(repo);
    const files = filesParam ? filesParam.split(",").filter(Boolean) : [];
    // argv: `-e` keeps a leading `-` a pattern, `--` keeps names paths; no shell sees either.
    // --untracked: the tree lists non-ignored untracked files, so search them too (.gitignore honoured).
    const args = ["grep", "-rn", "-z", "--untracked", "--color=never", "-e", q, ...(files.length ? ["--", ...files] : [])];
    let raw = "";
    try {
      raw = (await gitArgv(args, cwd)).toString("utf-8");
    } catch (e: any) {
      // git grep exits 1 when nothing matches
      if (gitExitedNonZero(e) && e.code === 1) {
        res.json([]);
        return;
      }
      throw e;
    }
    // -z: `path\0line\0text`, path verbatim (no quoting, colons stay literal).
    const byFile = new Map<string, { line: number; text: string }[]>();
    for (const line of raw.split("\n").filter(Boolean)) {
      const [path, lineNum, ...rest] = line.split("\0");
      if (!path || !/^\d+$/.test(lineNum ?? "")) continue;
      const text = rest.join("\0");
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
router.post("/checkout", async (req, res) => {
  const { branch, repo } = req.body ?? {};
  if (typeof branch !== "string" || !branch)
    return res.status(400).json({ error: "branch parameter required" });
  // A leading `-` would be parsed as an option (e.g. --orphan).
  if (branch.startsWith("-") || branch.includes("\0"))
    return res.status(400).json({ error: `invalid branch: ${branch}` });
  // Check the repo before the checkout try: a missing repo is a 404 and any
  // other stat failure (EACCES, ELOOP) a 500, never a 409 checkout conflict.
  try {
    assertRepoDirectory(getRepoRoot(repo));
  } catch (e: any) {
    return sendGitError(res, e);
  }
  try {
    const cwd = getRepoRoot(repo);
    // Trailing `--` pins the argument to a branch, never a pathspec.
    const output = (await gitArgv(["checkout", branch, "--"], cwd, WRITE_TIMEOUT_MS)).toString("utf-8");
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

/** A remote-tracking branch: `ref` = `origin/feat/b`, `remote` = `origin`, `name` = `feat/b`. */
interface RemoteBranch {
  ref: string;
  remote: string;
  name: string;
}

/** Local heads, and remote branches without a local twin (symbolic refs such as origin/HEAD dropped). */
async function listLocalAndRemote(cwd: string): Promise<{ local: string[]; remote: RemoteBranch[] }> {
  const lines = async (args: string[]) => (await gitArgv(args, cwd)).toString("utf-8").split("\n").filter(Boolean);
  const local = await lines(["for-each-ref", "refs/heads", "--format=%(refname:short)"]);
  const localSet = new Set(local);
  const remote: RemoteBranch[] = [];
  for (const line of await lines(["for-each-ref", "refs/remotes", "--format=%(refname:short)%00%(symref)"])) {
    const [ref, symref] = line.split("\0");
    const slash = ref.indexOf("/");
    if (symref || slash < 0) continue;
    const name = ref.slice(slash + 1);
    if (!localSet.has(name)) remote.push({ ref, remote: ref.slice(0, slash), name });
  }
  return { local, remote };
}

// List branches
router.get("/branches", async (req, res) => {
  try {
    const repo = req.query.repo as string | undefined;
    const raw = git("branch -a --format='%(refname:short)'", repo);
    const branches = raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((b) => b.trim());
    const current = git("rev-parse --abbrev-ref HEAD", repo).trim();
    const { local, remote } = await listLocalAndRemote(getRepoRoot(repo));
    res.json({ current, branches, local, remote });
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
