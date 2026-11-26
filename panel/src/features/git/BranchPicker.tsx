import { Fragment, useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search } from "lucide-react";
import type { RemoteBranch } from "./branchTypes";

const POPOVER_WIDTH = 320;
const GUTTER = 8;
const GAP = 4;
const LIST_MAX = 240;
// Filter row above the list; approximate, only used to size the list to the room left.
const FILTER_ROW = 32;
// Footer under the list (one line of small text plus padding); approximate, like FILTER_ROW.
const FOOTER_ROW = 28;

interface Place {
  /** Exactly one of top (opens below) / bottom (flipped above) is set. */
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  listMax: number;
}

/**
 * Fixed-position box under the trigger, flipped above when the room below cannot hold the list
 * and above has more; kept inside the viewport horizontally, list capped to the chosen side's room.
 */
function placeFor(trigger: DOMRect, align: "left" | "right", hasFooter: boolean): Place {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.max(0, Math.min(POPOVER_WIDTH, vw - 2 * GUTTER));
  const wanted = align === "right" ? trigger.right - width : trigger.left;
  const left = Math.max(GUTTER, Math.min(wanted, vw - GUTTER - width));
  const below = vh - trigger.bottom - GAP - GUTTER;
  const above = trigger.top - GAP - GUTTER;
  // Rows outside the scroll list that share the chosen side's room.
  const chrome = FILTER_ROW + (hasFooter ? FOOTER_ROW : 0);
  const flip = below < LIST_MAX + chrome && above > below;
  const listMax = Math.max(0, Math.min(LIST_MAX, (flip ? above : below) - chrome));
  return flip ? { bottom: vh - trigger.top + GAP, left, width, listMax } : { top: trigger.bottom + GAP, left, width, listMax };
}

/** One selectable row in display order; `remote` says which group it came from. */
interface Row {
  value: string;
  remote: boolean;
}

interface RemoteGroup {
  remote: string;
  rows: RemoteBranch[];
}

interface BranchPickerProps {
  branches: string[];
  value: string;
  /** `meta.remote` is set in grouped mode (when `remote` is given) and says which group the pick came from. */
  onChange: (branch: string, meta?: { remote: boolean }) => void;
  /** Align dropdown left or right (default: right) */
  align?: "left" | "right";
  /** Placeholder when no value selected */
  placeholder?: string;
  /** Custom trigger content — replaces the default button contents */
  trigger?: React.ReactNode;
  /** Additional CSS class for the trigger button */
  triggerClassName?: string;
  /** Additional inline styles for the trigger button */
  triggerStyle?: React.CSSProperties;
  /** Disambiguator for data-testid when multiple pickers render simultaneously */
  testIdPrefix?: string;
  /** Blocks opening while another git mutation is in flight. */
  disabled?: boolean;
  /** Grouped mode: when given, the list shows a Local group then one "Remote · <remote>" group per remote. */
  remote?: RemoteBranch[];
  /** Shows a "↻ Fetch" button in the filter row (`"button"`); also called once each time the popover opens (`"open"`). */
  onFetch?: (reason: "open" | "button") => void;
  /** A fetch is running: the Fetch button reads "Fetching…" and is disabled. */
  fetching?: boolean;
  /** Rendered under the list. */
  footer?: React.ReactNode;
}

