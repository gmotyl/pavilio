import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import FileSearch, { type OpenRequest } from "./FileSearch";
import FileTree, { type TreeFile } from "./FileTree";
import { useCommitFiles, type Commit } from "../git/useGitHistory";
import { useWebSocket } from "../realtime/useWebSocket";
import ChangesPanel from "./ChangesPanel";
import HistoryPanel from "./HistoryPanel";
import Outline, { OUTLINE_FILE, outlineOf } from "./Outline";
import RefSwitcher, { useWorktrees } from "./RefSwitcher";
import type { ParamsPatch, ReposViewProps } from "./types";
import { useDefinitionNav, type DefinitionLocation } from "./useDefinitionNav";
import type { SearchRequest } from "./useSearchShortcut";
import { useWidth } from "./useWidth";
import { tooLargeMessage, tooLargeSize } from "./tooLarge";
import FileViewer from "./viewer/FileViewer";
import "./Code.css";

const RAIL_MIN_WIDTH = 1100;
const STACK_MAX_WIDTH = 860;

type Loaded = { path: string } & (
  | { diff?: string; content?: string; binary?: false; tooLarge?: false; error?: string }
  | { binary: true; tooLarge?: false }
  | { tooLarge: true; size?: number; binary?: false }
);

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly res: Response,
  ) {
    super(`HTTP ${status}`);
  }
}

async function request(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new HttpError(res.status, res);
  return res;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const q = encodeURIComponent;

// FileViewer knows three statuses; untracked reads as new, renamed as modified.
const viewerStatus = (s: TreeFile["status"]) => (s === "?" || s === "A" ? "A" : s === "D" ? "D" : s ? "M" : null);

interface ChooserProps {
  choices: DefinitionLocation[];
  onChoose: (d: DefinitionLocation) => void;
  onDismiss: () => void;
}

/** Plain list of buttons: Tab moves through it, Escape or an outside click closes it. */
function DefinitionChooser({ choices, onChoose, onDismiss }: ChooserProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector("button")?.focus();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onDismiss]);
  return (
    <div className="cv-defs" ref={ref}>
      <div className="cv-defs-list" role="group" aria-label="Definitions">
        {choices.map((d) => (
          <button key={`${d.path}:${d.line}:${d.col}`} type="button" data-testid={`code-def-${d.path}:${d.line}:${d.col}`} onClick={() => onChoose(d)}>
            {d.path}:{d.line}
          </button>
        ))}
      </div>
      <button type="button" data-testid="code-defs-close" aria-label="Close definitions" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}

interface RootProps {
  /** Directory every read targets: the repo's main checkout or one of its worktrees. */
  root: string;
  params: URLSearchParams;
  setParams: (patch: ParamsPatch) => void;
  searchRequest: SearchRequest | null;
  onSearchHandled: () => void;
}

type Panel = "outline" | "changes" | "history";
type Listing = TreeFile[] | { error: string } | null;

// Commit-file and compare statuses onto the tree's letters; copies and type changes read as modified.
const treeStatus = (s: string): TreeFile["status"] => (s === "A" || s === "D" || s === "R" ? s : "M");

