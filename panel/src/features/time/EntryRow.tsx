import { useState, type FormEvent } from "react";
import { formatMinutes } from "./TimeBadge";
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

const inputStyle = {
  background: "var(--bg-secondary)",
  color: "var(--text-primary)",
  borderColor: "var(--border)",
} as const;

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
      <li data-entry-id={entry.id} className="text-sm">
        <form onSubmit={onSave} className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={hhmm}
            onChange={(e) => setHhmm(e.target.value)}
            aria-label="Duration (HH:MM or minutes)"
            className="px-2 py-1 rounded text-sm outline-none border w-24"
            style={inputStyle}
            spellCheck={false}
            autoComplete="off"
          />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Date"
            className="px-2 py-1 rounded text-sm outline-none border"
            style={inputStyle}
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Note"
            placeholder="Note"
            className="px-2 py-1 rounded text-sm outline-none border flex-1 min-w-32"
            style={inputStyle}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={busy}
            className="text-sm px-3 py-1 rounded disabled:opacity-50"
            style={{ background: "var(--accent)", color: "var(--accent-contrast, white)" }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="text-sm px-3 py-1 rounded"
            style={{ color: "var(--text-tertiary)" }}
          >
            Cancel
          </button>
          {error && (
            <span role="alert" className="text-[12px]" style={{ color: "var(--text-error, #f87171)" }}>
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
        className="flex items-center gap-3 text-sm"
        style={{ color: "var(--text-tertiary)" }}
      >
        <span>Delete this entry?</span>
        <button
          type="button"
          onClick={onConfirmDelete}
          disabled={busy}
          className="text-sm px-3 py-1 rounded disabled:opacity-50"
          style={{ background: "var(--text-error, #b91c1c)", color: "white" }}
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          className="text-sm px-3 py-1 rounded"
          style={{ color: "var(--text-tertiary)" }}
        >
          Cancel
        </button>
        {error && (
          <span role="alert" className="text-[12px]" style={{ color: "var(--text-error, #f87171)" }}>
            {error}
          </span>
        )}
      </li>
    );
  }

  return (
    <li
      data-entry-id={entry.id}
      className="flex items-center gap-3 text-sm"
    >
      <span style={{ color: "var(--text-primary)" }}>{formatMinutes(entry.minutes)}</span>
      <span className="flex-1" style={{ color: "var(--text-tertiary)" }}>
        {entry.note ?? ""}
      </span>
      <button
        type="button"
        onClick={enterEdit}
        data-testid="time-entry-edit"
        aria-label="Edit entry"
        className="text-xs px-1"
        style={{ color: "var(--text-tertiary)" }}
      >
        ✎
      </button>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setMode("confirming-delete");
        }}
        data-testid="time-entry-delete"
        aria-label="Delete entry"
        className="text-xs px-1"
        style={{ color: "var(--text-tertiary)" }}
      >
        ✕
      </button>
    </li>
  );
};
