import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ChecksState, ReviewComment } from "../../../server/lib/prs/provider";
import FileTree, { type TreeFile } from "./FileTree";
import PrDescription, { prSpeechKey } from "./PrDescription";
import PrSwitcher from "./PrSwitcher";
import { prKey } from "./PrRow";
import type { ParamsPatch, ReposViewProps } from "./types";
import { commentCount, groupThreads, type ReviewThread } from "./reviewThreads";
import type { PullRequest } from "./usePrs";
import { useWidth } from "./useWidth";
import { tooLargeMessage, tooLargeSize } from "./tooLarge";
import FileViewer from "./viewer/FileViewer";
import "./Review.css";

const STACK_MAX_WIDTH = 860;

interface ChangedFile {
  path: string;
  status: "M" | "A" | "D" | "R";
  add: number;
  del: number;
}

type Opened =
  | { status: "loading" }
  | { status: "error"; stage: "open" | "changed" | "history"; error: string }
  | { status: "ready"; head: string; base: string; changed: ChangedFile[] };

/** The PR description: null while `open` is in flight, failed when it errored before answering. */
type Description = string | null | { failed: true };

/** Review comments: null while loading; a failure keeps the review usable without markers. */
type Comments = ReviewComment[] | { error: string } | null;

// One empty map: the comment lane stays put while comments load or after they fail.
const NO_THREADS: Map<string, ReviewThread> = new Map();

