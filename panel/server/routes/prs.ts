import { type Response, Router } from "express";
import { join, resolve } from "path";
import { getConfig } from "../config.js";
import { isLiveProject, linkedRepos, readRepos, type RepoEntry } from "../lib/discovery.js";
import { expandHome } from "../lib/paths.js";
import { createGitHubGhProvider } from "../lib/prs/github-gh.js";
import {
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

/** The resolved path of `repo` when it is a present linked repo, else null: the path comes from the client. */
function linkedTarget(repo: string): string | null {
  const target = resolve(expandHome(repo));
  return linkedRepos().some((r) => r.present && repoRoot(r) === target) ? target : null;
}

/** One provider-failure mapping for every per-PR route. */
function sendProviderFailure(res: Response, e: unknown): void {
  // Upstream text may echo an origin URL with embedded credentials.
  const reason: Unavailable = e instanceof PrUnavailableError ? e.reason : "failed";
  res.status(502).json({ error: redactUrlCredentials((e as Error)?.message ?? String(e)), reason });
}

export function createPrsRouter(
  provider: PrProvider,
  opts: { now?: () => number } = {},
): Router {
  const now = opts.now ?? Date.now;
  const router = Router();
  // Successes only: an unavailable repo must recover on the next request (e.g. after `gh auth login`).
  const cache = new Map<string, { at: number; prs: PullRequest[] }>();
  // Concurrent cold requests share one provider call per repo.
  const inFlight = new Map<string, Promise<PullRequest[]>>();

  // Per-PR cache for /one, keyed `repoPath#n`; successes only, like the list cache.
  const oneCache = new Map<string, { at: number; pr: PullRequest & { state: PrState } }>();
  // Latest provider call per key: an older call finishing last must not overwrite a newer result.
  const oneGeneration = new Map<string, number>();

  async function getPr(repoPath: string, n: number, fresh: boolean): Promise<PullRequest & { state: PrState }> {
    const key = `${repoPath}#${n}`;
    const hit = oneCache.get(key);
    if (!fresh && hit && now() - hit.at < CACHE_TTL_MS) return hit.pr;
    const generation = (oneGeneration.get(key) ?? 0) + 1;
    oneGeneration.set(key, generation);
    const pr = await provider.getPr(repoPath, n);
    if (oneGeneration.get(key) === generation) oneCache.set(key, { at: now(), pr });
    return pr;
  }

  function listOpen(repoPath: string): Promise<PullRequest[]> {
    const hit = cache.get(repoPath);
    if (hit && now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.prs);
    const pending = inFlight.get(repoPath);
    if (pending) return pending;
    const p = provider
      .listOpen(repoPath)
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
      provider.whoami().catch(() => ""),
      Promise.allSettled(repos.map((r) => listOpen(repoRoot(r)))),
    ]);

    const prs: PullRequest[] = [];
    const unavailable: { repo: string; reason: Unavailable }[] = [];
    results.forEach((r, i) => {
      // Label by the repos.json name so PR rows and `unavailable` agree.
      if (r.status === "fulfilled") prs.push(...r.value.map((p) => ({ ...p, repo: repos[i].name })));
      else
        unavailable.push({
          repo: repos[i].name,
          reason: r.reason instanceof PrUnavailableError ? r.reason.reason : "failed",
        });
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
      const pr = await getPr(repoRoot(entry), Number(raw), req.query.fresh === "1");
      // Label by the repos.json name, as the list does.
      res.json({ ...pr, repo: entry.name });
    } catch (e) {
      const reason: Unavailable = e instanceof PrUnavailableError ? e.reason : "failed";
      res.status(502).json({ unavailable: reason });
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
      res.json(await provider.openPr(target, number));
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
      res.json(await provider.reviewComments(target, Number(raw)));
    } catch (e) {
      sendProviderFailure(res, e);
    }
  });

  return router;
}

export default createPrsRouter(createGitHubGhProvider());
