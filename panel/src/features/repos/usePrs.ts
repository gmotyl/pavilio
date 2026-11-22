import { useCallback, useEffect, useMemo, useState } from "react";
import type { PrFilter, PrFilterPreset } from "../../preferences/declarations";
import type { PullRequest, Unavailable } from "../../../server/lib/prs/provider";

export type { PullRequest };

export interface UnavailableRepo {
  repo: string;
  reason: Unavailable;
}

export interface PrsResponse {
  me: string;
  prs: PullRequest[];
  unavailable: UnavailableRepo[];
}

export type PresetCounts = Record<PrFilterPreset, number>;

const matchesPreset = (p: PullRequest, preset: PrFilterPreset, me: string): boolean =>
  preset === "mine" ? p.author === me : preset === "review" ? p.reviewers.includes(me) : true;

/** The PRs a filter shows, and each preset's count under the same author narrowing. */
export function filterPrs(prs: PullRequest[], me: string, filter: PrFilter): { prs: PullRequest[]; counts: PresetCounts } {
  const byAuthor = filter.author ? prs.filter((p) => p.author === filter.author) : prs;
  return {
    prs: byAuthor.filter((p) => matchesPreset(p, filter.preset, me)),
    counts: {
      mine: byAuthor.filter((p) => matchesPreset(p, "mine", me)).length,
      review: byAuthor.filter((p) => matchesPreset(p, "review", me)).length,
      all: byAuthor.length,
    },
  };
}

export interface PrsState {
  me: string | null;
  /** Every open PR, unfiltered. */
  all: PullRequest[];
  /** The PRs `filter` selects. */
  prs: PullRequest[];
  counts: PresetCounts;
  /** PRs awaiting my review, regardless of the author narrowing — the PRs pill count. */
  reviewRequested: number;
  /** Distinct authors, sorted, for the author select. */
  authors: string[];
  unavailable: UnavailableRepo[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function usePrs(project: string, filter: PrFilter): PrsState {
  const [data, setData] = useState<PrsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/prs?project=${encodeURIComponent(project)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as PrsResponse;
      })
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const me = data?.me ?? null;
  const all = useMemo(() => data?.prs ?? [], [data]);
  const filtered = useMemo(() => filterPrs(all, me ?? "", filter), [all, me, filter]);
  const reviewRequested = useMemo(() => (me ? all.filter((p) => p.reviewers.includes(me)).length : 0), [all, me]);
  const authors = useMemo(() => [...new Set(all.map((p) => p.author))].sort(), [all]);

  return {
    me,
    all,
    prs: filtered.prs,
    counts: filtered.counts,
    reviewRequested,
    authors,
    unavailable: data?.unavailable ?? [],
    loading,
    error,
    reload,
  };
}