type Loaded = { path: string } & (
  | { diff?: string; content?: string; binary?: false; tooLarge?: false; error?: string; codeNote?: string }
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

async function request(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok) throw new HttpError(res.status, res);
  return res;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const q = encodeURIComponent;

const CHECKS: Partial<Record<ChecksState, [string, string]>> = {
  pass: ["✓", "Checks passed"],
  fail: ["✕", "Checks failing"],
  running: ["●", "Checks running"],
};

function PrHeader({ pr, me }: { pr: PullRequest; me: string | null }) {
  const chk = CHECKS[pr.checks];
  return (
    <header className="rv-head" data-testid="review-header">
      <h2>
        {pr.title} <span className="rv-num">#{pr.number}</span>
      </h2>
      <div className="rv-head-row">
        <span className={`rv-state${pr.isDraft ? " rv-state-draft" : ""}`}>{pr.isDraft ? "Draft" : "Open"}</span>
        <span>
          <b>{pr.author === me ? "you" : pr.author}</b> wants to merge <code className="rv-ref">{pr.head}</code> into{" "}
          <code className="rv-ref">{pr.base}</code>
        </span>
        {chk && (
          <span className={`pr-chk pr-chk-${pr.checks}`}>
            {chk[0]} {chk[1]}
          </span>
        )}
        <a className="rv-ext" href={pr.url} target="_blank" rel="noopener noreferrer">
          Open on GitHub ↗
        </a>
      </div>
    </header>
  );
}

interface ReviewProps {
  project: string;
  pr: PullRequest;
  me: string | null;
  params: URLSearchParams;
  setParams: (patch: ParamsPatch) => void;
}

/** One PR's review; keyed by PR so switching starts from a clean slate and drops stale responses. */
function PrReview({ project, pr, me, params, setParams }: ReviewProps) {
  const [attempt, setAttempt] = useState(0);
  const [opened, setOpened] = useState<Opened>({ status: "loading" });
  const [description, setDescription] = useState<Description>(null);
  const [changedOnly, setChangedOnly] = useState(true);
  const [whole, setWhole] = useState<TreeFile[] | { error: string } | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [comments, setComments] = useState<Comments>(null);
  const [commentsAttempt, setCommentsAttempt] = useState(0);
  // Bound to its file: a line is meaningless on another one. A link's line
  // without a file (old links opened the first file) is ignored.
  const [scroll, setScroll] = useState<{ line: number; side?: "old" | "new"; key: number; file: string } | null>(() => {
    const line = Number(params.get("line"));
    const file = params.get("file");
    return line > 0 && file ? { line, key: 0, file } : null;
  });
  const [bodyRef, width] = useWidth<HTMLDivElement>();

  useEffect(() => {
    let cancelled = false;
    let stage: "open" | "changed" = "open";
    setOpened({ status: "loading" });
    // A retry asks again for a description that failed; one already shown stays.
    setDescription((d) => (typeof d === "string" ? d : null));
    let answered = false;
    (async () => {
      const res = await request("/api/prs/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: pr.repoPath, number: pr.number }),
      });
      const { head, base, body } = (await res.json()) as { head: string; base: string; body?: string };
      // Unmounted for another PR: skip the follow-up request.
      if (cancelled) return;
      answered = true;
      setDescription(body ?? "");
      stage = "changed";
      const changed = (await (await request(`/api/git/changed?repo=${q(pr.repoPath)}&base=${q(base)}&head=${q(head)}`)).json()) as ChangedFile[];
      if (!cancelled) setOpened({ status: "ready", head, base, changed });
    })().catch(async (e: unknown) => {
      // No merge base: a shallow clone missing history; re-opening deepens it, a plain retry would not.
      const code = e instanceof HttpError ? ((await e.res.json().catch(() => null)) as { code?: string } | null)?.code : undefined;
      if (cancelled) return;
      setOpened({ status: "error", stage: code === "no-merge-base" ? "history" : stage, error: message(e) });
      if (!answered) setDescription((d) => (typeof d === "string" ? d : { failed: true }));
    });
    return () => {
      cancelled = true;
    };
  }, [pr.repoPath, pr.number, attempt]);

  // Independent of the branch fetch: comments come from GitHub, not the clone.
  useEffect(() => {
    let cancelled = false;
    setComments(null);
    request(`/api/prs/comments?repo=${q(pr.repoPath)}&number=${pr.number}`)
      .then(async (res) => (await res.json()) as ReviewComment[])
      .then((list) => !cancelled && setComments(list))
      .catch((e: unknown) => !cancelled && setComments({ error: message(e) }));
    return () => {
      cancelled = true;
    };
  }, [pr.repoPath, pr.number, commentsAttempt]);

  const threads = useMemo(() => (Array.isArray(comments) ? groupThreads(comments) : null), [comments]);

  const ready = opened.status === "ready" ? opened : null;

  useEffect(() => {
    if (changedOnly || !ready || whole) return;
    let cancelled = false;
    // The SHA `open` resolved, not the PR ref: another tab re-opening the PR
    // moves the ref, and the review must stay on one revision.
    request(`/api/git/tree?repo=${q(pr.repoPath)}&ref=${q(ready.head)}`)
      .then(async (res) => ((await res.json()) as { files: TreeFile[] }).files)
      .then((files) => !cancelled && setWhole(files))
      .catch((e: unknown) => !cancelled && setWhole({ error: message(e) }));
    return () => {
      cancelled = true;
    };
  }, [changedOnly, ready, whole, pr.repoPath]);

  const changedByPath = useMemo(() => new Map((ready?.changed ?? []).map((f) => [f.path, f])), [ready]);

  const files = useMemo<TreeFile[]>(() => {
    const changed = ready?.changed ?? [];
    if (changedOnly || !Array.isArray(whole)) return changed;
    const seen = new Set<string>();
    const merged = whole.map((f) => {
      seen.add(f.path);
      return changedByPath.get(f.path) ?? f;
    });
    // Deleted files are absent at head but still part of the review.
    return [...merged, ...changed.filter((f) => !seen.has(f.path))];
  }, [ready, changedOnly, whole, changedByPath]);

  const counted = useMemo<TreeFile[]>(() => {
    if (!threads) return files;
    return files.map((f) => {
      const n = commentCount(threads.get(f.path));
      return n > 0 ? { ...f, comments: n } : f;
    });
  }, [files, threads]);

  // No file: the Description entry.
  const selected = params.get("file") || null;
  const change = selected ? changedByPath.get(selected) : undefined;

  useEffect(() => {
    if (!ready || !selected) return;
    let cancelled = false;
    const path = selected;
    (async (): Promise<Loaded> => {
      const diff = change
        ? await (await request(`/api/git/diff-ref?repo=${q(pr.repoPath)}&base=${q(ready.base)}&head=${q(ready.head)}&path=${q(path)}`)).text()
        : undefined;
      if (change?.status === "D") return { path, diff };
      try {
        const content = await (await request(`/api/git/file?repo=${q(pr.repoPath)}&ref=${q(ready.head)}&path=${q(path)}`)).text();
        return { path, diff, content };
      } catch (e) {
        if (!(e instanceof HttpError)) throw e;
        if (e.status === 415) return { path, binary: true };
        // A patch already in hand outranks the whole file (huge file, submodule pointer): only Code mode is lost.
        if (diff && (e.status === 413 || e.status === 404)) {
          const why = e.status === 413 ? "too large to load" : "not a readable file at the PR head";
          return { path, diff, codeNote: `The whole file is ${why}; Diff shows the changes.` };
        }
        if (e.status === 413) return { path, tooLarge: true, size: await tooLargeSize(e.res) };
        throw e;
      }
    })()
      .then((l) => !cancelled && setLoaded(l))
      .catch((e: unknown) => !cancelled && setLoaded({ path, error: message(e) }));
    return () => {
      cancelled = true;
    };
  }, [ready, selected, change, pr.repoPath]);

  const select = (path: string | null) => {
    setScroll(null);
    setParams({ file: path, line: null });
  };

  const stack = width !== null && width < STACK_MAX_WIDTH;
  const current = loaded && loaded.path === selected ? loaded : null;
  const scrollHere = scroll && scroll.file === selected ? scroll : null;

  let tree: ReactNode;
  if (opened.status === "error" && opened.stage === "history")
    tree = (
      <div className="rv-msg" role="alert">
        This clone is missing history needed to compare this PR with its base.{" "}
        <button type="button" data-testid="review-fetch-history" onClick={() => setAttempt((n) => n + 1)}>
          Fetch more history
        </button>
      </div>
    );
  else if (opened.status === "error")
    tree = (
      <div className="rv-msg" role="alert">
        {opened.stage === "open" ? "Couldn't fetch this PR's branch" : "Couldn't load this PR's changes"} ({opened.error}).{" "}
        <button type="button" data-testid="review-retry" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
      </div>
    );
  else if (!ready) tree = <p className="rv-msg">Fetching the PR's branch…</p>;
  else
    tree = (
      <>
        {!changedOnly && whole && !Array.isArray(whole) && (
          <p className="rv-msg" role="status">
            Couldn't list the repo at the PR head ({whole.error}).{" "}
            <button type="button" data-testid="review-tree-retry" onClick={() => setWhole(null)}>
              Retry
            </button>
          </p>
        )}
        {changedOnly && ready.changed.length === 0 ? (
          <p className="rv-msg">This pull request changes no files.</p>
        ) : (
          <FileTree files={counted} selected={selected ?? undefined} reveal={ready.changed[0]?.path} onSelect={select} changedOnly={changedOnly} aria-label="Pull request files" />
        )}
      </>
    );

  let viewer: ReactNode;
  if (!selected)
    viewer = <PrDescription project={project} pr={pr} body={typeof description === "object" && description !== null ? undefined : description} />;
  else if (!ready) viewer = null;
  else if (!current) viewer = <p className="fv-empty">Loading {selected}…</p>;
  else if (current.binary) viewer = <p className="fv-empty">{selected} is a binary file and can't be shown.</p>;
  else if (current.tooLarge) viewer = <p className="fv-empty">{tooLargeMessage(current.size)}</p>;
  else if (current.error) viewer = <p className="fv-empty" role="alert">Couldn't load {selected} ({current.error}).</p>;
  else
    viewer = (
      <>
        {current.codeNote && (
          <p className="rv-msg" role="status" data-testid="review-code-note">
            {current.codeNote}
          </p>
        )}
        <FileViewer
          key={current.path}
          path={current.path}
          diff={current.diff}
          content={current.content}
          status={change?.status === "R" ? "M" : change?.status}
          counts={change ? { add: change.add, del: change.del } : undefined}
          defaultMode={change ? "diff" : "code"}
          scrollToLine={scrollHere?.line}
          scrollSide={scrollHere?.side}
          scrollKey={scrollHere?.key}
          comments={threads?.get(current.path) ?? NO_THREADS}
          commentSpeechKey={prSpeechKey(project, pr)}
          me={me}
        />
      </>
    );

  return (
    <>
      <PrHeader pr={pr} me={me} />
      <div
        ref={bodyRef}
        className={`rv-body${stack ? " rv-stack" : ""}`}
        data-testid="review-body"
      >
        <div className="rv-side" data-testid="review-tree">
          <div className="rv-treehead">
            <span>
              at <code className="rv-ref">{pr.head}</code>
            </span>
            <label className="rv-toggle">
              <input type="checkbox" checked={changedOnly} onChange={(e) => {
                  setChangedOnly(e.target.checked);
                  // A failed listing is retried on the next untick rather than sticking.
                  if (whole && !Array.isArray(whole)) setWhole(null);
                }} /> Changed files only
            </label>
          </div>
          {/* A sibling of the tree: neither the branch fetch nor "Changed files only" moves it. */}
          <button
            type="button"
            className="rv-descentry"
            data-testid="review-desc-entry"
            aria-current={selected === null ? "true" : undefined}
            onClick={() => select(null)}
          >
            <span className="rv-descentry-ico" aria-hidden="true">
              ☰
            </span>
            Description
            <span className="rv-descentry-num" aria-hidden="true">
              PR #{pr.number}
            </span>
          </button>
          <hr className="rv-sep" />
          {tree}
        </div>
        <div className="rv-main">
          {comments && !Array.isArray(comments) && (
            <p className="rv-msg" role="status" data-testid="review-comments-note">
              Couldn't load review comments ({comments.error}).{" "}
              <button type="button" data-testid="review-comments-retry" onClick={() => setCommentsAttempt((n) => n + 1)}>
                Retry
              </button>
            </p>
          )}
          {viewer}
        </div>
      </div>
    </>
  );
}

