import { Router } from "express";
import { execSync } from "child_process";
import { resolve } from "path";
import { getConfig } from "../config.js";

const router = Router();

function quoteShellArg(value: string): string {
  return `"${value.replace(/["\\$`]/g, "\\$&")}"`;
}

function getRepoRoot(customRepo?: string): string {
  if (customRepo) {
    // Resolve ~ to home dir
    const resolved = customRepo.startsWith("~/")
      ? resolve(process.env.HOME || "", customRepo.slice(2))
      : resolve(customRepo);
    return resolved;
  }
  const { projectsDir } = getConfig();
  return resolve(projectsDir, "..");
}

function git(cmd: string, repoPath?: string): string {
  return execSync(`git ${cmd}`, {
    cwd: getRepoRoot(repoPath),
    encoding: "utf-8",
  });
}

function gitDiffOutput(cmd: string, repoPath?: string): string {
  try {
    return git(cmd, repoPath);
  } catch (e: any) {
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
    return gitDiffOutput(`diff --no-index -- /dev/null -- ${quotedFile}`, repo);
  }

  if (status?.includes("A")) {
    return git(`diff --cached -- ${quotedFile}`, repo);
  }

  return diff;
}

function getBranchDiff(base: string, file: string, repo?: string): string {
  const quotedFile = quoteShellArg(file);
  const diff = git(`diff ${base}...HEAD -- ${quotedFile}`, repo);
  if (diff.trim()) return diff;

  const status = git(`diff --name-status ${base}...HEAD -- ${quotedFile}`, repo)
    .split("\n")
    .find(Boolean)
    ?.trim();

  if (status?.startsWith("A")) {
    return gitDiffOutput(`diff --no-index -- /dev/null -- ${quotedFile}`, repo);
  }

  return diff;
}

// Git status
router.get("/status", (req, res) => {
  try {
    const repo = req.query.repo as string | undefined;
    const status = git("status --porcelain", repo);
    const files = status
      .split("\n")
      .filter(Boolean)
      .map((line) => ({
        status: line.slice(0, 2).trim(),
        path: line.slice(3),
      }));
    res.json(files);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Diff for a specific file (working tree or specific commit)
router.get("/diff", (req, res) => {
  try {
    const file = req.query.file as string;
    const sha = req.query.sha as string | undefined;
    const repo = req.query.repo as string | undefined;
    if (!file)
      return res.status(400).json({ error: "file parameter required" });
    const quotedFile = quoteShellArg(file);
    const diff = sha
      ? git(`diff ${sha}^..${sha} -- ${quotedFile}`, repo)
      : getWorkingTreeDiff(file, repo);
    res.json({ diff });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
  }
});

// Files changed in a specific commit
router.get("/commit-files", (req, res) => {
  try {
    const sha = req.query.sha as string;
    const repo = req.query.repo as string | undefined;
    if (!sha) return res.status(400).json({ error: "sha parameter required" });
    const raw = git(`diff-tree --no-commit-id -r --name-status ${sha}`, repo);
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
    res.status(500).json({ error: e.message });
  }
});

// Stage files
router.post("/stage", (req, res) => {
  try {
    const { files, repo } = req.body;
    if (!Array.isArray(files))
      return res.status(400).json({ error: "files array required" });
    for (const f of files) {
      git(`add "${f}"`, repo);
    }
    res.json({ ok: true, staged: files.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Commit
router.post("/commit", (req, res) => {
  try {
    const { message, repo } = req.body;
    if (!message) return res.status(400).json({ error: "message required" });
    const safe = message.replace(/"/g, '\\"');
    git(`commit -m "${safe}"`, repo);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Push
router.post("/push", (req, res) => {
  try {
    const { repo } = req.body || {};
    git("push", repo);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Branch info
router.get("/branch", (req, res) => {
  try {
    const repo = req.query.repo as string | undefined;
    const branch = git("rev-parse --abbrev-ref HEAD", repo).trim();
    res.json({ branch });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
  }
});

// Checkout branch
router.post("/checkout", (req, res) => {
  try {
    const { branch, repo } = req.body;
    if (!branch)
      return res.status(400).json({ error: "branch parameter required" });
    const safe = branch.replace(/[;&|`$]/g, "");
    const output = git(`checkout "${safe}"`, repo);
    const current = git("rev-parse --abbrev-ref HEAD", repo).trim();
    res.json({ ok: true, branch: current, output: output.trim() });
  } catch (e: any) {
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
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
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
    } catch {}
    res.json({ files, commitsAhead });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
  }
});

// Suggest commit message based on changed files
router.get("/suggest-message", (req, res) => {
  try {
    const repo = req.query.repo as string | undefined;
    const status = git("status --porcelain", repo);
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
    res.status(500).json({ error: e.message });
  }
});

export default router;
