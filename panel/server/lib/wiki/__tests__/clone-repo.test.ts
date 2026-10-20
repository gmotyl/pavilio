import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";

import { cloneRepo, gitEnv, parseRepoUrl } from "../clone-repo";

let root = "";
let projectDir = "";
let workDir = "";
let repoUrl = "";

/** Isolated from the user's git config; fixed identity for fixture commits. */
const ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Wiki Test",
  GIT_AUTHOR_EMAIL: "wiki@test.invalid",
  GIT_COMMITTER_NAME: "Wiki Test",
  GIT_COMMITTER_EMAIL: "wiki@test.invalid",
};

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, env: gitEnv(ENV), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function commit(file: string, content: string, message: string): string {
  writeFileSync(join(workDir, file), content);
  git(["add", file], workDir);
  git(["commit", "-q", "-m", message], workDir);
  git(["push", "-q", "origin", "HEAD:main"], workDir);
  return git(["rev-parse", "HEAD"], workDir);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wiki-clone-"));
  projectDir = join(root, "project");
  mkdirSync(projectDir);
  // Bare remote at <root>/acme/widget.git → owner "acme", repo "widget".
  const bare = join(root, "acme", "widget.git");
  mkdirSync(bare, { recursive: true });
  // `init -b` needs git >= 2.28; point HEAD at main explicitly instead.
  git(["init", "-q", "--bare"], bare);
  git(["symbolic-ref", "HEAD", "refs/heads/main"], bare);
  workDir = join(root, "work");
  git(["clone", "-q", bare, workDir], root);
  git(["checkout", "-q", "-b", "main"], workDir);
  commit("README.md", "one\n", "first");
  commit("README.md", "two\n", "second");
  repoUrl = pathToFileURL(bare).href;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("cloneRepo", () => {
  it("shallow-clones a repo", async () => {
    const head = git(["rev-parse", "HEAD"], workDir);
    const receipt = await cloneRepo(projectDir, repoUrl, { env: ENV });

    expect(receipt.action).toBe("cloned");
    expect(receipt.clonePath).toBe("raw/repos/acme-widget");
    expect(receipt.commitSha).toBe(head);

    const clone = join(projectDir, "wiki", receipt.clonePath);
    expect(readFileSync(join(clone, "README.md"), "utf8")).toBe("two\n");
    expect(git(["rev-list", "--count", "HEAD"], clone)).toBe("1");
    expect(existsSync(join(clone, ".git", "shallow"))).toBe(true);
    // Clones are a regenerable cache and must never land in the workspace repo.
    expect(readFileSync(join(projectDir, "wiki", "raw", "repos", ".gitignore"), "utf8")).toContain("*");
  });

  it("refreshes an existing clone", async () => {
    const first = await cloneRepo(projectDir, repoUrl, { env: ENV });
    const newHead = commit("README.md", "three\n", "third");

    const second = await cloneRepo(projectDir, repoUrl, { env: ENV });

    expect(second.action).toBe("refreshed");
    expect(second.clonePath).toBe(first.clonePath);
    expect(second.commitSha).toBe(newHead);
    const clone = join(projectDir, "wiki", second.clonePath);
    expect(readFileSync(join(clone, "README.md"), "utf8")).toBe("three\n");
    expect(git(["rev-list", "--count", "HEAD"], clone)).toBe("1");
  });

  it("refuses a branch that would inject git options", async () => {
    const first = await cloneRepo(projectDir, repoUrl, { env: ENV });
    const clone = join(projectDir, "wiki", first.clonePath);
    // Same dir name (acme-widget) as the existing file:// clone.
    const evil = "https://github.com/acme/widget/tree/--upload-pack=touch${IFS}PWNED;git-upload-pack";

    await expect(cloneRepo(projectDir, evil, { env: ENV })).rejects.toThrow(/branch/i);
    expect(existsSync(join(clone, "PWNED"))).toBe(false);
    expect(existsSync(join(projectDir, "PWNED"))).toBe(false);
    expect(existsSync(join(root, "PWNED"))).toBe(false);
  });

  it("re-clones when the existing clone has a different origin", async () => {
    await cloneRepo(projectDir, repoUrl, { env: ENV });
    // <root>/other/ACME/widget.git maps to the same dir name "acme-widget".
    const otherBare = join(root, "other", "ACME", "widget.git");
    mkdirSync(otherBare, { recursive: true });
    git(["init", "-q", "--bare"], otherBare);
    git(["symbolic-ref", "HEAD", "refs/heads/main"], otherBare);
    const otherWork = join(root, "other-work");
    git(["clone", "-q", otherBare, otherWork], root);
    git(["checkout", "-q", "-b", "main"], otherWork);
    writeFileSync(join(otherWork, "README.md"), "other\n");
    git(["add", "README.md"], otherWork);
    git(["commit", "-q", "-m", "other"], otherWork);
    git(["push", "-q", "origin", "HEAD:main"], otherWork);
    const otherHead = git(["rev-parse", "HEAD"], otherWork);
    const otherUrl = pathToFileURL(otherBare).href;

    const receipt = await cloneRepo(projectDir, otherUrl, { env: ENV });

    expect(receipt.action).toBe("cloned");
    expect(receipt.clonePath).toBe("raw/repos/acme-widget");
    expect(receipt.commitSha).toBe(otherHead);
    const clone = join(projectDir, "wiki", receipt.clonePath);
    expect(readFileSync(join(clone, "README.md"), "utf8")).toBe("other\n");
    expect(git(["remote", "get-url", "origin"], clone)).toBe(otherUrl);
  });

  it("refuses a symlinked clone dir", async () => {
    const elsewhere = join(root, "elsewhere");
    mkdirSync(join(projectDir, "wiki", "raw", "repos"), { recursive: true });
    git(["clone", "-q", repoUrl, elsewhere], root);
    symlinkSync(elsewhere, join(projectDir, "wiki", "raw", "repos", "acme-widget"));

    await expect(cloneRepo(projectDir, repoUrl, { env: ENV })).rejects.toThrow(/symlink/i);
    expect(existsSync(join(elsewhere, "README.md"))).toBe(true);
  });
});

describe("parseRepoUrl", () => {
  it("keeps a slash-containing branch from a /tree/ URL", () => {
    expect(parseRepoUrl("https://github.com/acme/widget/tree/feature/fix")).toEqual({
      owner: "acme",
      repo: "widget",
      cloneUrl: "https://github.com/acme/widget.git",
      branch: "feature/fix",
    });
    expect(parseRepoUrl("https://github.com/acme/widget/tree/main/").branch).toBe("main");
  });

  it("rejects an unsafe slash-containing branch", () => {
    expect(() => parseRepoUrl("https://github.com/acme/widget/tree/feature//fix")).toThrow(/branch/i);
    expect(() => parseRepoUrl("https://github.com/acme/widget/tree/a/../b")).toThrow(/branch/i);
  });
});
