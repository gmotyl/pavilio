import { useEffect, useMemo, useRef, useState } from "react";
import { refreshProjects, type RepoEntry } from "../projects/useProjects";
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
  /** Owning project; with a cloneable repo, a missing repo can be cloned. */
  project?: string;
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
  /** A clone succeeded; called before the project list refreshes, so the caller can pin its selection. */
  onCloned?: () => void;
}

/**
 * The row that is the linked path itself (picked as `wt: null`). Usually the main checkout,
 * but a linked path may be a secondary worktree; an unmatched path keeps the first row.
 */
const homeIndex = (list: Worktree[], linked: string | undefined) => Math.max(0, list.findIndex((w) => w.path === linked));

const branchLabel = (w: Worktree | undefined) => (w ? (w.branch ?? `detached ${w.head.slice(0, 7)}`) : null);

type CloneState = "busy" | { error: string } | undefined;

/** A linked repo absent here: its path, and Clone when repos.json names a remote (never sent to the client). */
function MissingRepo({ repo: r, canClone, state, onClone }: { repo: RepoEntry; canClone: boolean; state: CloneState; onClone: () => void }) {
  return (
    <>
      <div className="cv-sw-missing-row">
        <button type="button" className="cv-sw-row" data-testid={`repo-switcher-missing-${r.name}`} disabled>
          <span className="cv-sw-path" title={r.path}>
            {r.path}
          </span>
          <span className="cv-sw-missing">Not on this machine</span>
        </button>
        {canClone && r.cloneable && (
          <button
            type="button"
            className="cv-sw-clone"
            data-testid={`repo-switcher-clone-${r.name}`}
            title={`Clone into ${r.path}`}
            disabled={state === "busy"}
            onClick={onClone}
          >
            {state === "busy" ? "Cloning…" : "Clone"}
          </button>
        )}
      </div>
      {typeof state === "object" && (
        <p className="cv-sw-clone-err" role="alert">
          {state.error}
        </p>
      )}
    </>
  );
}

/** Context-slot button + popover: repos grouped, each with its main checkout then its worktrees. */
export default function RefSwitcher({ project, repos, worktrees, repo, wt, onPick, root = null, compare = null, onCompare, onCloned }: Props) {
  const [open, setOpen] = useState(false);
  // Picking a ref to compare with: the branch list takes over the popover body.
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState("");
  // Keyed by the checkout they were listed for, so another checkout never shows (or picks) them.
  const [listed, setListed] = useState<{ root: string; branches: string[] } | null>(null);
  const [dirty, setDirty] = useState<Record<string, number>>({});
  const [cloning, setCloning] = useState<Record<string, Exclude<CloneState, undefined>>>({});
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
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
        if (!cancelled && Array.isArray(data?.branches))
          setListed({ root, branches: data.branches.filter((b): b is string => typeof b === "string") });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, root, canCompare]);

  const close = () => {
    setOpen(false);
    setPicking(false);
  };

  // Keyed by project too: another project may link a repo of the same name.
  const cloneKey = (name: string) => `${project ?? ""}\0${name}`;
  const clone = async ({ name, path }: RepoEntry) => {
    if (!project) return;
    const key = cloneKey(name);
    setCloning((c) => ({ ...c, [key]: "busy" }));
    let error = "";
    try {
      const res = await fetch("/api/git/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, repo: name, path }),
      });
      if (!res.ok) error = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    if (!error) {
      onCloned?.();
      await refreshProjects();
    }
    setCloning(({ [key]: _, ...rest }) => (error ? { ...rest, [key]: { error } } : rest));
  };

  const branches = listed && listed.root === root ? listed.branches : [];
  const shown = filter ? branches.filter((b) => b.toLowerCase().includes(filter.toLowerCase())) : branches;

  const list = repo ? worktrees[repo] : undefined;
  const current = list ? (wt ? list.find((w) => w.path === wt) : list[homeIndex(list, repos.find((r) => r.name === repo)?.path)]) : undefined;

  return (
    <div className="cv-sw" ref={rootRef}>
      <button
        type="button"
        className="cv-sw-btn"
        data-testid="repo-switcher"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
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
          {root && onCompare && !picking && (
            // Pinned above the scrolling list so a long worktree list never hides it.
            <button
              type="button"
              className="cv-sw-row cv-sw-compare"
              data-testid="compare-with-toggle"
              onClick={() => {
                setFilter("");
                setPicking(true);
              }}
            >
              {compare ? `Comparing with ${compare} — change…` : "Compare with…"}
            </button>
          )}
          {picking && root && onCompare ? (
            <div className="cv-sw-cmp">
              <div className="cv-sw-cmp-head">
                <button type="button" className="cv-sw-cmp-back" data-testid="compare-with-back" onClick={() => setPicking(false)}>
                  ← Worktrees
                </button>
                <input
                  type="search"
                  aria-label="Filter branches"
                  placeholder="Filter branches…"
                  value={filter}
                  autoFocus
                  spellCheck={false}
                  onChange={(e) => setFilter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && shown[0]) {
                      close();
                      onCompare(shown[0]);
                    }
                  }}
                />
              </div>
              <div className="cv-sw-list" role="listbox" aria-label="Compare with" data-testid="compare-with-list">
                {shown.length === 0 && <p className="cv-msg">No matching branches</p>}
                {shown.map((b) => (
                  <button
                    key={b}
                    type="button"
                    role="option"
                    aria-selected={b === compare}
                    className="cv-sw-row"
                    data-testid={`compare-with-option-${b}`}
                    title={b}
                    onClick={() => {
                      close();
                      onCompare(b);
                    }}
                  >
                    <span className="cv-sw-branch">{b}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="cv-sw-list" data-testid="repo-switcher-list">
              {repos.length === 0 && <p className="cv-msg">This project has no linked repositories.</p>}
              {repos.map((r) => (
                <div key={r.name} className="cv-sw-group" role="group" aria-label={r.name}>
                  <div className="cv-sw-head">{r.name}</div>
                  {!r.present ? (
                    <MissingRepo repo={r} canClone={!!project} state={cloning[cloneKey(r.name)]} onClone={() => clone(r)} />
                  ) : !worktrees[r.name] ? (
                    <p className="cv-msg">Loading worktrees…</p>
                  ) : (
                    worktrees[r.name].map((w, i, all) => {
                      const home = i === homeIndex(all, r.path);
                      const isCurrent = r.name === repo && (wt ? w.path === wt : home);
                      const n = dirty[w.path];
                      return (
                        <button
                          key={w.path}
                          type="button"
                          className="cv-sw-row"
                          data-testid={`repo-switcher-wt-${w.path}`}
                          aria-current={isCurrent ? "true" : undefined}
                          onClick={() => {
                            close();
                            onPick(r.name, home ? null : w.path);
                          }}
                        >
                          <span className="cv-sw-line">
                            <span className="cv-sw-branch" title={branchLabel(w) ?? undefined}>
                              {branchLabel(w)}
                            </span>
                            {i === 0 && <span className="cv-sw-main">main checkout</span>}
                            {n ? <span className="cv-sw-dirty">{n} uncommitted</span> : null}
                          </span>
                          <span className="cv-sw-path" title={w.path}>
                            {w.path}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
