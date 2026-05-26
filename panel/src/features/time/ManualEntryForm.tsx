import { useState, type FormEvent } from "react";
import { parseHHMM } from "./parseHHMM";

type ManualEntryFormProps = {
  project: string;
  onSaved: () => void;
};

const todayIso = (): string => new Date().toISOString().slice(0, 10);

const fieldLabelClass =
  "text-[10px] tracking-[0.15em] uppercase mb-1 block";
const fieldLabelStyle = { color: "var(--text-tertiary)" } as const;

const underlineInputClass =
  "border-0 border-b bg-transparent px-0 py-2 text-base outline-none transition-colors focus:border-[color:var(--accent)] w-full";
const underlineInputStyle = {
  borderBottomColor: "var(--border-subtle)",
  color: "var(--text-primary)",
} as const;

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
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="md:flex md:items-end md:gap-6 space-y-4 md:space-y-0">
        <div className="md:w-28">
          <label htmlFor="manual-entry-time" className={fieldLabelClass} style={fieldLabelStyle}>
            Time
          </label>
          <input
            id="manual-entry-time"
            type="text"
            value={hhmm}
            onChange={(e) => setHhmm(e.target.value)}
            placeholder="e.g. 1:30"
            className={`${underlineInputClass} font-mono`}
            style={underlineInputStyle}
            spellCheck={false}
            autoComplete="off"
            aria-label="Duration (HH:MM or minutes)"
          />
        </div>
        <div className="md:w-44">
          <label htmlFor="manual-entry-date" className={fieldLabelClass} style={fieldLabelStyle}>
            Date
          </label>
          <input
            id="manual-entry-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={`${underlineInputClass} font-mono`}
            style={underlineInputStyle}
            aria-label="Date"
          />
        </div>
        <div className="flex-1">
          <label htmlFor="manual-entry-note" className={fieldLabelClass} style={fieldLabelStyle}>
            Note
          </label>
          <input
            id="manual-entry-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note"
            className={underlineInputClass}
            style={underlineInputStyle}
            spellCheck={false}
            autoComplete="off"
            aria-label="Note"
          />
        </div>
        <div className="md:pb-2">
          <button
            type="submit"
            data-testid="time-manual-entry-save"
            disabled={submitting}
            className="text-sm hover:underline bg-transparent border-0 cursor-pointer p-0 disabled:opacity-50"
            style={{ color: "var(--accent)" }}
          >
            {submitting ? "Saving…" : "Save →"}
          </button>
        </div>
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
