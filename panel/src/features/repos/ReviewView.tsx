import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ChecksState } from "../../../server/lib/prs/provider";
import ChangeRail from "./ChangeRail";
import FileTree, { type TreeFile } from "./FileTree";
import PrSwitcher from "./PrSwitcher";
import { prKey } from "./PrRow";
import type { ParamsPatch, ReposViewProps } from "./types";
import type { PullRequest } from "./usePrs";
import { useWidth } from "./useWidth";
import FileViewer from "./viewer/FileViewer";
import "./Review.css";

const RAIL_MIN_WIDTH = 1100;
const STACK_MAX_WIDTH = 860;

interface ChangedFile {
  path: string;
  status: "M" | "A" | "D" | "R";
  add: number;
  del: number;
}

type Opened =
  | { status: "loading" }
  | { status: "error"; stage: "open" | "changed"; error: string }
  | { status: "ready"; head: string; base: string; changed: ChangedFile[] };

type Loaded = { path: string } & ({ diff?: string; content?: string; binary?: false; error?: string } | { binary: true });

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok) throw new HttpError(res.status);
  return res;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const q = encodeURIComponent;
const prRef = (n: number) => `refs/pavilio/pr/${n}`;

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
  pr: PullRequest;
  me: string | null;
  params: URLSearchParams;
  setParams: (patch: ParamsPatch) => void;
}

/** One PR's review; keyed by PR so switching starts from a clean slate and drops stale responses. */
function PrReview({ pr, me, params, setParams }: ReviewProps) {
  const [attempt, setAttempt] = useState(0);
  const [opened, setOpened] = useState<Opened>({ status: "loading" });
  const [changedOnly, setChangedOnly] = useState(true);
  const [whole, setWhole] = useState<TreeFile[] | { error: string } | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [scroll, setScroll] = useState<{ line: number; key: number } | null>(() => {
    const line = Number(params.get("line"));
    return line > 0 ? { line, key: 0 } : null;
  });
  const [bodyRef, width] = useWidth<HTMLDivElement>();

  useEffect(() => {
    let cancelled = false;
    let stage: "open" | "changed" = "open";
    setOpened({ status: "loading" });
    (async () => {
      const res = await request("/api/prs/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: pr.repoPath, number: pr.number }),
      });
      const { head, base } = (await res.json()) as { head: string; base: string };
      // Unmounted for another PR: skip the follow-up request.
      if (cancelled) return;
      stage = "changed";
      const changed = (await (await request(`/api/git/changed?repo=${q(pr.repoPath)}&base=${q(base)}&head=${q(head)}`)).json()) as ChangedFile[];
      if (!cancelled) setOpened({ status: "ready", head, base, changed });
    })().catch((e: unknown) => {
      if (!cancelled) setOpened({ status: "error", stage, error: message(e) });
    });
    return () => {
      cancelled = true;
    };
  }, [pr.repoPath, pr.number, attempt]);

  const ready = opened.status === "ready" ? opened : null;

  useEffect(() => {
    if (changedOnly || !ready || whole) return;
    let cancelled = false;
    request(`/api/git/tree?repo=${q(pr.repoPath)}&ref=${q(prRef(pr.number))}`)
      .then(async (res) => ((await res.json()) as { files: TreeFile[] }).files)
      .then((files) => !cancelled && setWhole(files))
      .catch((e: unknown) => !cancelled && setWhole({ error: message(e) }));
    return () => {
      cancelled = true;
    };
  }, [changedOnly, ready, whole, pr.repoPath, pr.number]);

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

  const selected = params.get("file") ?? ready?.changed[0]?.path ?? null;
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
        const content = await (await request(`/api/git/file?repo=${q(pr.repoPath)}&ref=${q(prRef(pr.number))}&path=${q(path)}`)).text();
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
  }, [ready, selected, change, pr.repoPath, pr.number]);

  const select = (path: string) => {
    setScroll(null);
    setParams({ file: path, line: null });
  };
  const jump = (line: number) => {
    setScroll((s) => ({ line, key: (s?.key ?? 0) + 1 }));
    setParams({ line: String(line) });
  };

  const showRail = width === null || width >= RAIL_MIN_WIDTH;
  const stack = width !== null && width < STACK_MAX_WIDTH;
  const current = loaded && loaded.path === selected ? loaded : null;

  let tree: ReactNode;
  if (opened.status === "error")
    tree = (
      <div className="rv-msg" role="alert">
        {opened.stage === "open" ? "Couldn't fetch this PR's branch." : "Couldn't load this PR's changes."}{" "}
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
        <FileTree files={files} selected={selected ?? undefined} onSelect={select} changedOnly={changedOnly} aria-label="Pull request files" />
      </>
    );

  let viewer: ReactNode;
  if (!ready) viewer = null;
  else if (!selected) viewer = <p className="fv-empty">This pull request changes no files.</p>;
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
        status={change?.status === "R" ? "M" : change?.status}
        counts={change ? { add: change.add, del: change.del } : undefined}
        defaultMode={change ? "diff" : "code"}
        scrollToLine={scroll?.line}
        scrollKey={scroll?.key}
      />
    );

  return (
    <>
      <PrHeader pr={pr} me={me} />
      <div
        ref={bodyRef}
        className={`rv-body${showRail ? "" : " rv-norail"}${stack ? " rv-stack" : ""}`}
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
          {tree}
        </div>
        <div className="rv-main">{viewer}</div>
        {showRail && <ChangeRail diff={current && !current.binary ? current.diff : undefined} deleted={change?.status === "D"} onJump={jump} />}
      </div>
    </>
  );
}

/** Read-only PR review: switcher in the context slot, header, changed-files tree, viewer and change rail. */
export default function ReviewView({ project, prs, filter, setFilter, params, setParams, contextSlot }: ReposViewProps) {
  const key = params.get("pr");
  const pr = key ? prs.all.find((p) => prKey(p) === key) : undefined;

  const pick = (picked: PullRequest) => setParams({ pr: prKey(picked), file: null, line: null });

  let body: ReactNode;
  if (!key) body = <p className="rv-msg">Pick a pull request from the switcher above.</p>;
  else if (pr) body = <PrReview key={prKey(pr)} pr={pr} me={prs.me} params={params} setParams={setParams} />;
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
