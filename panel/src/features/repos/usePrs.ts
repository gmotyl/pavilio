import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PrFilter, PrFilterPreset } from "../../preferences/declarations";
import type { PullRequest, Unavailable } from "../../../server/lib/prs/provider";

export type { PullRequest };

export interface UnavailableRepo {
  repo: string;
  reason: Unavailable;
  /** The origin host, when the server knows it (`unknown-forge`, `glab-*`). */
  host?: string;
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

/**
 * The GitHub login from the last PRs list that named one. `/api/prs/one` carries
 * no login, so a lone PR row (the QA tab's story header) borrows it here for its
 * "Your review requested" badge; null until a list has loaded in this tab.
 */
let lastLogin: string | null = null;
export const knownLogin = (): string | null => lastLogin;
/** Tests only: forget the borrowed login so suites don't depend on run order. */
export function __resetKnownLoginForTests(): void {
  lastLogin = null;
}

/** A view entry refetches only past this age; the server caches lists for a minute anyway. */
const FRESH_MS = 15_000;

export interface PrsState {
  me: string | null;
  /** The list loaded but the login lookup failed: Mine / Review requested can't be told apart from zero. */
  identityUnknown: boolean;
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
  /** Refetch unless the last request is younger than FRESH_MS; for view entry and opening a picker. */
  revalidate: () => void;
}

export function usePrs(project: string, filter: PrFilter): PrsState {
  // Tagged with its project: the tab stays mounted across project switches, so an
  // untagged body would show the previous project's PRs until (or unless) the next arrives.
  const [loaded, setLoaded] = useState<{ project: string; body: PrsResponse } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const startedAt = useRef(0);

  useEffect(() => {
    let cancelled = false;
    startedAt.current = Date.now();
    setLoading(true);
    setError(null);
    fetch(`/api/prs?project=${encodeURIComponent(project)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as PrsResponse;
      })
      .then((body) => {
        if (cancelled) return;
        // Only a current response may update the borrowed login.
        if (body.me) lastLogin = body.me;
        setLoaded({ project, body });
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
  const revalidate = useCallback(() => {
    if (Date.now() - startedAt.current >= FRESH_MS) reload();
  }, [reload]);

  const data = loaded?.project === project ? loaded.body : null;

  const me = data?.me ?? null;
  const identityUnknown = !!data && !data.me;
  const all = useMemo(() => data?.prs ?? [], [data]);
  // Without a login, Mine / Review requested would match nothing and read as "none": list everything instead.
  const effective = useMemo<PrFilter>(() => (identityUnknown ? { ...filter, preset: "all" } : filter), [identityUnknown, filter]);
  const filtered = useMemo(() => filterPrs(all, me ?? "", effective), [all, me, effective]);
  const reviewRequested = useMemo(() => (me ? all.filter((p) => p.reviewers.includes(me)).length : 0), [all, me]);
  const authors = useMemo(() => [...new Set(all.map((p) => p.author))].sort(), [all]);

  return {
    me,
    identityUnknown,
    all,
    prs: filtered.prs,
    counts: filtered.counts,
    reviewRequested,
    authors,
    unavailable: data?.unavailable ?? [],
    loading,
    error,
    reload,
    revalidate,
  };
}
