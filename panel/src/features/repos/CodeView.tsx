import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import FileSearch, { type OpenRequest } from "./FileSearch";
import FileTree, { type TreeFile } from "./FileTree";
import Outline, { OUTLINE_FILE, outlineOf } from "./Outline";
import RefSwitcher, { useWorktrees } from "./RefSwitcher";
import type { ParamsPatch, ReposViewProps } from "./types";
import { useDefinitionNav } from "./useDefinitionNav";
import type { SearchRequest } from "./useSearchShortcut";
import { useWidth } from "./useWidth";
import FileViewer from "./viewer/FileViewer";
import "./Code.css";

const RAIL_MIN_WIDTH = 1100;
const STACK_MAX_WIDTH = 860;

type Loaded = { path: string } & ({ diff?: string; content?: string; binary?: false; error?: string } | { binary: true });

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

async function request(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new HttpError(res.status);
  return res;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const q = encodeURIComponent;

// FileViewer knows three statuses; untracked reads as new, renamed as modified.
const viewerStatus = (s: TreeFile["status"]) => (s === "?" || s === "A" ? "A" : s === "D" ? "D" : s ? "M" : null);

interface RootProps {
  /** Directory every read targets: the repo's main checkout or one of its worktrees. */
  root: string;
  params: URLSearchParams;
  setParams: (patch: ParamsPatch) => void;
  searchRequest: SearchRequest | null;
  onSearchHandled: () => void;
}

/** One checkout's code; keyed by root so a switch drops stale state and responses. */
function RootCode({ root, params, setParams, searchRequest, onSearchHandled }: RootProps) {
  const [attempt, setAttempt] = useState(0);
  const [files, setFiles] = useState<TreeFile[] | { error: string } | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [highlight, setHighlight] = useState<string | undefined>(undefined);
  const [scroll, setScroll] = useState<{ line: number; key: number } | null>(() => {
    const line = Number(params.get("line"));
    return line > 0 ? { line, key: 0 } : null;
  });
  const [bodyRef, width] = useWidth<HTMLDivElement>();

  useEffect(() => {
    let cancelled = false;
    setFiles(null);
    request(`/api/git/tree?repo=${q(root)}`)
      .then(async (res) => ((await res.json()) as { files?: TreeFile[] } | null)?.files ?? [])
      .then((list) => !cancelled && setFiles(list))
      .catch((e: unknown) => !cancelled && setFiles({ error: message(e) }));
    return () => {
      cancelled = true;
    };
  }, [root, attempt]);

  const list = Array.isArray(files) ? files : null;
  const byPath = useMemo(() => new Map((list ?? []).map((f) => [f.path, f])), [list]);
  const paths = useMemo(() => (list ?? []).map((f) => f.path), [list]);
  const selected = params.get("file");
  const entry = selected ? byPath.get(selected) : undefined;
  const status = entry?.status ?? null;

  useEffect(() => {
    // Status comes from the tree, so wait for it before choosing what to read.
    if (!list || !selected) return;
    let cancelled = false;
    const path = selected;
    (async (): Promise<Loaded> => {
      const diff = status
        ? ((await (await request(`/api/git/diff?file=${q(path)}&repo=${q(root)}`)).json()) as { diff?: string } | null)?.diff
        : undefined;
      if (status === "D") return { path, diff };
      try {
        const content = await (await request(`/api/git/file?repo=${q(root)}&path=${q(path)}`)).text();
        return { path, diff, content };
      } catch (e) {
        if (e instanceof HttpError && e.status === 415) return { path, binary: true };
        throw e;
      }
    })()
      .then((l) => !cancelled && setLoaded(l))
      .catch((e: unknown) => !cancelled && setLoaded({ path, error: message(e) }));
    return () => {
      cancelled = true;
    };
  }, [list, selected, status, root]);

  const open = useCallback(
    (path: string, at: OpenRequest = {}) => {
      setHighlight(at.highlight || undefined);
      setScroll((s) => (at.line ? { line: at.line, key: (s?.key ?? 0) + 1 } : null));
      setParams({ file: path, line: at.line ? String(at.line) : null });
    },
    [setParams],
  );
  const openAt = useCallback((path: string, line: number) => open(path, { line }), [open]);
  const nav = useDefinitionNav({ root, file: selected, open: openAt });
  const jump = (line: number) => {
    setScroll((s) => ({ line, key: (s?.key ?? 0) + 1 }));
    setParams({ line: String(line) });
  };

  const showRail = width === null || width >= RAIL_MIN_WIDTH;
  const stack = width !== null && width < STACK_MAX_WIDTH;
  const current = loaded && loaded.path === selected ? loaded : null;
  const content = current && !current.binary && !current.error ? current.content : undefined;
  const outline = useMemo(
    () => (selected && content != null && OUTLINE_FILE.test(selected) ? outlineOf(content) : null),
    [selected, content],
  );

  let tree: ReactNode;
  if (files && !Array.isArray(files))
    tree = (
      <p className="cv-msg" role="alert">
        Couldn't list files ({files.error}).{" "}
        <button type="button" data-testid="code-tree-retry" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
      </p>
    );
  else if (!list) tree = <p className="cv-msg">Listing files…</p>;
  else tree = <FileTree files={list} selected={selected ?? undefined} onSelect={(p) => open(p)} aria-label="Repository files" />;

  let viewer: ReactNode;
  if (!selected) viewer = <p className="fv-empty">Pick a file from the tree, or press Ctrl+P.</p>;
  else if (!current) viewer = <p className="fv-empty">Loading {selected}…</p>;
  else if (current.binary) viewer = <p className="fv-empty">{selected} is a binary file and can't be shown.</p>;
  else if (current.error) viewer = <p className="fv-empty" role="alert">Couldn't load {selected} ({current.error}).</p>;
  else
    viewer = (
      <FileViewer
        key={current.path}
        path={current.path}
        diff={current.diff}
        content={current.content}
        status={viewerStatus(status)}
        uncommitted={!!status}
        defaultMode="code"
        highlight={highlight}
        onIdentifierClick={nav.onIdentifierClick}
        scrollToLine={scroll?.line}
        scrollKey={scroll?.key}
      />
    );

  return (
    <div ref={bodyRef} className={`cv-body${showRail ? "" : " cv-norail"}${stack ? " cv-stack" : ""}`} data-testid="code-body">
      <div className="cv-side">
        <FileSearch root={root} paths={paths} request={searchRequest} onRequestHandled={onSearchHandled} onOpen={open} />
        <div className="cv-tree">{tree}</div>
      </div>
      <div className="cv-main">
        <div className="cv-backbar" data-testid="code-backbar">
          <button type="button" data-testid="code-back" disabled={!nav.canBack} onClick={nav.back}>
            ← Back
          </button>
          {nav.notice && (
            <span className="cv-notice" role="status">
              No definition found
            </span>
          )}
          {nav.choices && (
            <div className="cv-defs">
              <div role="listbox" aria-label="Definitions">
                {nav.choices.map((d) => (
                  <button
                    key={`${d.path}:${d.line}:${d.col}`}
                    type="button"
                    role="option"
                    aria-selected={false}
                    data-testid={`code-def-${d.path}:${d.line}:${d.col}`}
                    onClick={() => nav.choose(d)}
                  >
                    {d.path}:{d.line}
                  </button>
                ))}
              </div>
              <button type="button" data-testid="code-defs-close" aria-label="Close definitions" onClick={nav.dismiss}>
                ×
              </button>
            </div>
          )}
        </div>
        <div className="cv-viewer">{viewer}</div>
      </div>
      {showRail && <Outline items={outline} onJump={jump} />}
    </div>
  );
}

/** Browse a linked repo or one of its worktrees: switcher in the context slot, search + tree, viewer, outline. */
export default function CodeView({ repos, params, setParams, contextSlot, searchRequest, onSearchHandled }: ReposViewProps) {
  const worktrees = useWorktrees(repos);
  const named = params.get("repo");
  const repo = (named ? repos.find((r) => r.name === named) : undefined) ?? repos.find((r) => r.present);
  const wt = params.get("wt");
  const root = repo?.present ? (wt ?? repo.path) : null;

  const pick = (name: string, path: string | null) => setParams({ repo: name, wt: path, file: null, line: null });

  let body: ReactNode;
  if (repos.length === 0) body = <p className="cv-msg">This project has no linked repositories.</p>;
  else if (!repo) body = <p className="cv-msg">None of this project's linked repositories are on this machine.</p>;
  else if (!root) body = <p className="cv-msg">{repo.name} is not on this machine. Pick another repository above.</p>;
  else
    body = (
      <RootCode
        key={root}
        root={root}
        params={params}
        setParams={setParams}
        searchRequest={searchRequest}
        onSearchHandled={onSearchHandled}
      />
    );

  return (
    <div className="cv" data-testid="code-view">
      {contextSlot &&
        createPortal(
          <RefSwitcher repos={repos} worktrees={worktrees} repo={repo?.name ?? null} wt={wt} onPick={pick} />,
          contextSlot,
        )}
      {body}
    </div>
  );
}
