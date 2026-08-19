import type { HTMLAttributes, ReactNode } from "react";
import { FileText } from "lucide-react";

export interface FileRowProps {
  /** Full testid — callers build it from their tab prefix. */
  testId: string;
  label: string;
  /** Right-aligned secondary label (mtime). Plans pass none — their filenames carry dates. */
  dateLabel?: string;
  monoLabel?: boolean;
  /** Type marker rendered as a small badge (e.g. "review" | "run"). */
  kind?: string;
  selected?: boolean;
  /** Listed in the project's CURRENT.md. */
  isCurrent?: boolean;
  title?: string;
  /** Pre-built drag handlers — plans and sections use different drag hooks. */
  dragProps?: HTMLAttributes<HTMLButtonElement>;
  /** Star control, filled in by the star plan. */
  star?: ReactNode;
  onSelect: () => void;
}

export default function FileRow({
  testId,
  label,
  dateLabel,
  monoLabel,
  kind,
  selected = false,
  isCurrent = false,
  title,
  dragProps,
  star,
  onSelect,
}: FileRowProps) {
  return (
    <div className="group flex items-center gap-0.5">
      <button
        {...dragProps}
        data-testid={testId}
        data-file-row=""
        onClick={onSelect}
        title={title}
        className="flex items-center gap-2 flex-1 min-w-0 px-2 py-1 rounded-md text-left text-xs transition-colors"
        style={{
          background: selected ? "var(--bg-active)" : "transparent",
          color: selected
            ? "var(--text-primary)"
            : isCurrent
              ? "var(--accent)"
              : "var(--text-secondary)",
          fontWeight: isCurrent ? 600 : 400,
        }}
        onMouseEnter={(e) => {
          if (!selected) e.currentTarget.style.background = "var(--bg-hover)";
        }}
        onMouseLeave={(e) => {
          if (!selected) e.currentTarget.style.background = "transparent";
        }}
      >
        <FileText
          size={13}
          className="shrink-0"
          style={{ color: isCurrent ? "var(--accent)" : "var(--text-tertiary)" }}
        />
        <span className={`truncate flex-1 ${monoLabel ? "font-mono" : ""}`}>
          {label}
        </span>
        {isCurrent && (
          <span
            data-testid={`${testId}-current-badge`}
            className="shrink-0 text-[9px] uppercase tracking-wider"
            style={{ color: "var(--accent)" }}
          >
            current
          </span>
        )}
        {kind && (
          <span
            data-testid={`${testId}-kind`}
            className="shrink-0 text-[9px] uppercase tracking-wider"
            style={{
              color:
                kind === "review" ? "var(--accent)" : "var(--text-tertiary)",
            }}
          >
            {kind}
          </span>
        )}
        {dateLabel && (
          <span
            className="shrink-0 text-[10px]"
            style={{ color: "var(--text-muted)" }}
          >
            {dateLabel}
          </span>
        )}
      </button>
      {star}
    </div>
  );
}
