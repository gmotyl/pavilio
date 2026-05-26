import { useState, type FormEvent } from "react";
import { parseHHMM } from "./parseHHMM";

export type ManualEntry = {
  id: string;
  type: "manual";
  date: string;
  minutes: number;
  note?: string;
  createdAt?: string;
};

type Mode = "idle" | "editing" | "confirming-delete";

const toHHMM = (n: number): string => {
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
};

const formatPretty = (n: number): string => {
  if (n <= 0) return "0m";
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
};

const underlineInputClass =
  "border-0 border-b bg-transparent px-0 py-1 text-sm outline-none transition-colors focus:border-[color:var(--accent)]";
const underlineInputStyle = {
  borderBottomColor: "var(--border-subtle)",
  color: "var(--text-primary)",
} as const;

const textLinkClass = "text-sm hover:underline bg-transparent border-0 cursor-pointer p-0";

type EntryRowProps = {
  project: string;
  entry: ManualEntry;
  onChange: () => void;
};

export const EntryRow = ({ project, entry, onChange }: EntryRowProps) => {
  const [mode, setMode] = useState<Mode>("idle");
  const [hhmm, setHhmm] = useState(toHHMM(entry.minutes));
  const [date, setDate] = useState(entry.date);
  const [note, setNote] = useState(entry.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const enterEdit = () => {
    setHhmm(toHHMM(entry.minutes));
    setDate(entry.date);
    setNote(entry.note ?? "");
    setError(null);
    setMode("editing");
  };

  const cancel = () => {
    setMode("idle");
    setError(null);
  };

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    const minutes = parseHHMM(hhmm);
    if (minutes === null) {
      setError("Use HH:MM or minutes");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/time/entry/${encodeURIComponent(entry.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, patch: { minutes, date, note } }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      setMode("idle");
      onChange();
    } catch {
      setError("Could not save");
    } finally {
      setBusy(false);
    }
  };

  const onConfirmDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/time/entry/${encodeURIComponent(entry.id)}?project=${encodeURIComponent(project)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("HTTP " + res.status);
      setMode("idle");
      onChange();
    } catch {
      setError("Could not delete");
    } finally {
      setBusy(false);
    }
  };

  if (mode === "editing") {
    return (
      <li data-entry-id={entry.id} className="py-2">
        <form onSubmit={onSave} className="flex flex-wrap items-end gap-4">
          <input
            type="text"
            value={hhmm}
            onChange={(e) => setHhmm(e.target.value)}
            aria-label="Duration (HH:MM or minutes)"
            className={`${underlineInputClass} font-mono w-20`}
            style={underlineInputStyle}
            spellCheck={false}
            autoComplete="off"
          />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Date"
            className={`${underlineInputClass} font-mono`}
            style={underlineInputStyle}
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Note"
            placeholder="Note"
            className={`${underlineInputClass} flex-1 min-w-32`}
            style={underlineInputStyle}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="submit"
            data-testid="time-entry-edit-save"
            disabled={busy}
            className={`${textLinkClass} disabled:opacity-50`}
            style={{ color: "var(--accent)" }}
          >
            Save →
          </button>
          <button
            type="button"
            data-testid="time-entry-edit-cancel"
            onClick={cancel}
            disabled={busy}
            className={textLinkClass}
            style={{ color: "var(--text-tertiary)" }}
          >
            Cancel
          </button>
          {error && (
            <span
              role="alert"
              className="text-[12px] basis-full"
              style={{ color: "var(--text-error, #f87171)" }}
            >
              {error}
            </span>
          )}
        </form>
      </li>
    );
  }

  if (mode === "confirming-delete") {
    return (
      <li
        data-entry-id={entry.id}
        className="flex items-center gap-3 text-sm py-2 px-3 -mx-3 rounded"
        style={{ color: "var(--text-tertiary)" }}
      >
        <span>Delete this entry?</span>
        <button
          type="button"
          data-testid="time-entry-delete-confirm"
          onClick={onConfirmDelete}
          disabled={busy}
          className={`${textLinkClass} disabled:opacity-50`}
          style={{ color: "var(--text-error, #f87171)" }}
        >
          Confirm
        </button>
        <span style={{ color: "var(--text-muted)" }}>·</span>
        <button
          type="button"
          data-testid="time-entry-delete-cancel"
          onClick={cancel}
          disabled={busy}
          className={textLinkClass}
          style={{ color: "var(--text-tertiary)" }}
        >
          Cancel
        </button>
        {error && (
          <span
            role="alert"
            className="text-[12px]"
            style={{ color: "var(--text-error, #f87171)" }}
          >
            {error}
          </span>
        )}
      </li>
    );
  }

  return (
    <li
      data-entry-id={entry.id}
      className="group flex items-center gap-3 text-sm py-2 px-3 -mx-3 rounded transition-colors hover:bg-[color:var(--bg-hover)]"
    >
      <span
        className="font-mono text-right"
        style={{ color: "var(--text-primary)", minWidth: "4ch" }}
      >
        {formatPretty(entry.minutes)}
      </span>
      <span className="flex-1" style={{ color: "var(--text-secondary)" }}>
        {entry.note ?? ""}
      </span>
      <button
        type="button"
        onClick={enterEdit}
        data-testid="time-entry-edit"
        aria-label="Edit entry"
        className="text-xs px-1 opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ color: "var(--text-tertiary)" }}
      >
        ✎
      </button>
      <button
        type="button"
        data-testid="time-entry-delete"
        onClick={() => {
          setError(null);
          setMode("confirming-delete");
        }}
        aria-label="Delete entry"
        className="text-xs px-1 opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ color: "var(--text-tertiary)" }}
      >
        ✕
      </button>
    </li>
  );
};
