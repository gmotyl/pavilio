import { useEffect, useState, type HTMLAttributes, type MouseEvent } from "react";
import { FileText, Trash2 } from "lucide-react";

/** How long an armed delete waits for its confirming second click. */
const DELETE_CONFIRM_MS = 4_000;

/** Badge colour per row kind; anything unlisted stays tertiary. */
const KIND_COLOR: Record<string, string> = {
  review: "var(--accent)",
  story: "var(--blue)",
};

export interface FileRowDelete {
  /** What the control removes, for its accessible name (e.g. `stories/x.md`). */
  name: string;
  /** The armed label, e.g. "Delete?" or "Delete run?". */
  confirmLabel: string;
  /** Performs the delete; a thrown Error's message is shown on the row. */
  run: () => Promise<void>;
}

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
  title?: string;
  /** Pre-built drag handlers — plans and sections use different drag hooks. */
  dragProps?: HTMLAttributes<HTMLButtonElement>;
  onSelect: () => void;
  /** Optional two-click delete at the row's right edge, revealed on hover/focus. */
  deleteControl?: FileRowDelete;
}

export default function FileRow({
  testId,
  label,
  dateLabel,
  monoLabel,
  kind,
  selected = false,
  title,
  dragProps,
  onSelect,
  deleteControl,
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
          color: selected ? "var(--text-primary)" : "var(--text-secondary)",
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
          style={{ color: "var(--text-tertiary)" }}
        />
        <span className={`truncate flex-1 ${monoLabel ? "font-mono" : ""}`}>
          {label}
        </span>
        {kind && (
          <span
            data-testid={`${testId}-kind`}
            className="shrink-0 text-[9px] uppercase tracking-wider"
            style={{
              color: KIND_COLOR[kind] ?? "var(--text-tertiary)",
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
      {deleteControl && <DeleteButton testId={testId} control={deleteControl} />}
    </div>
  );
}

/**
 * Trash icon: the first click arms it (red confirm label), a second click
 * within {@link DELETE_CONFIRM_MS} deletes. Timeout or blur disarms. It is a
 * sibling of the row button, so it never opens the row.
 */
function DeleteButton({ testId, control }: { testId: string; control: FileRowDelete }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), DELETE_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  const click = async (e: MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    if (!armed) {
      setError(null);
      setArmed(true);
      return;
    }
    setArmed(false);
    setBusy(true);
    try {
      await control.run();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        data-testid={`${testId}-delete`}
        data-armed={armed || undefined}
        aria-label={`${armed ? "Confirm delete" : "Delete"} ${control.name}`}
        title={armed ? undefined : `Delete ${control.name}`}
        disabled={busy}
        onClick={click}
        onBlur={() => setArmed(false)}
        className={`shrink-0 inline-flex items-center gap-1 h-[22px] rounded-md text-[10px] font-semibold transition-opacity ${
          armed
            ? "opacity-100 px-2"
            : "opacity-0 w-[22px] justify-center group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
        }`}
        style={{
          color: armed ? "var(--red)" : "var(--text-tertiary)",
          background: armed ? "var(--red-dim)" : "transparent",
        }}
      >
        <Trash2 size={12} aria-hidden="true" />
        {armed ? control.confirmLabel : null}
      </button>
      {error && (
        <span
          role="alert"
          data-testid={`${testId}-delete-error`}
          className="shrink-0 text-[10px] px-1"
          style={{ color: "var(--red)" }}
        >
          {error}
        </span>
      )}
    </>
  );
}
