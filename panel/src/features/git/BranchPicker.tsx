import { useState, useEffect, useMemo, useRef } from "react";
import { ChevronDown, Search } from "lucide-react";

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
}: BranchPickerProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => (filter ? branches.filter((b) => b.toLowerCase().includes(filter.toLowerCase())) : branches),
    [branches, filter]
  );

  useEffect(() => { setHighlightIdx(0); }, [filter]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

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
        data-testid={`${testIdPrefix}-toggle`}
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
      {open && (
        <div
          className="absolute top-full mt-1 z-50 rounded-lg overflow-hidden shadow-lg"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            width: "320px",
            ...(align === "right" ? { right: 0 } : { left: 0 }),
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
          <div ref={listRef} style={{ maxHeight: "240px", overflowY: "auto" }}>
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
                >
                  {b}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
