import { useEffect, useRef } from "react";

export interface BulkCloseTarget {
  sessions: { id: string; name: string; working: boolean }[];
  /** true for "Close others", false for "Close all". */
  others: boolean;
}

interface Props {
  /** Single-session close (unchanged copy). */
  session?: { id: string; name: string } | null;
  /** Bulk close — takes precedence over `session` when set. */
  bulk?: BulkCloseTarget | null;
  onCancel: () => void;
  onConfirm: (ids: string[]) => void;
}

export function ConfirmCloseTerminalModal({
  session = null,
  bulk = null,
  onCancel,
  onConfirm,
}: Props) {
  const ids = bulk
    ? bulk.sessions.map((s) => s.id)
    : session
      ? [session.id]
      : [];
  const open = ids.length > 0;
  // Stable key so the focus/keydown effect only re-runs on a new target.
  const targetKey = open ? `${bulk ? "bulk" : "one"}:${ids.join(",")}` : null;
  const idsRef = useRef(ids);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  // Parents pass inline callbacks, so their identity changes every render.
  // Route them through refs so the keydown effect can depend only on
  // sessionName — otherwise we'd re-focus the Close button on every parent
  // update and steal focus away from Cancel if the user Tab'd to it.
  const onCancelRef = useRef(onCancel);
  const onConfirmRef = useRef(onConfirm);

  useEffect(() => {
    onCancelRef.current = onCancel;
    onConfirmRef.current = onConfirm;
    idsRef.current = ids;
  });

  useEffect(() => {
    if (!targetKey) return;
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancelRef.current();
      } else if (e.key === "Enter") {
        // If a button is focused, let native activation handle it —
        // otherwise pressing Enter with Cancel focused would confirm.
        if (document.activeElement?.tagName === "BUTTON") return;
        e.preventDefault();
        onConfirmRef.current(idsRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [targetKey]);

  if (!open) return null;

  const count = ids.length;
  const working = bulk ? bulk.sessions.filter((s) => s.working).length : 0;
  const title = bulk
    ? `Close ${count} ${bulk.others ? "other " : ""}terminal${count === 1 ? "" : "s"}?`
    : `Close terminal "${session?.name}"?`;

  return (
    <div
      data-testid="modal-backdrop"
      onClick={onCancel}
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
    >
      <div
        role="alertdialog"
        aria-labelledby="confirm-close-title"
        onClick={(e) => e.stopPropagation()}
        className="w-[90vw] max-w-[380px] rounded-lg p-4"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
          color: "var(--text-primary)",
        }}
      >
        <h2
          id="confirm-close-title"
          className="text-[14px] font-semibold mb-1"
        >
          {title}
        </h2>
        {bulk && (
          <ul
            data-testid="confirm-close-terminal-list"
            className="text-[12.5px] mb-2 max-h-[160px] overflow-auto font-mono"
            style={{ color: "var(--text-primary)" }}
          >
            {bulk.sessions.map((s) => (
              <li key={s.id}>{s.name}</li>
            ))}
          </ul>
        )}
        {working > 0 && (
          <p
            data-testid="confirm-close-terminal-warning"
            className="text-[12.5px] mb-2"
            style={{ color: "var(--yellow, #e0af68)" }}
          >
            {working} have a working agent.
          </p>
        )}
        <p
          className="text-[12.5px] mb-4"
          style={{ color: "var(--text-secondary)" }}
        >
          The shell will be killed. Output is not saved.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="confirm-close-terminal-cancel"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-[12.5px]"
            style={{
              background: "var(--bg-base)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            Cancel
          </button>
          <button
            ref={closeBtnRef}
            autoFocus
            type="button"
            data-testid="confirm-close-terminal-confirm"
            onClick={() => onConfirm(ids)}
            className="px-3 py-1.5 rounded-md text-[12.5px] font-semibold"
            style={{
              background: "var(--red, #f7768e)",
              color: "white",
              border: "1px solid var(--red, #f7768e)",
            }}
          >
            {bulk ? `Close ${count}` : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
