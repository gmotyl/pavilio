import { useState, type FormEvent } from "react";
import { parseHHMM } from "./parseHHMM";

type ManualEntryFormProps = {
  project: string;
  onSaved: () => void;
};

const todayIso = (): string => new Date().toISOString().slice(0, 10);

export const ManualEntryForm = ({ project, onSaved }: ManualEntryFormProps) => {
  const [hhmm, setHhmm] = useState("");
  const [date, setDate] = useState(todayIso);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const minutes = parseHHMM(hhmm);
    if (minutes === null) {
      setError("Use HH:MM or minutes");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/time/append", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project,
          entry: {
            type: "manual",
            date,
            minutes,
            note,
            createdAt: new Date().toISOString(),
          },
        }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      setHhmm("");
      setNote("");
      onSaved();
    } catch {
      setError("Could not save");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={hhmm}
          onChange={(e) => setHhmm(e.target.value)}
          placeholder="e.g. 1:30 or 90"
          className="px-2 py-1 rounded text-sm outline-none border w-32"
          style={{
            background: "var(--bg-secondary)",
            color: "var(--text-primary)",
            borderColor: "var(--border)",
          }}
          spellCheck={false}
          autoComplete="off"
          aria-label="Duration (HH:MM or minutes)"
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="px-2 py-1 rounded text-sm outline-none border"
          style={{
            background: "var(--bg-secondary)",
            color: "var(--text-primary)",
            borderColor: "var(--border)",
          }}
          aria-label="Date"
        />
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note"
          className="px-2 py-1 rounded text-sm outline-none border flex-1 min-w-40"
          style={{
            background: "var(--bg-secondary)",
            color: "var(--text-primary)",
            borderColor: "var(--border)",
          }}
          spellCheck={false}
          autoComplete="off"
          aria-label="Note"
        />
        <button
          type="submit"
          data-testid="time-manual-entry-save"
          disabled={submitting}
          className="text-sm px-3 py-1 rounded disabled:opacity-50"
          style={{
            background: "var(--accent)",
            color: "var(--accent-contrast, white)",
          }}
        >
          {submitting ? "Saving..." : "Save"}
        </button>
      </div>
      {error && (
        <div
          role="alert"
          className="text-[12px]"
          style={{ color: "var(--text-error, #f87171)" }}
        >
          {error}
        </div>
      )}
    </form>
  );
};
