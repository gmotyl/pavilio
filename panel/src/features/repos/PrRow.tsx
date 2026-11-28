import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import type { ChecksState, PrState } from "../../../server/lib/prs/provider";
import type { PullRequest } from "./usePrs";
import { forgeCopy } from "./forgeCopy";
import "./Prs.css";

interface Props {
  pr: PullRequest;
  me: string | null;
  selected?: boolean;
  /** Roving tabindex: only the list's active row is in the tab order. */
  tabbable?: boolean;
  onFocus?: () => void;
  onOpen: (pr: PullRequest) => void;
  /** Buttons drawn at the right; their clicks and keys never reach the row, so they don't open it. */
  actions?: ReactNode;
  /** A PR fetched in any state (the story header): merged and closed get their own icon colour. */
  state?: PrState;
  /** Badges drawn after the review badge, e.g. the story header's Merged / Story behind / language tag. */
  extraBadges?: ReactNode;
  /**
   * A lone row outside a listbox (the story header): a plain `div` with no option
   * role, selection or tab stop, so its links and buttons are not nested in an
   * interactive role. A click still opens it; the keyboard uses its own Review link.
   */
  standalone?: boolean;
}

const keepClick = (e: MouseEvent) => e.stopPropagation();
/** Enter/Space press the button only; Arrow/Home/End still bubble to the list's roving focus. */
const keepActivation = (e: KeyboardEvent) => {
  if (e.key === "Enter" || e.key === " ") e.stopPropagation();
};

/** `pr=` value in the URL; the Review view resolves the repo name back to its path. */
export const prKey = (pr: Pick<PullRequest, "repo" | "number">) => `${pr.repo}#${pr.number}`;

const NAV_KEYS = ["ArrowDown", "ArrowUp", "Home", "End"];

/** Listbox Arrow/Home/End move focus between options; Enter is handled by the row. */
export function moveListFocus(e: KeyboardEvent<HTMLElement>) {
  if (!NAV_KEYS.includes(e.key)) return;
  const options = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')];
  // From a row's own button too: the option holding focus, not just a focused option.
  const at = options.indexOf(document.activeElement?.closest<HTMLElement>('[role="option"]') as HTMLElement);
  const last = options.length - 1;
  const to =
    e.key === "Home" ? 0 : e.key === "End" ? last : e.key === "ArrowDown" ? Math.min(at + 1, last) : Math.max(at - 1, 0);
  e.preventDefault();
  options[to]?.focus();
}

export function updatedAgo(iso: string, now = Date.now()): string {
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (Number.isNaN(mins)) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d ago`;
  return `on ${new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

// Stable per login, so a person keeps their colour across rows and sessions.
export function hue(login: string): string {
  let h = 0;
  for (const ch of login) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 65% 68%)`;
}

const CHECKS: Partial<Record<ChecksState, [string, string]>> = {
  pass: ["✓", "Checks passed"],
  fail: ["✕", "Checks failing"],
  running: ["●", "Checks running"],
};

function badge(pr: PullRequest, me: string | null): [string, string] | null {
  if (pr.isDraft) return ["Draft", ""];
  if (me && pr.reviewers.includes(me)) return ["Your review requested", "pr-badge-req"];
  if (pr.reviewDecision === "approved") return ["Approved", "pr-badge-ok"];
  if (pr.reviewDecision === "changes") return ["Changes requested", "pr-badge-chg"];
  if (pr.reviewDecision === "required") return ["Review required", ""];
  return null;
}

/** The pull-request glyph; its colour comes from the `pr-ic` span around it. */
export const PrIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="4" cy="3.5" r="1.6" />
      <circle cx="4" cy="12.5" r="1.6" />
      <circle cx="12" cy="12.5" r="1.6" />
      <path d="M4 5.2v5.6M12 10.8V6.5a2 2 0 0 0-2-2H7.5" />
    </g>
  </svg>
);

const IC_STATE: Partial<Record<PrState, string>> = { merged: " pr-ic-merged", closed: " pr-ic-closed" };

/** A finished PR's review state is history: only its Merged / Closed badge speaks for it. */
const FINISHED: readonly PrState[] = ["merged", "closed"];

export default function PrRow({
  pr,
  me,
  selected = false,
  tabbable = true,
  onFocus,
  onOpen,
  actions,
  state,
  extraBadges,
  standalone = false,
}: Props) {
  const chk = CHECKS[pr.checks];
  const b = state && FINISHED.includes(state) ? null : badge(pr, me);
  const shared = {
    className: "pr-row",
    "data-testid": `pr-row-${prKey(pr)}`,
    "data-number": pr.number,
    onClick: () => onOpen(pr),
  };
  const body = (
    <>
      <span className={`pr-ic${(state && IC_STATE[state]) || (pr.isDraft ? " pr-ic-draft" : "")}`}>
        <PrIcon />
      </span>
      <span className="pr-tt">{pr.title}</span>
      <span className="pr-right">
        {chk && (
          <span className={`pr-chk pr-chk-${pr.checks}`} title={chk[1]} aria-label={chk[1]}>
            {chk[0]}
          </span>
        )}
        {actions && (
          // Not a control: it only fences the row's open-on-click/Enter off its buttons.
          <span className="pr-actions" onClick={keepClick} onKeyDown={keepActivation}>
            {actions}
          </span>
        )}
      </span>
      <span className="pr-meta">
        <span className="pr-repo">{pr.repo}</span>
        <span>{forgeCopy(pr.forge).number(pr.number)}</span>
        <span className="pr-av" style={{ background: hue(pr.author) }} title={pr.author} aria-hidden="true">
          {pr.author.slice(0, 2).toUpperCase()}
        </span>
        <span>{pr.author === me ? "you" : pr.author}</span>
        <span title={pr.updatedAt}>updated {updatedAgo(pr.updatedAt)}</span>
        {b && <span className={`pr-badge${b[1] ? ` ${b[1]}` : ""}`}>{b[0]}</span>}
        {extraBadges}
      </span>
    </>
  );
  if (standalone) return <div {...shared}>{body}</div>;
  return (
    <li
      {...shared}
      role="option"
      tabIndex={tabbable ? 0 : -1}
      aria-selected={selected}
      onFocus={onFocus}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen(pr);
        }
      }}
    >
      {body}
    </li>
  );
}