export default function BranchPicker({
  branches,
  value,
  onChange,
  align = "right",
  placeholder = "select branch...",
  trigger,
  triggerClassName,
  triggerStyle,
  testIdPrefix = "branch-picker",
  disabled = false,
  remote,
  onFetch,
  fetching = false,
  footer,
}: BranchPickerProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => (filter ? branches.filter((b) => b.toLowerCase().includes(filter.toLowerCase())) : branches),
    [branches, filter]
  );

  const remoteGroups = useMemo<RemoteGroup[]>(() => {
    if (!remote) return [];
    const needle = filter.toLowerCase();
    const groups: RemoteGroup[] = [];
    for (const r of remote) {
      let g = groups.find((x) => x.remote === r.remote);
      if (!g) groups.push((g = { remote: r.remote, rows: [] }));
      if (!needle || r.ref.toLowerCase().includes(needle)) g.rows.push(r);
    }
    return groups.filter((g) => g.rows.length > 0);
  }, [remote, filter]);

  // Every selectable row in display order, so keyboard navigation runs across groups.
  const rows = useMemo<Row[]>(
    () => [
      ...filtered.map((b) => ({ value: b, remote: false })),
      ...remoteGroups.flatMap((g) => g.rows.map((r) => ({ value: r.ref, remote: true }))),
    ],
    [filtered, remoteGroups]
  );

  const onFetchRef = useRef(onFetch);
  useEffect(() => { onFetchRef.current = onFetch; });
  useEffect(() => { if (open) onFetchRef.current?.("open"); }, [open]);

  useEffect(() => { setHighlightIdx(0); }, [filter]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (containerRef.current?.contains(t) || popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const hasFooter = footer != null;
  // Portalled + fixed so an overflow-clipped or narrow ancestor never cuts the popover off.
  useLayoutEffect(() => {
    if (!open) return;
    let last = "";
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      const key = r && `${r.top} ${r.bottom} ${r.left} ${r.right} ${window.innerWidth} ${window.innerHeight}`;
      if (r && key !== last) {
        last = key!;
        setPlace(placeFor(r, align, hasFooter));
      }
      return r;
    };
    // A trigger measuring 0×0 is no longer laid out (e.g. its column hidden by a media query).
    const follow = () => {
      const r = place();
      if (!r || (r.width === 0 && r.height === 0)) setOpen(false);
    };
    place();
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, true);
    // Layout shifts (a banner expanding above) fire neither event: re-measure each frame while open.
    // An unlaid-out trigger is left to `follow`, which closes on the next scroll/resize.
    let frame = 0;
    const tick = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (r && (r.width || r.height)) place();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
    };
  }, [open, align, hasFooter]);

  useEffect(() => {
    if (open) {
      setFilter("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const item = listRef.current.querySelectorAll("button")[highlightIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx, open]);

  const select = (row: Row) => {
    if (remote) onChange(row.value, { remote: row.remote });
    else onChange(row.value);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlightIdx((i) => Math.min(i + 1, rows.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlightIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && rows[highlightIdx]) { select(rows[highlightIdx]); }
  };

  const renderRow = (row: Row, i: number, testId: string, hint: string | null) => (
    <button
      key={`${row.remote ? "r" : "l"}:${row.value}`}
      data-testid={testId}
      onClick={() => select(row)}
      className="flex items-center w-full px-2 py-1 text-left text-[11px] font-mono transition-colors"
      style={{
        color: !row.remote && row.value === value ? "var(--accent)" : "var(--text-secondary)",
        background: i === highlightIdx ? "var(--bg-hover)" : "transparent",
      }}
      onMouseEnter={() => setHighlightIdx(i)}
      title={row.value}
    >
      <span className="truncate min-w-0">{row.value}</span>
      {hint && (
        <span className="ml-auto pl-2 shrink-0 text-[10px]" style={{ color: "var(--text-muted)" }}>{hint}</span>
      )}
    </button>
  );

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        data-testid={`${testIdPrefix}-toggle`}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={triggerClassName ?? "text-[11px] font-mono rounded px-1.5 py-0.5 cursor-pointer flex items-center gap-1"}
        style={triggerStyle ?? { background: "var(--bg-base)", color: "var(--text-secondary)", border: "1px solid var(--border-subtle)" }}
      >
        {trigger ?? (
          <>
            {value || placeholder}
            <ChevronDown size={10} style={{ color: "var(--text-muted)" }} />
          </>
        )}
      </button>
      {open && place && createPortal(
        <div
          ref={popoverRef}
          data-testid={`${testIdPrefix}-popover`}
          className="z-50 rounded-lg overflow-hidden shadow-lg"
          style={{
            position: "fixed",
            top: place.top === undefined ? undefined : `${place.top}px`,
            bottom: place.bottom === undefined ? undefined : `${place.bottom}px`,
            left: `${place.left}px`,
            width: `${place.width}px`,
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <div className="flex items-center gap-1.5 px-2 py-1.5" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            <Search size={12} style={{ color: "var(--text-muted)" }} />
            <input
              ref={inputRef}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Filter branches..."
              className="flex-1 bg-transparent text-[11px] font-mono outline-none"
              style={{ color: "var(--text-primary)" }}
              spellCheck={false}
            />
            {filter && (
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{rows.length}</span>
            )}
            {onFetch && (
              <button
                type="button"
                data-testid={`${testIdPrefix}-fetch`}
                onClick={() => onFetch("button")}
                disabled={fetching}
                className="text-[10px] rounded px-1.5 py-0.5 shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                style={{ color: "var(--text-muted)", border: "1px solid var(--border-subtle)", background: "transparent" }}
              >
                {fetching ? "Fetching…" : "↻ Fetch"}
              </button>
            )}
          </div>
          <div ref={listRef} style={{ maxHeight: `${place.listMax}px`, overflowY: "auto" }}>
            {remote ? (
              rows.length === 0 ? (
                <div className="px-2 py-2 text-[11px]" style={{ color: "var(--text-muted)" }}>No matching branches</div>
              ) : (
                <>
                  {filtered.length > 0 && (
                    <GroupHeading testId={`${testIdPrefix}-group-local`} label="Local" count={filtered.length} />
                  )}
                  {filtered.map((b, i) =>
                    renderRow({ value: b, remote: false }, i, `${testIdPrefix}-option-${b}`, b === value ? "current" : null)
                  )}
                  {remoteGroups.map((g) => {
                    const start = rows.findIndex((r) => r.remote && r.value === g.rows[0].ref);
                    return (
                      <Fragment key={`remote-${g.remote}`}>
                        <GroupHeading
                          testId={`${testIdPrefix}-group-remote-${g.remote}`}
                          label={`Remote · ${g.remote}`}
                          count={g.rows.length}
                        />
                        {g.rows.map((r, j) =>
                          renderRow({ value: r.ref, remote: true }, start + j, `${testIdPrefix}-remote-option-${r.ref}`, "+ track")
                        )}
                      </Fragment>
                    );
                  })}
                </>
              )
            ) : filtered.length === 0 ? (
              <div className="px-2 py-2 text-[11px]" style={{ color: "var(--text-muted)" }}>No matching branches</div>
            ) : (
              filtered.map((b, i) => (
                <button
                  key={b}
                  data-testid={`${testIdPrefix}-option-${b}`}
                  onClick={() => select({ value: b, remote: false })}
                  className="flex items-center w-full px-2 py-1 text-left text-[11px] font-mono transition-colors"
                  style={{
                    color: b === value ? "var(--accent)" : "var(--text-secondary)",
                    background: i === highlightIdx ? "var(--bg-hover)" : "transparent",
                  }}
                  onMouseEnter={() => setHighlightIdx(i)}
                  title={b}
                >
                  <span className="truncate min-w-0">{b}</span>
                </button>
              ))
            )}
          </div>
          {hasFooter && (
            <div
              data-testid={`${testIdPrefix}-footer`}
              className="px-2 py-1.5 text-[10px]"
              style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border-subtle)" }}
            >
              {footer}
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

function GroupHeading({ testId, label, count }: { testId: string; label: string; count: number }) {
  return (
    <div
      data-testid={testId}
      role="heading"
      aria-level={3}
      aria-label={`${label}, ${count} ${count === 1 ? "branch" : "branches"}`}
      className="flex items-center justify-between px-2 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider"
      style={{ color: "var(--text-muted)" }}
    >
      <span>{label}</span>
      <span data-testid={`${testId}-count`}>{count}</span>
    </div>
  );
}
