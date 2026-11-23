import { useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search } from "lucide-react";

const POPOVER_WIDTH = 320;
const GUTTER = 8;
const GAP = 4;
const LIST_MAX = 240;
// Filter row above the list; approximate, only used to size the list to the room left.
const FILTER_ROW = 32;

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
function placeFor(trigger: DOMRect, align: "left" | "right"): Place {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.max(0, Math.min(POPOVER_WIDTH, vw - 2 * GUTTER));
  const wanted = align === "right" ? trigger.right - width : trigger.left;
  const left = Math.max(GUTTER, Math.min(wanted, vw - GUTTER - width));
  const below = vh - trigger.bottom - GAP - GUTTER;
  const above = trigger.top - GAP - GUTTER;
  const flip = below < LIST_MAX + FILTER_ROW && above > below;
  const listMax = Math.max(0, Math.min(LIST_MAX, (flip ? above : below) - FILTER_ROW));
  return flip ? { bottom: vh - trigger.top + GAP, left, width, listMax } : { top: trigger.bottom + GAP, left, width, listMax };
}

interface BranchPickerProps {
  branches: string[];
  value: string;
  onChange: (branch: string) => void;
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

  // Portalled + fixed so an overflow-clipped or narrow ancestor never cuts the popover off.
  useLayoutEffect(() => {
    if (!open) return;
    let last = "";
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      const key = r && `${r.top} ${r.bottom} ${r.left} ${r.right} ${window.innerWidth} ${window.innerHeight}`;
      if (r && key !== last) {
        last = key!;
        setPlace(placeFor(r, align));
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
  }, [open, align]);

  useEffect(() => {
    if (open) {
      setFilter("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const item = listRef.current.children[highlightIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx, open]);

  const select = (b: string) => { onChange(b); setOpen(false); };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlightIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && filtered[highlightIdx]) { select(filtered[highlightIdx]); }
  };

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
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{filtered.length}</span>
            )}
          </div>
          <div ref={listRef} style={{ maxHeight: `${place.listMax}px`, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div className="px-2 py-2 text-[11px]" style={{ color: "var(--text-muted)" }}>No matching branches</div>
            ) : (
              filtered.map((b, i) => (
                <button
                  key={b}
                  data-testid={`${testIdPrefix}-option-${b}`}
                  onClick={() => select(b)}
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
        </div>,
        document.body
      )}
    </div>
  );
}
