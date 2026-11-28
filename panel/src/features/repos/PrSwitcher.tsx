import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PrFilter as PrFilterValue } from "../../preferences/declarations";
import type { PreferenceSetter } from "../../preferences/usePreference";
import { forgeCopy } from "./forgeCopy";
import PrFilter from "./PrFilter";
import PrRow, { moveListFocus, prKey } from "./PrRow";
import { PrsNotices } from "./PrsView";
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

const POP_GUTTER = 8;

/** Context-slot button + popover with the same filter, rows, notices and keyboard model as the PRs view. */
export default function PrSwitcher({ project, prs, filter, setFilter, current, currentKey, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const { revalidate } = prs;

  // Keyboard closes hand focus back to the trigger; the row that held it may unmount.
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    revalidate();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, revalidate]);

  // The popover hangs off the trigger mid-topbar; keep it inside the Repos tab, not the viewport.
  useLayoutEffect(() => {
    const pop = popRef.current;
    const bound = rootRef.current?.closest(".rt");
    if (!open || !pop || !bound) return;
    pop.style.left = "";
    const b = bound.getBoundingClientRect();
    pop.style.maxWidth = `${Math.max(b.width - 2 * POP_GUTTER, 0)}px`;
    const r = pop.getBoundingClientRect();
    const over = r.right - (b.right - POP_GUTTER);
    if (over > 0) pop.style.left = `${-Math.min(over, Math.max(r.left - (b.left + POP_GUTTER), 0))}px`;
  }, [open]);

  const keys = prs.prs.map(prKey);
  const active = [focused, currentKey].find((k) => k && keys.includes(k)) ?? keys[0];

  let list;
  if (prs.error)
    list = (
      <p className="prs-status" role="alert">
        Couldn't load pull requests ({prs.error}).{" "}
        <button type="button" data-testid="pr-switcher-retry" onClick={prs.reload}>
          Retry
        </button>
      </p>
    );
  else if (prs.loading && prs.me === null) list = <p className="prs-status">Loading pull requests…</p>;
  else if (prs.prs.length === 0) list = <p className="prs-empty">{prs.all.length === 0 ? "No open pull requests." : "No open pull requests match."}</p>;
  else
    list = (
      <ul className="pr-list" role="listbox" aria-label="Open pull requests" onKeyDown={moveListFocus}>
        {prs.prs.map((p) => (
          <PrRow
            key={prKey(p)}
            pr={p}
            me={prs.me}
            selected={prKey(p) === currentKey}
            tabbable={prKey(p) === active}
            onFocus={() => setFocused(prKey(p))}
            onOpen={(picked) => {
              close(true);
              onPick(picked);
            }}
          />
        ))}
      </ul>
    );

  return (
    <div className="rv-sw" ref={rootRef}>
      <button
        ref={triggerRef}
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
              {forgeCopy(current.forge).number(current.number)} {current.title}
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
        <div ref={popRef} className="rv-sw-pop" role="dialog" aria-label="Pick a pull request">
          <PrFilter
            project={project}
            me={prs.me}
            filter={filter}
            setFilter={setFilter}
            counts={prs.counts}
            authors={prs.authors}
            identityUnknown={prs.identityUnknown}
          />
          <PrsNotices prs={prs} testIdPrefix="pr-switcher" />
          <div className="rv-sw-list">{list}</div>
        </div>
      )}
    </div>
  );
}
