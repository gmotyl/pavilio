import { type Response, Router } from "express";
import { join, resolve } from "path";
import { getConfig } from "../config.js";
import { isLiveProject, linkedRepos, readRepos, type RepoEntry } from "../lib/discovery.js";
import { expandHome } from "../lib/paths.js";
import { createForgeResolver, type ResolvedForge } from "../lib/prs/forge.js";
import { createGitHubGhProvider } from "../lib/prs/github-gh.js";
import { createGitLabGlabProvider } from "../lib/prs/gitlab-glab.js";
import {
  type Forge,
  type PrProvider,
  type PrState,
  PrUnavailableError,
  type PullRequest,
  redactUrlCredentials,
  type Unavailable,
} from "../lib/prs/provider.js";

const CACHE_TTL_MS = 60_000;

const repoRoot = (r: RepoEntry): string => resolve(expandHome(r.path));

const NOT_LINKED = { error: "repo is not linked to any project" };

/** The present linked repo at `repo`, else null: the path comes from the client. */
function linkedTarget(repo: string): { repoPath: string; forge?: Forge } | null {
  const target = resolve(expandHome(repo));
  const entry = linkedRepos().find((r) => r.present && repoRoot(r) === target);
  return entry ? { repoPath: target, forge: entry.forge } : null;
}

type ResolveForge = (e: { repoPath: string; forge?: Forge }) => Promise<ResolvedForge>;

const reasonOf = (e: unknown): Unavailable => (e instanceof PrUnavailableError ? e.reason : "failed");
const hostOf = (e: unknown): { host?: string } =>
  e instanceof PrUnavailableError && e.host !== undefined ? { host: e.host } : {};

/** One provider-failure mapping for every per-PR route. */
function sendProviderFailure(res: Response, e: unknown): void {
  // Upstream text may echo an origin URL with embedded credentials.
  res.status(502).json({ error: redactUrlCredentials((e as Error)?.message ?? String(e)), reason: reasonOf(e) });
}