/** Read-only PR review: switcher in the context slot, header, file list led by the PR description, viewer. */
export default function ReviewView({ project, prs, filter, setFilter, params, setParams, contextSlot }: ReposViewProps) {
  const key = params.get("pr");
  const pr = key ? prs.all.find((p) => prKey(p) === key) : undefined;

  const pick = (picked: PullRequest) => setParams({ pr: prKey(picked), file: null, line: null });
  const { revalidate, loading } = prs;
  // A PR opened since the list loaded: refetch rather than call it gone. Once per
  // project + PR, so a slow list for a closed PR can't loop; Retry stays manual.
  const revalidated = useRef<string | null>(null);
  useEffect(() => {
    const once = `${project}\0${key}`;
    if (!key || pr || loading || revalidated.current === once) return;
    revalidated.current = once;
    revalidate();
  }, [project, key, pr, loading, revalidate]);

  let body: ReactNode;
  if (!key) body = <p className="rv-msg">Pick a pull request from the switcher above.</p>;
  // Keyed by the clone, not the display name: a repo repointed under the same
  // name with the same PR number is another PR, and must not keep this one's state.
  else if (pr) body = <PrReview key={`${pr.repoPath}#${pr.number}`} project={project} pr={pr} me={prs.me} params={params} setParams={setParams} />;
  else if (prs.error)
    body = (
      <p className="rv-msg" role="alert">
        Couldn't load pull requests ({prs.error}).{" "}
        <button type="button" data-testid="review-prs-retry" onClick={prs.reload}>
          Retry
        </button>
      </p>
    );
  else if (prs.loading) body = <p className="rv-msg">Loading pull request…</p>;
  else body = <p className="rv-msg">{key} is not an open pull request in this project. Pick another from the switcher above.</p>;

  return (
    <div className="rv" data-testid="review-view">
      {contextSlot &&
        createPortal(
          <PrSwitcher
            project={project}
            prs={prs}
            filter={filter}
            setFilter={setFilter}
            current={pr}
            currentKey={key}
            onPick={pick}
          />,
          contextSlot,
        )}
      {body}
    </div>
  );
}
