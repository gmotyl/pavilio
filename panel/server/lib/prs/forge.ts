import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { defaultRunner, type Runner } from "./github-gh.js";
import type { Forge } from "./provider.js";

export type ResolvedForge =
  | { forge: Forge; host: string; projectPath: string }
  | { forge: "unknown"; host: string };

// GitHub's SSH-over-443 endpoint is the same github.com.
export const GITHUB_REMOTE_HOSTS: ReadonlySet<string> = new Set(["github.com", "ssh.github.com"]);
const GITLAB_COM = "gitlab.com";
// A credential prompt would hang the resolution; fail fast instead.
const GIT_ENV = { GIT_TERMINAL_PROMPT: "0" };

/** Host of a git remote URL: https://, ssh://, git:// or scp-style `user@host:path`. */
export function remoteHost(url: string): string | null {
  const u = url.trim();
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)/i.exec(u);
  if (scheme) return scheme[1].toLowerCase();
  const scp = /^(?:[^@/]+@)?([^/:]+):(?!\/\/)/.exec(u);
  return scp ? scp[1].toLowerCase() : null;
}

/** Full project path of a remote URL (nested groups kept, `.git` dropped), e.g. `group/sub/repo`. */
export function remotePath(url: string): string | null {
  const u = url.trim();
  const path = /^[a-z][a-z0-9+.-]*:\/\/[^/]+\/(.+)$/i.exec(u)?.[1] ?? /^(?:[^@/]+@)?[^/:]+:(?!\/\/)(.+)$/.exec(u)?.[1];
  if (!path) return null;
  const trimmed = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  return trimmed ? trimmed : null;
}

/** glab's config.yml: `$GLAB_CONFIG_DIR/config.yml`, else `~/.config/glab-cli/config.yml`. Null when unreadable. */
function readGlabConfigFrom(env: NodeJS.ProcessEnv): string | null {
  const dir = env.GLAB_CONFIG_DIR || join(env.HOME || homedir(), ".config", "glab-cli");
  try {
    return readFileSync(join(dir, "config.yml"), "utf-8");
  } catch {
    return null;
  }
}

/** Hosts listed under `hosts:` in glab config; absent or invalid config yields none. */
function glabHosts(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const doc: unknown = parseYaml(raw);
    const hosts = doc && typeof doc === "object" ? (doc as { hosts?: unknown }).hosts : undefined;
    if (!hosts || typeof hosts !== "object" || Array.isArray(hosts)) return new Set();
    return new Set(Object.keys(hosts).map((h) => h.toLowerCase()));
  } catch {
    return new Set();
  }
}

/**
 * Resolves which forge serves a repo: repos.json override, then the origin host
 * (github.com → github; gitlab.com or a glab-configured host → gitlab). Only `git` runs —
 * never a forge CLI. The glab config is re-read on every call so `glab auth login`
 * takes effect without a restart.
 */
export function createForgeResolver(
  deps: { run?: Runner; readGlabConfig?: () => string | null; env?: NodeJS.ProcessEnv } = {},
): (entry: { repoPath: string; forge?: Forge }) => Promise<ResolvedForge> {
  const run = deps.run ?? defaultRunner;
  const env = deps.env ?? process.env;
  const readGlabConfig = deps.readGlabConfig ?? (() => readGlabConfigFrom(env));

  return async ({ repoPath, forge }) => {
    let url: string;
    try {
      const r = await run("git", ["remote", "get-url", "origin"], { cwd: repoPath, env: GIT_ENV });
      if (r.code !== 0) return { forge: "unknown", host: "" };
      url = r.stdout.trim();
    } catch {
      return { forge: "unknown", host: "" };
    }
    if (!url) return { forge: "unknown", host: "" };
    const host = remoteHost(url) ?? "";
    const projectPath = remotePath(url);
    if (!projectPath) return { forge: "unknown", host };

    if (forge) return { forge, host, projectPath };
    if (GITHUB_REMOTE_HOSTS.has(host)) return { forge: "github", host, projectPath };
    if (host === GITLAB_COM || glabHosts(readGlabConfig()).has(host)) return { forge: "gitlab", host, projectPath };
    return { forge: "unknown", host };
  };
}
