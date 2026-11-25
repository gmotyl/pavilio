import { useCallback, useEffect, useState } from "react";
import type { PrState, PullRequest, Unavailable } from "../../../server/lib/prs/provider";
import { explainable } from "../projects/runPrompt";

/** What a story's frontmatter says about its PR; the QA tab's story PR header is drawn from it. */
export interface StoryPr {
  project: string;
  repo: string;
  number: number;
  title: string | null;
  /** The head commit the story explains (frontmatter `head:`). */
  head: string | null;
  lang: "en" | "pl" | null;
}

/** `<p>/qa/stories/<file>.md`: the QA tab's `?file=` form of a story. */
const STORY_PATH = /^([^/]+)\/qa\/stories\/.+\.md$/;
/** The leading frontmatter block, as `lib/frontmatter` fences it. */
const FRONTMATTER = /^﻿?---\r?\n([\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;
const PR_REF = /^([^#\s]+)#(\d+)$/;

/** Top-level `key: value` scalars; quotes stripped. Stories only write flat keys. */
function frontmatterScalars(content: string): Map<string, string> {
  const out = new Map<string, string>();
  const block = FRONTMATTER.exec(content)?.[1] ?? "";
  for (const line of block.split(/\r?\n/)) {
    const m = /^([A-Za-z_][\w-]*):[ \t]*(.*?)[ \t]*$/.exec(line);
    if (m) out.set(m[1], m[2].replace(/^(["'])(.*)\1$/, "$2"));
  }
  return out;
}

/**
 * The story PR a QA file names, or null: the file must sit under
 * `<p>/qa/stories/` and its frontmatter carry `pr: <repo>#<n>` that an Explain
 * run could name (the same slug check). Runs, reviews and `ref:` stories get null.
 */
export function storyPrOf(filePath: string, content: string): StoryPr | null {
  const project = STORY_PATH.exec(filePath)?.[1];
  if (!project) return null;
  const fm = frontmatterScalars(content);
  const ref = PR_REF.exec(fm.get("pr") ?? "");
  if (!ref) return null;
  const number = Number(ref[2]);
  if (!explainable(project, ref[1], number)) return null;
  const lang = fm.get("lang")?.toLowerCase();
  return {
    project,
    repo: ref[1],
    number,
    title: fm.get("title") || null,
    head: fm.get("head") || null,
    lang: lang === "en" || lang === "pl" ? lang : null,
  };
}

export type StoryPrData = PullRequest & { state: PrState };

/**
 * Why the header has no live PR: the provider's reasons, the repo is not linked
 * (404 `Repo not found`), or the project itself is gone (404 `Project not found`).
 */
export type StoryPrProblem = Unavailable | "unlinked" | "project-missing";

export interface StoryPrStatus {
  pr: StoryPrData | null;
  problem: StoryPrProblem | null;
  /** A request is in flight (first load or ↻). */
  loading: boolean;
  /** Refetch past the server's cache (`fresh=1`). */
  refresh: () => void;
}

const UNAVAILABLE: readonly string[] = ["gh-missing", "gh-unauthenticated", "not-github", "failed"];

async function problemOf(res: Response): Promise<StoryPrProblem> {
  const body = (await res.json().catch(() => null)) as { unavailable?: unknown; error?: unknown } | null;
  if (res.status === 404) {
    // `/api/prs/one` 404s for two reasons; its `error` tells them apart.
    if (body?.error === "Repo not found") return "unlinked";
    if (body?.error === "Project not found") return "project-missing";
    return "failed";
  }
  const reason = body?.unavailable;
  return typeof reason === "string" && UNAVAILABLE.includes(reason) ? (reason as Unavailable) : "failed";
}

/** The PR a story names, live from `/api/prs/one`; fetched on open and on `refresh`. */
export function useStoryPr(project: string, repo: string, number: number): StoryPrStatus {
  const key = `${project}/${repo}#${number}`;
  // Tagged with its key: a switch to another story must not show the previous PR.
  const [result, setResult] = useState<{ key: string; pr: StoryPrData | null; problem: StoryPrProblem | null } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  // ↻ presses, tagged like the result: a refresh of one story must not make the next one's first load fresh.
  const [refreshes, setRefreshes] = useState<{ key: string; n: number }>({ key, n: 0 });
  const fresh = refreshes.key === key ? refreshes.n : 0;

  useEffect(() => {
    let cancelled = false;
    // A switch, a ↻ or an unmount leaves this request behind: stop it rather than let it run on.
    const ctrl = new AbortController();
    setLoading(true);
    const qs = new URLSearchParams({ project, repo, number: String(number) });
    if (fresh > 0) qs.set("fresh", "1");
    fetch(`/api/prs/one?${qs}`, { signal: ctrl.signal })
      .then(async (res) =>
        res.ok ? { pr: (await res.json()) as StoryPrData, problem: null } : { pr: null, problem: await problemOf(res) },
      )
      .catch(() => ({ pr: null, problem: "failed" as const }))
      .then((r) => {
        if (cancelled) return;
        setResult({ key, ...r });
        setLoading(false);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [key, project, repo, number, fresh]);

  const refresh = useCallback(
    () => setRefreshes((r) => ({ key, n: (r.key === key ? r.n : 0) + 1 })),
    [key],
  );
  const current = result?.key === key ? result : null;
  return { pr: current?.pr ?? null, problem: current?.problem ?? null, loading, refresh };
}
