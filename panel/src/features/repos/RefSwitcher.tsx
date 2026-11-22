import { useEffect, useRef, useState } from "react";
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
  const [map, setMap] = useState<WorktreeMap>({});
  const key = repos.map((r) => `${r.name}\0${r.path}\0${r.present ? 1 : 0}`).join("\n");
  useEffect(() => {
    let cancelled = false;
    setMap({});
    for (const repo of repos.filter((r) => r.present)) {
      listWorktrees(repo).then((list) => !cancelled && setMap((m) => ({ ...m, [repo.name]: list })));
    }
    return () => {
      cancelled = true;
    };
    // Keyed on the repo identities, not the array instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return map;
}

interface Props {
  repos: RepoEntry[];
  worktrees: WorktreeMap;
  /** Open repo name and worktree path (null = its main checkout). */
  repo: string | null;
  wt: string | null;
  onPick: (repo: string, wt: string | null) => void;
}

const branchLabel = (w: Worktree | undefined) => (w ? (w.branch ?? `detached ${w.head.slice(0, 7)}`) : null);

/** Context-slot button + popover: repos grouped, each with its main checkout then its worktrees. */
export default function RefSwitcher({ repos, worktrees, repo, wt, onPick }: Props) {
  const [open, setOpen] = useState(false);
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
        </div>
      )}
    </div>
  );
}
