import { useEffect, useRef, useState } from "react";
import type { PrFilter as PrFilterValue } from "../../preferences/declarations";
import type { PreferenceSetter } from "../../preferences/usePreference";
import PrFilter from "./PrFilter";
import PrRow, { prKey } from "./PrRow";
import type { PrsState, PullRequest } from "./usePrs";
import "./Review.css";

interface Props {
  project: string;
  prs: PrsState;
  filter: PrFilterValue;
  setFilter: PreferenceSetter<PrFilterValue>;
  /** The open PR, when it is still in the list. */
  current: PullRequest | undefined;
  /** The URL's `pr=` value, shown while the list loads or when the PR is gone. */
  currentKey: string | null;
  onPick: (pr: PullRequest) => void;
}

/** Context-slot button + popover with the same filter and rows as the PRs view. */
export default function PrSwitcher({ project, prs, filter, setFilter, current, currentKey, onPick }: Props) {
  const [open, setOpen] = useState(false);
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

  let list;
  if (prs.error) list = <p className="prs-status">Couldn't load pull requests ({prs.error}).</p>;
  else if (prs.loading && prs.me === null) list = <p className="prs-status">Loading pull requests…</p>;
  else if (prs.prs.length === 0) list = <p className="prs-empty">No open pull requests match.</p>;
  else
    list = (
      <ul className="pr-list" role="listbox" aria-label="Open pull requests">
        {prs.prs.map((p) => (
          <PrRow
            key={prKey(p)}
            pr={p}
            me={prs.me}
            selected={prKey(p) === currentKey}
            onOpen={(picked) => {
              setOpen(false);
              onPick(picked);
            }}
          />
        ))}
      </ul>
    );

  return (
    <div className="rv-sw" ref={rootRef}>
      <button
        type="button"
        className="rv-sw-btn"
        data-testid="pr-switcher"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {current ? (
          <>
            <span className="pr-repo">{current.repo}</span>
            <span className="rv-sw-tt">
              #{current.number} {current.title}
            </span>
          </>
        ) : (
          <span className="rv-sw-tt">{currentKey ?? "Pick a pull request"}</span>
        )}
        <span className="rv-sw-car" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="rv-sw-pop" role="dialog" aria-label="Pick a pull request">
          <PrFilter project={project} me={prs.me} filter={filter} setFilter={setFilter} counts={prs.counts} authors={prs.authors} />
          <div className="rv-sw-list">{list}</div>
        </div>
      )}
    </div>
  );
}
