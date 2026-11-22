import { useEffect, useMemo, useRef, useState } from "react";
import BranchPicker from "../git/BranchPicker";
import type { RepoEntry } from "../projects/useProjects";
import "./Code.css";

export interface Worktree {
  path: string;
  head: string;
  branch: string | null;
}

/** Each present repo's checkouts, main first; a failed listing falls back to the main checkout alone. */
export type WorktreeMap = Record<string, Worktree[]>;

const q = encodeURIComponent;

async function listWorktrees(repo: RepoEntry): Promise<Worktree[]> {
  const fallback = [{ path: repo.path, head: "", branch: null }];
  try {
    const res = await fetch(`/api/git/worktrees?repo=${q(repo.path)}`);
    if (!res.ok) return fallback;
    const list = (await res.json()) as Worktree[] | null;
    return Array.isArray(list) && list.length ? list : fallback;
  } catch {
    return fallback;
  }
}

/** Worktrees of every present repo; a missing repo is never queried. */
export function useWorktrees(repos: RepoEntry[]): WorktreeMap {
  // Each listing remembers the repo identity it was made for.
  const [lists, setLists] = useState<Record<string, { id: string; list: Worktree[] }>>({});
  const id = (r: RepoEntry) => `${r.path}\0${r.present ? 1 : 0}`;
  const key = repos.map((r) => `${r.name}\0${id(r)}`).join("\n");
  useEffect(() => {
    let cancelled = false;
    for (const repo of repos.filter((r) => r.present)) {
      listWorktrees(repo).then((list) => !cancelled && setLists((m) => ({ ...m, [repo.name]: { id: id(repo), list } })));
    }
    return () => {
      cancelled = true;
    };
    // Keyed on the repo identities, not the array instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // Not reset on a key change: a still-valid listing stays, so the open checkout is not unmounted.
  return useMemo(() => {
    const map: WorktreeMap = {};
    for (const r of repos) {
      const entry = lists[r.name];
      if (r.present && entry?.id === id(r)) map[r.name] = entry.list;
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, lists]);
}

interface Props {
  repos: RepoEntry[];
  worktrees: WorktreeMap;
  /** Open repo name and worktree path (null = its main checkout). */
  repo: string | null;
  wt: string | null;
  onPick: (repo: string, wt: string | null) => void;
  /** Directory the open checkout reads from; null hides Compare with…. */
  root?: string | null;
  /** Ref the tree is compared against, if any. */
  compare?: string | null;
  onCompare?: (ref: string) => void;
}

const branchLabel = (w: Worktree | undefined) => (w ? (w.branch ?? `detached ${w.head.slice(0, 7)}`) : null);

/** Context-slot button + popover: repos grouped, each with its main checkout then its worktrees. */
export default function RefSwitcher({ repos, worktrees, repo, wt, onPick, root = null, compare = null, onCompare }: Props) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [dirty, setDirty] = useState<Record<string, number>>({});
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Uncommitted counts are fetched per open: they go stale quickly and cost a git status each.
  const paths = open ? Object.values(worktrees).flatMap((list) => list.map((w) => w.path)) : [];
  const pathsKey = paths.join("\0");
  useEffect(() => {
    if (!pathsKey) return;
    let cancelled = false;
    for (const path of pathsKey.split("\0")) {
      fetch(`/api/git/status?repo=${q(path)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((list: unknown) => {
          if (!cancelled && Array.isArray(list)) setDirty((d) => ({ ...d, [path]: list.length }));
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [pathsKey]);

  // Refs to compare against, listed per open like the counts above. Keyed on
  // whether compare is offered, not the callback, which is new every render.
  const canCompare = !!onCompare;
  useEffect(() => {
    if (!open || !root || !canCompare) return;
    let cancelled = false;
    fetch(`/api/git/branches?repo=${q(root)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { branches?: unknown } | null) => {
        if (!cancelled && Array.isArray(data?.branches)) setBranches(data.branches.filter((b): b is string => typeof b === "string"));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, root, canCompare]);

  const list = repo ? worktrees[repo] : undefined;
  const current = list ? (wt ? list.find((w) => w.path === wt) : list[0]) : undefined;

  return (
    <div className="cv-sw" ref={rootRef}>
      <button
        type="button"
        className="cv-sw-btn"
        data-testid="repo-switcher"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {repo ? (
          <>
            <span className="pr-repo">{repo}</span>
            {branchLabel(current) && <span className="cv-sw-branch">{branchLabel(current)}</span>}
            <span className="cv-sw-path">{wt ?? current?.path ?? repos.find((r) => r.name === repo)?.path}</span>
          </>
        ) : (
          <span className="cv-sw-path">Pick a repository</span>
        )}
        <span className="cv-sw-car" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="cv-sw-pop" role="dialog" aria-label="Pick a repository or worktree">
          {repos.length === 0 && <p className="cv-msg">This project has no linked repositories.</p>}
          {repos.map((r) => (
            <div key={r.name} className="cv-sw-group" role="group" aria-label={r.name}>
              <div className="cv-sw-head">{r.name}</div>
              {!r.present ? (
                <button type="button" className="cv-sw-row" data-testid={`repo-switcher-missing-${r.name}`} disabled>
                  <span className="cv-sw-path">{r.path}</span>
                  <span className="cv-sw-missing">Not on this machine</span>
                </button>
              ) : !worktrees[r.name] ? (
                <p className="cv-msg">Loading worktrees…</p>
              ) : (
                worktrees[r.name].map((w, i) => {
                  const isCurrent = r.name === repo && (wt ? w.path === wt : i === 0);
                  const n = dirty[w.path];
                  return (
                    <button
                      key={w.path}
                      type="button"
                      className="cv-sw-row"
                      data-testid={`repo-switcher-wt-${w.path}`}
                      aria-current={isCurrent ? "true" : undefined}
                      onClick={() => {
                        setOpen(false);
                        onPick(r.name, i === 0 ? null : w.path);
                      }}
                    >
                      <span className="cv-sw-branch">{branchLabel(w)}</span>
                      {i === 0 && <span className="cv-sw-main">main checkout</span>}
                      <span className="cv-sw-path">{w.path}</span>
                      {n ? <span className="cv-sw-dirty">{n} uncommitted</span> : null}
                    </button>
                  );
                })
              )}
            </div>
          ))}
          {root && onCompare && (
            <div className="cv-sw-group cv-sw-compare">
              <BranchPicker
                branches={branches}
                value={compare ?? ""}
                placeholder="Compare with…"
                align="left"
                testIdPrefix="compare-with"
                triggerClassName="cv-sw-row"
                triggerStyle={{}}
                trigger={<>{compare ? `Comparing with ${compare} — change…` : "Compare with…"}</>}
                onChange={(ref) => {
                  setOpen(false);
                  onCompare(ref);
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
