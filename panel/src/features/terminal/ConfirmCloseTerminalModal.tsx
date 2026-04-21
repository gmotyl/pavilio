import { useEffect, useRef } from "react";

interface Props {
  sessionName: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmCloseTerminalModal({
  sessionName,
  onCancel,
  onConfirm,
}: Props) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!sessionName) return;
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        // Prevent native button activation from also firing onConfirm
        // when the Close button is focused (would double-fire).
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sessionName, onCancel, onConfirm]);

  if (!sessionName) return null;

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
          Close terminal "{sessionName}"?
        </h2>
        <p
          className="text-[12.5px] mb-4"
          style={{ color: "var(--text-secondary)" }}
        >
          The shell will be killed. Output is not saved.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
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
            onClick={onConfirm}
            className="px-3 py-1.5 rounded-md text-[12.5px] font-semibold"
            style={{
              background: "var(--red, #f7768e)",
              color: "white",
              border: "1px solid var(--red, #f7768e)",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