export function createPrsRouter(
  providers: { github: PrProvider; gitlab: PrProvider },
  opts: { now?: () => number; resolveForge?: ResolveForge } = {},
): Router {
  const now = opts.now ?? Date.now;
  const resolveForge = opts.resolveForge ?? createForgeResolver();

  /** The provider serving `target`; an unknown forge runs no forge CLI and rejects with its host. */
  async function providerFor(target: { repoPath: string; forge?: Forge }): Promise<PrProvider> {
    const r = await resolveForge(target);
    if (r.forge === "unknown") throw new PrUnavailableError("unknown-forge", `unknown forge for ${r.host || "origin"}`, r.host);
    return providers[r.forge];
  }
  const router = Router();
  // Successes only: an unavailable repo must recover on the next request (e.g. after `gh auth login`).
  const cache = new Map<string, { at: number; prs: PullRequest[] }>();
  // Concurrent cold requests share one provider call per repo.
  const inFlight = new Map<string, Promise<PullRequest[]>>();

  // Per-PR cache for /one, keyed `repoPath#n`; successes only, like the list cache.
  const oneCache = new Map<string, { at: number; pr: PullRequest & { state: PrState } }>();
  // Latest provider call per key: an older call finishing last must not overwrite a newer result.
  const oneGeneration = new Map<string, number>();

  async function getPr(
    target: { repoPath: string; forge?: Forge },
    n: number,
    fresh: boolean,
  ): Promise<PullRequest & { state: PrState }> {
    const key = `${target.repoPath}#${n}`;
    const hit = oneCache.get(key);
    if (!fresh && hit && now() - hit.at < CACHE_TTL_MS) return hit.pr;
    const generation = (oneGeneration.get(key) ?? 0) + 1;
    oneGeneration.set(key, generation);
    const pr = await (await providerFor(target)).getPr(target.repoPath, n);
    if (oneGeneration.get(key) === generation) oneCache.set(key, { at: now(), pr });
    return pr;
  }

  function listOpen(target: { repoPath: string; forge?: Forge }): Promise<PullRequest[]> {
    const { repoPath } = target;
    const hit = cache.get(repoPath);
    if (hit && now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.prs);
    const pending = inFlight.get(repoPath);
    if (pending) return pending;
    // Resolution happens on a miss only: a cache hit runs nothing.
    const p = providerFor(target)
      .then((provider) => provider.listOpen(repoPath))
      .then((prs) => {
        cache.set(repoPath, { at: now(), prs });
        return prs;
      })
      .finally(() => inFlight.delete(repoPath));
    inFlight.set(repoPath, p);
    return p;
  }

  router.get("/", async (req, res) => {
    const name = typeof req.query.project === "string" ? req.query.project : "";
    if (!name) return res.status(400).json({ error: "project parameter required" });
    const { projectsDir } = getConfig();
    // One membership rule with /open: a symlinked project must stay inside projectsDir.
    if (!isLiveProject(projectsDir, name)) return res.status(404).json({ error: "Project not found" });

    // A repo missing on this machine is a resting state: never run anything there.
    const repos = readRepos(join(projectsDir, name), name).filter((r) => r.present);
    const [me, results] = await Promise.all([
      // One identity for every forge, always from gh.
      providers.github.whoami().catch(() => ""),
      Promise.allSettled(repos.map((r) => listOpen({ repoPath: repoRoot(r), forge: r.forge }))),
    ]);

    const prs: PullRequest[] = [];
    const unavailable: { repo: string; reason: Unavailable; host?: string }[] = [];
    results.forEach((r, i) => {
      // Label by the repos.json name so PR rows and `unavailable` agree.
      if (r.status === "fulfilled") prs.push(...r.value.map((p) => ({ ...p, repo: repos[i].name })));
      else
        unavailable.push({ repo: repos[i].name, reason: reasonOf(r.reason), ...hostOf(r.reason) });
    });
    prs.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    res.json({ me, prs, unavailable });
  });

  router.get("/one", async (req, res) => {
    const name = typeof req.query.project === "string" ? req.query.project : "";
    if (!name) return res.status(400).json({ error: "project parameter required" });
    const repoName = typeof req.query.repo === "string" ? req.query.repo : "";
    if (!repoName.trim()) return res.status(400).json({ error: "repo required" });
    const raw = typeof req.query.number === "string" ? req.query.number : "";
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
      return res.status(400).json({ error: "number must be a positive integer" });
    }
    const { projectsDir } = getConfig();
    if (!isLiveProject(projectsDir, name)) return res.status(404).json({ error: "Project not found" });
    const entry = readRepos(join(projectsDir, name), name).find((r) => r.name === repoName && r.present);
    if (!entry) return res.status(404).json({ error: "Repo not found" });

    try {
      const pr = await getPr({ repoPath: repoRoot(entry), forge: entry.forge }, Number(raw), req.query.fresh === "1");
      // Label by the repos.json name, as the list does.
      res.json({ ...pr, repo: entry.name });
    } catch (e) {
      res.status(502).json({ unavailable: reasonOf(e), ...hostOf(e) });
    }
  });

  router.post("/open", async (req, res) => {
    const { repo, number } = req.body ?? {};
    if (typeof repo !== "string" || !repo.trim()) return res.status(400).json({ error: "repo required" });
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number <= 0) {
      return res.status(400).json({ error: "number must be a positive integer" });
    }
    const target = linkedTarget(repo);
    if (!target) return res.status(400).json(NOT_LINKED);

    try {
      res.json(await (await providerFor(target)).openPr(target.repoPath, number));
    } catch (e) {
      sendProviderFailure(res, e);
    }
  });

  router.get("/comments", async (req, res) => {
    const repo = typeof req.query.repo === "string" ? req.query.repo : "";
    if (!repo.trim()) return res.status(400).json({ error: "repo required" });
    const raw = typeof req.query.number === "string" ? req.query.number : "";
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
      return res.status(400).json({ error: "number must be a positive integer" });
    }
    const target = linkedTarget(repo);
    if (!target) return res.status(400).json(NOT_LINKED);

    try {
      res.json(await (await providerFor(target)).reviewComments(target.repoPath, Number(raw)));
    } catch (e) {
      sendProviderFailure(res, e);
    }
  });

  return router;
}

const defaultResolveForge = createForgeResolver();

export default createPrsRouter(
  {
    github: createGitHubGhProvider(),
    // glab resolves by path alone: look up the repo's repos.json forge override so a forced
    // gitlab repo on an unconfigured host still resolves to GitLab.
    gitlab: createGitLabGlabProvider({
      resolve: (repoPath) =>
        defaultResolveForge({
          repoPath,
          forge: linkedRepos().find((r) => r.present && repoRoot(r) === repoPath)?.forge,
        }),
    }),
  },
  { resolveForge: defaultResolveForge },
);