/** One checkout's code; keyed by root so a switch drops stale state and responses. */
function RootCode({ root, params, setParams, searchRequest, onSearchHandled }: RootProps) {
  const [attempt, setAttempt] = useState(0);
  const [files, setFiles] = useState<Listing>(null);
  // `pin`: base and HEAD resolved once per comparison; every compare read uses these shas.
  const [compared, setCompared] = useState<{ base: string; files: Listing; pin?: { base: string; head: string } } | null>(null);
  const [loaded, setLoaded] = useState<(Loaded & { src: string }) | null>(null);
  const [panel, setPanel] = useState<Panel>("outline");
  const [commit, setCommit] = useState<Commit | null>(null);
  const [highlight, setHighlight] = useState<string | undefined>(undefined);
  const [scroll, setScroll] = useState<{ line: number; key: number } | null>(() => {
    const line = Number(params.get("line"));
    return line > 0 ? { line, key: 0 } : null;
  });
  const [bodyRef, width] = useWidth<HTMLDivElement>();
  const askedCmp = params.get("cmp");
  const cmp = commit ? null : askedCmp;
  const { files: commitFiles, error: commitError, loading: commitLoading } = useCommitFiles(root, commit?.sha ?? null, attempt);
  const { lastMessage } = useWebSocket();

  // Commits and auto-sync elsewhere change the tree; sync-status ticks don't.
  useEffect(() => {
    if (lastMessage?.type === "git-change") setAttempt((n) => n + 1);
  }, [lastMessage]);

  // Asking to compare wins over a picked commit, so the compare shows.
  useEffect(() => {
    if (askedCmp) setCommit(null);
  }, [askedCmp]);

  useEffect(() => {
    let cancelled = false;
    // No reset to null here: a refresh after a commit keeps the tree in place.
    request(`/api/git/tree?repo=${q(root)}`)
      .then(async (res) => ((await res.json()) as { files?: TreeFile[] } | null)?.files ?? [])
      .then((list) => !cancelled && setFiles(list))
      .catch((e: unknown) => !cancelled && setFiles({ error: message(e) }));
    return () => {
      cancelled = true;
    };
  }, [root, attempt]);

  useEffect(() => {
    if (!cmp) return;
    let cancelled = false;
    const base = cmp;
    const resolve = async (ref: string) => ((await (await request(`/api/git/resolve?repo=${q(root)}&ref=${q(ref)}`)).json()) as { sha: string }).sha;
    // Pinned first: a checkout or commit mid-compare must not mix two versions of a file.
    (async () => {
      const [baseSha, headSha] = await Promise.all([resolve(base), resolve("HEAD")]);
      // HEAD's files with base...HEAD statuses; deletions are absent at HEAD so they are appended.
      const [atHead, changed] = await Promise.all([
        request(`/api/git/tree?repo=${q(root)}&ref=${headSha}`).then(async (res) => ((await res.json()) as { files?: TreeFile[] } | null)?.files ?? []),
        request(`/api/git/changed?repo=${q(root)}&base=${baseSha}&head=${headSha}`).then(
          async (res) => ((await res.json()) as { path: string; status: string; add: number; del: number }[] | null) ?? [],
        ),
      ]);
      const byPath = new Map(changed.map((c) => [c.path, { ...c, status: treeStatus(c.status) }]));
      const merged: TreeFile[] = atHead.map((f) => byPath.get(f.path) ?? { path: f.path, status: null });
      const seen = new Set(atHead.map((f) => f.path));
      return { files: [...merged, ...[...byPath.values()].filter((c) => !seen.has(c.path))], pin: { base: baseSha, head: headSha } };
    })()
      .then(({ files: list, pin }) => !cancelled && setCompared({ base, files: list, pin }))
      .catch((e: unknown) => !cancelled && setCompared({ base, files: { error: message(e) } }));
    return () => {
      cancelled = true;
    };
  }, [root, cmp, attempt]);

  const commitList = useMemo<TreeFile[] | null>(
    () => (commit && !commitLoading && !commitError ? commitFiles.map((f) => ({ path: f.path, status: treeStatus(f.status) })) : null),
    [commit, commitLoading, commitError, commitFiles],
  );
  const working = Array.isArray(files) ? files : null;
  const changedCount = working ? working.filter((f) => f.status).length : 0;
  const shown: Listing = commit ? (commitError ? { error: commitError } : commitList) : cmp ? (compared?.base === cmp ? compared.files : null) : files;
  const list = Array.isArray(shown) ? shown : null;
  const pin = cmp && compared?.base === cmp ? compared.pin : undefined;
  // Identifies where reads come from, so a mode switch never shows the previous mode's answer.
  const src = commit ? `commit:${commit.sha}` : cmp ? `cmp:${cmp}` : "work";

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
    const ref = commit ? commit.sha : cmp ? (pin?.head ?? null) : null;
    // A listed compare always carries its pin; without one there is nothing consistent to read.
    if (cmp && !commit && !pin) return;
    (async (): Promise<Loaded> => {
      let diff: string | undefined;
      if (commit) diff = ((await (await request(`/api/git/diff?sha=${commit.sha}&file=${q(path)}&repo=${q(root)}`)).json()) as { diff?: string } | null)?.diff;
      else if (pin && status) diff = await (await request(`/api/git/diff-ref?repo=${q(root)}&base=${pin.base}&head=${pin.head}&path=${q(path)}`)).text();
      // Against HEAD so staged edits count as uncommitted too.
      else if (status) {
        const head = (await (await request(`/api/git/diff?file=${q(path)}&repo=${q(root)}&against=HEAD`)).json()) as { diff?: string; tooLarge?: boolean; size?: number; binary?: boolean } | null;
        // Untracked past the diff cap or binary: reading it whole would stall or fail anyway.
        if (head?.tooLarge) return { path, tooLarge: true, size: head.size };
        if (head?.binary) return { path, binary: true };
        diff = head?.diff;
      }
      if (status === "D") return { path, diff };
      try {
        const content = await (await request(`/api/git/file?repo=${q(root)}${ref ? `&ref=${q(ref)}` : ""}&path=${q(path)}`)).text();
        return { path, diff, content };
      } catch (e) {
        if (e instanceof HttpError && e.status === 415) return { path, binary: true };
        // A patch in hand outranks the whole file (huge file, submodule pointer): Diff still shows it.
        if (diff && e instanceof HttpError && (e.status === 413 || e.status === 404)) return { path, diff };
        if (e instanceof HttpError && e.status === 413) return { path, tooLarge: true, size: await tooLargeSize(e.res) };
        throw e;
      }
    })()
      .then((l) => !cancelled && setLoaded({ ...l, src }))
      .catch((e: unknown) => !cancelled && setLoaded({ path, error: message(e), src }));
    return () => {
      cancelled = true;
    };
    // `src` names commit/cmp; listing them too would refetch on identity alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, selected, status, root, src]);

  const open = useCallback(
    (path: string, at: OpenRequest = {}, patch: ParamsPatch = {}) => {
      // Text hits come from the working tree: show that, not a commit or compare missing the line.
      if (at.working) {
        setCommit(null);
        patch = { ...patch, cmp: null };
      }
      // A commit lists only what it touched.
      else if (commitList && !commitList.some((f) => f.path === path)) setCommit(null);
      setHighlight(at.highlight || undefined);
      setScroll((s) => (at.line ? { line: at.line, key: (s?.key ?? 0) + 1 } : null));
      setParams({ ...patch, file: path, line: at.line ? String(at.line) : null });
    },
    [setParams, commitList],
  );
  // Definition jumps and Back carry working-tree coordinates: land in the working tree.
  const openAt = useCallback((path: string, line: number) => open(path, { line, working: true }), [open]);
  const nav = useDefinitionNav({ root, file: selected, open: openAt });
  const jump = (line: number) => {
    setScroll((s) => ({ line, key: (s?.key ?? 0) + 1 }));
    setParams({ line: String(line) });
  };

  // A picked commit opens its first file once the listing lands.
  useEffect(() => {
    if (!commitList?.length || selected) return;
    open(commitList[0].path);
  }, [commitList, selected, open]);

  const leaveCommit = () => {
    setCommit(null);
    setParams({ file: null, line: null });
  };
  const togglePanel = (next: Panel) => {
    const to = panel === next ? "outline" : next;
    if (to !== "history" && commit) leaveCommit();
    setPanel(to);
  };
  const pickCommit = (c: Commit) => {
    setCommit(c);
    setParams({ cmp: null, file: null, line: null });
  };

  const showRail = panel !== "outline" || width === null || width >= RAIL_MIN_WIDTH;
  const stack = width !== null && width < STACK_MAX_WIDTH;
  const current = loaded && loaded.path === selected && loaded.src === src ? loaded : null;
  const content = current && !current.binary && !current.tooLarge && !current.error ? current.content : undefined;
  const outline = useMemo(
    () => (selected && content != null && OUTLINE_FILE.test(selected) ? outlineOf(content) : null),
    [selected, content],
  );

  let tree: ReactNode;
  if (shown && !Array.isArray(shown))
    tree = (
      <p className="cv-msg" role="alert">
        Couldn't list files ({shown.error}).{" "}
        <button
          type="button"
          data-testid="code-tree-retry"
          onClick={() => {
            if (!cmp && !commit) setFiles(null);
            setAttempt((n) => n + 1);
          }}
        >
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
  else if (current.tooLarge) viewer = <p className="fv-empty">{tooLargeMessage(current.size)}</p>;
  else if (current.error) viewer = <p className="fv-empty" role="alert">Couldn't load {selected} ({current.error}).</p>;
  else
    viewer = (
      <FileViewer
        // defaultMode only seeds state: a refresh that loses (or regains) the whole file remounts to re-pick it.
        key={`${src}:${current.path}:${current.content == null ? "patch" : "file"}`}
        path={current.path}
        diff={current.diff}
        content={current.content}
        status={viewerStatus(status)}
        uncommitted={src === "work" && !!status}
        defaultMode={(src !== "work" && status) || (current.content == null && current.diff) ? "diff" : "code"}
        highlight={highlight}
        // Lookups read the working tree, so a commit's or HEAD's lines would resolve the wrong spot.
        onIdentifierClick={src === "work" ? nav.onIdentifierClick : undefined}
        scrollToLine={scroll?.line}
        scrollKey={scroll?.key}
      />
    );

  let rail: ReactNode = null;
  if (panel === "changes")
    // Changes are working-tree edits, so a click leaves compare.
    rail = <ChangesPanel root={root} selected={selected} onOpen={(p) => open(p, {}, { cmp: null })} onChanged={() => setAttempt((n) => n + 1)} />;
  else if (panel === "history") rail = <HistoryPanel root={root} sha={commit?.sha ?? null} onPick={pickCommit} />;
  else if (showRail) rail = <Outline items={outline} onJump={jump} />;

  return (
    <div
      ref={bodyRef}
      className={`cv-body${showRail ? "" : " cv-norail"}${panel !== "outline" ? " cv-widerail" : ""}${stack ? " cv-stack" : ""}`}
      data-testid="code-body"
    >
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
          {nav.choices && <DefinitionChooser choices={nav.choices} onChoose={nav.choose} onDismiss={nav.dismiss} />}
          {commit && (
            <span className="cv-mode" data-testid="code-commit-indicator">
              Commit <code>{commit.shortSha}</code> {commit.message}
              <button type="button" data-testid="code-commit-exit" onClick={leaveCommit}>
                Exit
              </button>
            </span>
          )}
          {cmp && (
            <span className="cv-mode" data-testid="code-compare-indicator">
              Comparing with {cmp}
              <button type="button" data-testid="code-compare-exit" onClick={() => setParams({ cmp: null })}>
                Exit compare
              </button>
            </span>
          )}
          <span className="cv-tools">
            <button type="button" data-testid="code-changes-toggle" aria-pressed={panel === "changes"} onClick={() => togglePanel("changes")}>
              Changes {changedCount}
            </button>
            <button type="button" data-testid="code-history-toggle" aria-pressed={panel === "history"} onClick={() => togglePanel("history")}>
              History
            </button>
          </span>
        </div>
        <div className="cv-viewer">{viewer}</div>
      </div>
      {rail}
    </div>
  );
}

/** Browse a linked repo or one of its worktrees: switcher in the context slot, search + tree, viewer, outline. */
export default function CodeView({ project, repos, params, setParams, contextSlot, searchRequest, onSearchHandled }: ReposViewProps) {
  const worktrees = useWorktrees(repos);
  const named = params.get("repo");
  // Older links carry the repo's path instead of its name.
  const byName = named ? (repos.find((r) => r.name === named) ?? repos.find((r) => r.path === named)) : undefined;
  const repo = byName ?? repos.find((r) => r.present);
  const legacy = !!byName && byName.name !== named;
  const unknown = !!named && repos.length > 0 && !byName;
  const asked = params.get("wt");
  const listed = repo ? worktrees[repo.name] : undefined;
  // The URL is untrusted: only a listed worktree of this repo is ever read.
  const wt = asked && listed?.some((w) => w.path === asked) ? asked : null;
  const waiting = !!asked && !!repo?.present && !listed;
  const root = repo?.present && !waiting ? (wt ?? repo.path) : null;

  // A path becomes the name; an unknown repo drops its file rather than open it in the fallback repo.
  useEffect(() => {
    if (legacy && byName) setParams({ repo: byName.name });
    else if (unknown) setParams({ repo: null, wt: null, file: null, line: null, cmp: null });
  }, [legacy, unknown, byName, setParams]);

  // Pin a defaulted repo in the URL: a later presence change (a clone) must not move this tab to another repo.
  const defaulted = !named && repo ? repo.name : null;
  useEffect(() => {
    if (defaulted) setParams({ repo: defaulted });
  }, [defaulted, setParams]);

  const stale = !!asked && !!listed && !wt;
  // Drop a wt the listing doesn't know, so the URL matches what is shown.
  useEffect(() => {
    if (stale) setParams({ wt: null });
  }, [stale, setParams]);

  const pick = (name: string, path: string | null) => setParams({ repo: name, wt: path, file: null, line: null, cmp: null });

  let body: ReactNode;
  if (repos.length === 0) body = <p className="cv-msg">This project has no linked repositories.</p>;
  else if (!repo) body = <p className="cv-msg">None of this project's linked repositories are on this machine.</p>;
  else if (waiting) body = <p className="cv-msg">Listing worktrees…</p>;
  else if (!root) body = <p className="cv-msg">{repo.name} is not on this machine. Pick another repository above.</p>;
  else if (unknown) body = null;
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
          <RefSwitcher
            project={project}
            repos={repos}
            worktrees={worktrees}
            repo={repo?.name ?? null}
            wt={wt}
            onPick={pick}
            root={root}
            compare={params.get("cmp")}
            onCompare={(ref) => setParams({ cmp: ref })}
          />,
          contextSlot,
        )}
      {body}
    </div>
  );
}
