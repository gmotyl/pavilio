import { Router } from "express";
import { join, resolve } from "path";
import { getConfig } from "../config.js";
import { isLiveProject, linkedRepos, readRepos, type RepoEntry } from "../lib/discovery.js";
import { expandHome } from "../lib/paths.js";
import { createGitHubGhProvider } from "../lib/prs/github-gh.js";
import {
  type PrProvider,
  PrUnavailableError,
  type PullRequest,
  redactUrlCredentials,
  type Unavailable,
} from "../lib/prs/provider.js";

const CACHE_TTL_MS = 60_000;

const repoRoot = (r: RepoEntry): string => resolve(expandHome(r.path));

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

  router.post("/open", async (req, res) => {
    const { repo, number } = req.body ?? {};
    if (typeof repo !== "string" || !repo.trim()) return res.status(400).json({ error: "repo required" });
    if (typeof number !== "number" || !Number.isInteger(number) || number <= 0) {
      return res.status(400).json({ error: "number must be a positive integer" });
    }
    // Only a present linked repo may be fetched into: the path comes from the client.
    const target = resolve(expandHome(repo));
    const linked = linkedRepos().some((r) => r.present && repoRoot(r) === target);
    if (!linked) return res.status(400).json({ error: "repo is not linked to any project" });

    try {
      res.json(await provider.openPr(target, number));
    } catch (e) {
      // Upstream text may echo an origin URL with embedded credentials.
      const reason: Unavailable = e instanceof PrUnavailableError ? e.reason : "failed";
      res.status(502).json({ error: redactUrlCredentials((e as Error)?.message ?? String(e)), reason });
    }
  });

  return router;
}

export default createPrsRouter(createGitHubGhProvider());
