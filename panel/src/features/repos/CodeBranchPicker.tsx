import { useEffect, useState } from "react";
import BranchPicker from "../git/BranchPicker";
import type { useBranches } from "../git/useBranches";
import type { useGitChanges } from "../git/useGitChanges";

type Changes = ReturnType<typeof useGitChanges>;
type Branches = ReturnType<typeof useBranches>;

/** Opening the picker fetches only when the last fetch of this checkout is older than this. */
const FETCH_STALE_MS = 30_000;

const ago = (at: number) => {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`;
};

/** Read at its own render, so it is current each time the popover (and with it this) mounts; ticks while shown. */
function FetchedAgo({ at }: { at: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5_000);
    return () => clearInterval(id);
  }, []);
  return <>Fetched {ago(at)} ago</>;
}

interface Props {
  /** The checkout's one `useGitChanges`, shared with the Changes panel. */
  changes: Changes;
  branches: Branches;
  /** HEAD's sha, read while HEAD is detached. */
  head: string | null;
  /** A pick: `track` for a remote row, which checks out its local tracking branch. */
  onSwitch: (target: string, opts: { track: boolean }) => void;
  /** `toolbar`: `⎇ <branch> ▾` in the Code toolbar; `panel`: the Changes panel's label. */
  variant?: "toolbar" | "panel";
  testIdPrefix?: string;
}

/** The open checkout's branches, Local then Remote, fetched on open; a remote pick becomes a tracking branch. */
export function CodeBranchPicker({ changes: g, branches: b, head, onSwitch, variant = "toolbar", testIdPrefix = "code-branch" }: Props) {
  if (!g.branch) return null;
  const detached = g.branch === "HEAD";
  const name = detached ? (head ? `detached ${head.slice(0, 7)}` : "detached") : g.branch;
  const label = g.loading === "switching" ? "switching…" : name;

  const footer = (
    <>
      {b.fetchError ? (
        <span className="cv-br-err">{b.fetchError}</span>
      ) : b.fetchedAt !== null ? (
        <FetchedAgo at={b.fetchedAt} />
      ) : (
        "Not fetched yet"
      )}
      {" · a remote branch becomes a local tracking branch"}
    </>
  );

  const picker = (
    <BranchPicker
      branches={b.local}
      remote={b.remote}
      value={g.branch}
      onChange={(value, meta) => onSwitch(value, { track: !!meta?.remote })}
      onFetch={(reason) => {
        // Reopening mid-fetch must not start a second one.
        if (reason === "open" && b.fetching) return;
        void b.fetch(reason === "open" ? { ifStaleMs: FETCH_STALE_MS } : undefined);
      }}
      fetching={b.fetching}
      footer={footer}
      disabled={!!g.loading}
      align={variant === "toolbar" ? "left" : "right"}
      testIdPrefix={testIdPrefix}
      triggerClassName={variant === "toolbar" ? "cv-br-btn" : "cv-panel-branch"}
      triggerStyle={{}}
      trigger={
        variant === "toolbar" ? (
          <>
            <span aria-hidden="true">⎇</span>{" "}
            <span className="cv-br-name" title={name}>
              {label}
            </span>{" "}
            <span className="cv-sw-car" aria-hidden="true">
              ▾
            </span>
          </>
        ) : (
          <>{label} ▾</>
        )
      }
    />
  );
  return variant === "toolbar" ? <div className="cv-br">{picker}</div> : picker;
}
